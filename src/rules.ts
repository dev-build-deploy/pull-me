/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { ConventionalCommit } from "@dev-build-deploy/commit-it";

import { compilePattern, REQUIRED_SECTIONS, ResolvedConfig } from "./config.js";
import { Diagnostic, Level, sortDiagnostics } from "./diagnostic.js";
import {
  authorLines,
  BodyLine,
  normaliseHeading,
  parseBody,
  ParsedBody,
  Section,
  stripInlineComments,
} from "./markdown.js";

/** A rule of PullMe's own: its id, its default level and what it checks. */
export interface RuleInfo {
  id: string;
  level: Level;
  summary: string;
}

/** PullMe's structure rules. The prose rules are Vale's (see vale.ts). */
export const RULES: RuleInfo[] = [
  { id: "PM001", level: "error", summary: "A required section (Why, How, Review hints, Proof) is missing." },
  { id: "PM002", level: "error", summary: "A section is empty or holds only placeholders." },
  { id: "PM003", level: "error", summary: "A section is shorter than its minimum length." },
  { id: "PM004", level: "error", summary: "Proof has no evidence (image, run or artifact link, fenced output)." },
  { id: "PM005", level: "error", summary: "An image points to a local path and will render broken." },
  {
    id: "PM006",
    level: "warning",
    summary: "A linked CI run is not in this repository, not found, or did not succeed.",
  },
  { id: "PM007", level: "warning", summary: "The sections are out of order." },
  { id: "PM008", level: "warning", summary: "The title is breaking but there is no Breaking changes section." },
];

/** What each required section is for: the text of a fix-it hint. */
export const SECTION_PURPOSE: Record<string, string> = {
  Why: "the value: what this achieves, for whom, and which issue or decision asks for it (not the diff)",
  How: "the implementation: the choices and their reasons (not a file list)",
  "Review hints": "where the risk is, what to read first, what is not covered or not tested",
  Proof: "the evidence: test output in a fenced block, links to CI runs or artifacts, screenshots",
};

/** Lines that hold no content: the leftovers of a template. */
const PLACEHOLDER = /^(todo|tbd|n\/a|na|-|\.\.\.|…|none|tba)\.?$/i;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** References that count as no prose: an issue number (#12) and ids such as L99.1, E1, D12 or ABC-123. */
export const DEFAULT_REFERENCE_PATTERNS = [
  "(?<![\\w/&])#\\d+\\b",
  "\\b[A-Z]\\d+(?:\\.\\d+)*\\b",
  "\\b[A-Z]{2,10}-\\d+\\b",
];

const IMAGE_MD = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const IMAGE_HTML = /<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi;
/** A link to a GitHub Actions run, job or check run. Anchored: it is matched against one URL at a time. */
export const RUN_LINK =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:actions\/runs\/\d+(?:\/(?:job|attempts)\/\d+)*\/?(?:[?#].*)?$|runs\/\d+\/?(?:[?#].*)?$|pull\/\d+\/checks\?(?:.*&)?check_run_id=\d+)/;
/** A link to an artifact of a GitHub Actions run. */
export const ARTIFACT_LINK = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/artifacts\/\d+\/?$/;
const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"'`]+/g;
const REMOTE = /^https?:\/\//i;

/** The input of a structure check. */
export interface CheckInput {
  body: string;
  /** The pull request title, for PM008. */
  title?: string;
  /** A draft gets warnings only (with `drafts: "warn"`). */
  draft?: boolean;
  /** Local files given to `gh pr ... --attach`: an image with one of these paths is uploaded, so it counts. */
  attachments?: string[];
}

/** Finds the section that a required name stands for, by its heading or one of its aliases. */
function findSection(parsed: ParsedBody, name: string, aliases: string[]): Section | undefined {
  const wanted = new Set([name, ...aliases].map(normaliseHeading));
  return parsed.sections.find(s => wanted.has(normaliseHeading(s.title)));
}

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(stripInlineComments(text).replace(LIST_MARKER, "").trim());
}

/**
 * The prose of a section: what is left after removing code, URLs, images, link targets, Markdown syntax and the
 * reference patterns. PM003 measures this, so "Implements L99, see #3." is short whatever the references stand for.
 */
export function proseOf(lines: BodyLine[], referencePatterns: RegExp[]): string {
  let text = lines
    .filter(l => l.kind === "text")
    .map(l => stripInlineComments(l.text).replace(LIST_MARKER, ""))
    .filter(t => !isPlaceholder(t))
    .join(" ");
  text = text
    .replace(IMAGE_MD, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  for (const pattern of referencePatterns) text = text.replace(new RegExp(pattern.source, `${pattern.flags}g`), " ");
  return text
    .replace(/[*_~|>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The images of a line, markdown and HTML, with their 1-based column. */
function imagesOf(text: string): { src: string; column: number }[] {
  const out: { src: string; column: number }[] = [];
  for (const m of text.matchAll(IMAGE_MD)) out.push({ src: m[2], column: (m.index ?? 0) + 1 });
  for (const m of text.matchAll(IMAGE_HTML)) out.push({ src: m[1], column: (m.index ?? 0) + 1 });
  return out;
}

function isAttached(src: string, attachments: string[]): boolean {
  const clean = src.replace(/^\.\//, "");
  return attachments.some(a => a.replace(/^\.\//, "") === clean || a.endsWith(`/${clean}`));
}

/** The URLs in a line of text, without trailing punctuation. */
export function linksOf(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map(m => m[0].replace(/[.,;:!?]+$/, ""));
}

/** Whether a section's lines hold evidence of the kinds the configuration allows (PM004). */
export function hasEvidence(lines: BodyLine[], config: ResolvedConfig, attachments: string[] = []): boolean {
  const proof = config.sections.Proof;
  const kinds = new Set(proof.evidence ?? []);
  const extra = (proof.linkPatterns ?? []).map(p => compilePattern(p, "sections.Proof.linkPatterns"));
  let inBlock = false;
  let blockHasOutput = false;

  for (const line of lines) {
    if (line.kind === "fence") {
      if (inBlock && blockHasOutput && kinds.has("fenced-block")) return true;
      inBlock = !inBlock;
      blockHasOutput = false;
      continue;
    }
    if (line.kind === "code") {
      const t = line.text.trim();
      if (t !== "" && !t.startsWith("$ ") && t !== "$") blockHasOutput = true;
      continue;
    }
    if (line.kind !== "text") continue;
    const text = stripInlineComments(line.text);
    if (kinds.has("image") && imagesOf(text).some(i => REMOTE.test(i.src) || isAttached(i.src, attachments)))
      return true;
    for (const url of linksOf(text)) {
      if (kinds.has("artifact-link") && ARTIFACT_LINK.test(url)) return true;
      if (kinds.has("run-link") && RUN_LINK.test(url)) return true;
      if (extra.some(p => p.test(url))) return true;
    }
  }
  // An unclosed fence runs to the end of the body, as CommonMark reads it.
  return inBlock && blockHasOutput && kinds.has("fenced-block");
}

/** Whether a pull request title marks a breaking change (`feat!: ...`), as commit-it parses it. */
export function isBreakingTitle(title: string): boolean {
  const commit = ConventionalCommit.fromString({ hash: "title", message: title });
  return commit.isValid && commit.breaking === true;
}

/**
 * Runs the structure rules PM001-PM005, PM007 and PM008 on a body. PM006 needs the network and lives in the Action.
 * The result is sorted, with the configured levels and the draft downgrade applied: the same input gives the same
 * output, byte for byte.
 */
export function checkStructure(input: CheckInput, config: ResolvedConfig): Diagnostic[] {
  const parsed = parseBody(input.body);
  const out: Diagnostic[] = [];
  const add = (rule: string, line: number, column: number, message: string, hint?: string): void => {
    out.push({
      rule,
      level: RULES.find(r => r.id === rule)?.level ?? "error",
      line,
      column,
      message,
      hint,
      source: "pull-me",
    });
  };
  const referencePatterns = [...DEFAULT_REFERENCE_PATTERNS, ...(config.vale.referencePatterns ?? [])].map(p =>
    compilePattern(p, "vale.referencePatterns", "")
  );

  const found: { name: string; section: Section }[] = [];
  for (const name of REQUIRED_SECTIONS) {
    const settings = config.sections[name];
    const section = findSection(parsed, name, settings.aliases);
    if (!section) {
      add(
        "PM001",
        1,
        1,
        `The "${name}" section is missing.`,
        `Add a "## ${name}" heading with ${SECTION_PURPOSE[name]}.`
      );
      continue;
    }
    found.push({ name, section });
    const content = authorLines(section).filter(l => !(l.kind === "text" && isPlaceholder(l.text)));
    if (content.length === 0) {
      add(
        "PM002",
        section.line,
        1,
        `The "${name}" section is empty or holds only placeholders.`,
        `Write ${SECTION_PURPOSE[name]}.`
      );
      continue;
    }
    const prose = proseOf(section.lines, referencePatterns);
    if (settings.minChars > 0 && prose.length < settings.minChars) {
      add(
        "PM003",
        section.line,
        1,
        `The "${name}" section has ${prose.length} characters of prose; the minimum is ${settings.minChars}.`,
        `Say it in your own words: ${SECTION_PURPOSE[name]}. Code, links and references such as #12 do not count.`
      );
    }
    if (name === "Proof" && !hasEvidence(section.lines, config, input.attachments)) {
      add(
        "PM004",
        section.line,
        1,
        `The "Proof" section has no evidence.`,
        "Add a fenced block with the test output, a link to the CI run (.../actions/runs/<id>), or a screenshot: `pull-me attach <pr> shot.png`."
      );
    }
  }

  for (const line of parsed.lines) {
    if (line.kind !== "text" || line.ignore.includes("PM005")) continue;
    for (const image of imagesOf(stripInlineComments(line.text))) {
      if (REMOTE.test(image.src) || isAttached(image.src, input.attachments ?? [])) continue;
      add(
        "PM005",
        line.number,
        image.column,
        `The image "${image.src}" points to a local path; it will render broken on GitHub.`,
        `Upload it: \`pull-me attach <pr> ${image.src}\` (or \`gh pr edit <pr> --attach ${image.src}\`).`
      );
    }
  }

  const positions = found.map(f => f.section.line);
  const outOfOrder = found.find((f, i) => i > 0 && positions[i] < positions[i - 1]);
  if (outOfOrder) {
    add(
      "PM007",
      outOfOrder.section.line,
      1,
      `The sections are out of order: "${outOfOrder.name}" comes too early.`,
      `Use this order: ${REQUIRED_SECTIONS.join(", ")}.`
    );
  }

  if (input.title && isBreakingTitle(input.title) && !findSection(parsed, "Breaking changes", [])) {
    add(
      "PM008",
      1,
      1,
      'The title marks a breaking change, but there is no "Breaking changes" section.',
      'Add a "## Breaking changes" section: what breaks, for whom, and what users must change.'
    );
  }

  return applyLevels(out, config, input.draft === true);
}

/** Applies the configured levels (`levels: { "PM007": "off" }`) and, for a draft, turns errors into warnings. */
export function applyLevels(diagnostics: Diagnostic[], config: ResolvedConfig, draft: boolean): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const d of diagnostics) {
    const level = config.levels[d.rule] ?? d.level;
    if (level === "off") continue;
    result.push({ ...d, level: draft && config.drafts === "warn" ? "warning" : level });
  }
  return sortDiagnostics(result);
}

/** The pull request facts that decide whether PullMe checks it at all. */
export interface PullRequestFacts {
  author?: string;
  labels?: string[];
  draft?: boolean;
}

/** The reason to skip a pull request (an ignored author, the skip label, a draft with `drafts: "skip"`), or undefined. */
export function skipReason(pr: PullRequestFacts, config: ResolvedConfig): string | undefined {
  if (pr.author && config.ignoreAuthors.includes(pr.author)) return `the author ${pr.author} is in "ignoreAuthors"`;
  if (config.skipLabel && pr.labels?.includes(config.skipLabel))
    return `the pull request has the "${config.skipLabel}" label`;
  if (pr.draft && config.drafts === "skip") return 'the pull request is a draft and "drafts" is "skip"';
  return undefined;
}
