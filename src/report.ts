/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { countLevels, Diagnostic } from "./diagnostic.js";
import { authorLines, normaliseHeading, parseBody } from "./markdown.js";
import { linksOf, RULES, RUN_LINK } from "./rules.js";

/** The hidden marker that identifies PullMe's own comment on a pull request. */
export const COMMENT_MARKER = "<!-- pull-me:comment -->";

/** The title of PullMe's annotations. */
export const ANNOTATION_TITLE = "Pull request description";

/** The annotation text of one diagnostic: the line, the rule, the message and the hint. */
export function annotationText(d: Diagnostic): string {
  return `Line ${d.line}: [${d.rule}] ${d.message}${d.hint ? ` ${d.hint}` : ""}`;
}

/** The rows of the job summary: each of PullMe's rules, then each Vale rule that raised something. */
export function summaryRows(diagnostics: Diagnostic[]): string[][] {
  const status = (rule: string): string => {
    const found = diagnostics.filter(d => d.rule === rule);
    if (found.some(d => d.level === "error")) return `❌ ${found.length}`;
    if (found.length > 0) return `⚠️ ${found.length}`;
    return "✅";
  };
  const rows = RULES.map(r => [r.id, r.summary, status(r.id)]);
  const vale = [...new Set(diagnostics.filter(d => d.source === "vale").map(d => d.rule))].sort();
  for (const rule of vale) rows.push([rule, "Vale prose rule", status(rule)]);
  return rows;
}

/** The text of the sticky comment while the check fails. */
export function commentBody(diagnostics: Diagnostic[], runUrl?: string): string {
  const { errors, warnings } = countLevels(diagnostics);
  const lines = [
    COMMENT_MARKER,
    `### PullMe: the pull request description needs work`,
    "",
    `${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}. Edit the description; this comment goes away once the check passes.`,
    "",
    ...diagnostics.map(d => `- ${d.level === "error" ? "❌" : "⚠️"} ${annotationText(d)}`),
    "",
    "Every description has four sections: **Why** (the value, for whom), **How** (the choices and why), **Review hints** (risks, what to read first, what is not covered) and **Proof** (test output, links to runs, screenshots). Write for a junior engineer new to the repository.",
  ];
  if (runUrl) lines.push("", `[The check run](${runUrl})`);
  return lines.join("\n");
}

/** A run link in a body, as PM006 looks it up. */
export interface RunLink {
  url: string;
  line: number;
  owner: string;
  repo: string;
  kind: "run" | "job" | "check-run";
  id: number;
}

/** Finds the run, job and check-run links in the Proof section; comments and fenced blocks are skipped. */
export function runLinksInProof(body: string): RunLink[] {
  const proof = parseBody(body).sections.find(s => normaliseHeading(s.title) === "proof");
  if (!proof) return [];
  const out: RunLink[] = [];
  for (const line of authorLines(proof).filter(l => l.kind === "text")) {
    for (const url of linksOf(line.text)) {
      if (!RUN_LINK.test(url)) continue;
      const m =
        /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:actions\/runs\/(\d+)(?:\/job\/(\d+))?|runs\/(\d+)|pull\/\d+\/checks\?(?:.*&)?check_run_id=(\d+))/.exec(
          url
        );
      if (!m) continue;
      const [, owner, repo, run, job, checkRun, checkRunQuery] = m;
      if (job) out.push({ url, line: line.number, owner, repo, kind: "job", id: Number(job) });
      else if (run) out.push({ url, line: line.number, owner, repo, kind: "run", id: Number(run) });
      else out.push({ url, line: line.number, owner, repo, kind: "check-run", id: Number(checkRun ?? checkRunQuery) });
    }
  }
  return out;
}

/** The outcome of looking up one link: its conclusion (null while running), or undefined when it was not found. */
export type LookupRun = (link: RunLink) => Promise<{ conclusion: string | null } | undefined>;

/** Conclusions that count as a run that worked. */
const GOOD_CONCLUSIONS = ["success", "skipped", "neutral"];

/**
 * PM006: warns when a linked run is in another repository, cannot be found, or finished without success. A run that
 * is still going is fine: a pull request often links its own CI while it runs.
 */
export async function verifyRunLinks(
  body: string,
  owner: string,
  repo: string,
  lookup: LookupRun
): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const warn = (link: RunLink, message: string): void => {
    out.push({
      rule: "PM006",
      level: "warning",
      line: link.line,
      column: 1,
      message,
      source: "pull-me",
      hint: "Link the run of this pull request's own checks.",
    });
  };
  for (const link of runLinksInProof(body)) {
    if (link.owner.toLowerCase() !== owner.toLowerCase() || link.repo.toLowerCase() !== repo.toLowerCase()) {
      warn(link, `The linked run ${link.url} is in another repository (${link.owner}/${link.repo}).`);
      continue;
    }
    const found = await lookup(link).catch(() => undefined);
    if (!found) warn(link, `The linked run ${link.url} cannot be found.`);
    else if (found.conclusion !== null && !GOOD_CONCLUSIONS.includes(found.conclusion)) {
      warn(link, `The linked run ${link.url} did not succeed (${found.conclusion}).`);
    }
  }
  return out;
}
