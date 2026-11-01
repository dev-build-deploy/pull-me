/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The kinds of evidence that satisfy the Proof section (PM004). */
export type EvidenceKind = "image" | "run-link" | "artifact-link" | "fenced-block";

/** Settings of one required section. */
export interface SectionConfig {
  /** Minimum number of prose characters (PM003); 0 turns the check off. */
  minChars?: number;
  /** Other headings that count as this section ("Review notes" for "Review hints"). */
  aliases?: string[];
  /** Proof only: the evidence kinds that count. */
  evidence?: EvidenceKind[];
  /** Proof only: extra regular expressions for links that count as evidence (an external CI, for example). */
  linkPatterns?: string[];
}

/** The level a rule reports at, or "off". */
export type RuleLevel = "error" | "warning" | "off";

/** Settings for the prose checks that Vale runs. */
export interface ValeConfig {
  /** false: do not run Vale at all. */
  enabled?: boolean;
  /** A path to the repository's own `.vale.ini`, which replaces the one PullMe ships. */
  config?: string;
  /** Vale rules on, off or at another level: `{ "DevBuildDeploy.SentenceLength": "off" }`. */
  rules?: Record<string, RuleLevel | "suggestion">;
  /** Extra glossary terms of this repository: the term and its explanation. */
  glossary?: Record<string, string>;
  /** A Markdown glossary file in the repository (`- **term**: explanation`, one per line). */
  glossaryFile?: string;
  /** Extra regular expressions for internal references ("L12", "decision 4") that must not stand alone. */
  referencePatterns?: string[];
  /** Abbreviations every reader knows, so they need no explanation. */
  abbreviations?: string[];
}

/** The settings of the GitHub Action. */
export interface GitHubActionConfig {
  /** "on-failure": a sticky comment while the check fails; "never": annotations and the job summary only. */
  comment?: "on-failure" | "never";
  /** Look up each linked CI run and warn when it is not in this repository or did not succeed (PM006). */
  verifyRunLinks?: boolean;
}

/** The contents of `.pull-me.json`. Every field is optional; the defaults are in DEFAULT_CONFIG. */
export interface PullMeConfig {
  sections?: Record<string, SectionConfig>;
  optional?: string[];
  drafts?: "warn" | "check" | "skip";
  ignoreAuthors?: string[];
  skipLabel?: string;
  levels?: Record<string, RuleLevel>;
  areas?: Record<string, string>;
  vale?: ValeConfig;
  githubAction?: GitHubActionConfig;
}

/** A configuration with every default filled in. */
export interface ResolvedConfig {
  sections: Record<string, Required<Pick<SectionConfig, "minChars" | "aliases">> & SectionConfig>;
  optional: string[];
  drafts: "warn" | "check" | "skip";
  ignoreAuthors: string[];
  skipLabel: string;
  levels: Record<string, RuleLevel>;
  areas: Record<string, string>;
  vale: ValeConfig;
  githubAction: Required<GitHubActionConfig>;
}

/** The four required sections, in their order. */
export const REQUIRED_SECTIONS = ["Why", "How", "Review hints", "Proof"] as const;

/** The file names PullMe looks for, in order (the same lookup as commit-me). */
export const CONFIG_FILES = [".pull-me.json", ".github/.pull-me.json"];

/** The defaults: what a repository without `.pull-me.json` gets. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  sections: {
    Why: { minChars: 80, aliases: [] },
    How: { minChars: 80, aliases: [] },
    "Review hints": { minChars: 40, aliases: ["Review notes"] },
    Proof: {
      minChars: 0,
      aliases: [],
      evidence: ["image", "run-link", "artifact-link", "fenced-block"],
      linkPatterns: [],
    },
  },
  optional: ["Stacked on", "Breaking changes", "Follow-ups"],
  drafts: "warn",
  ignoreAuthors: ["dependabot[bot]"],
  skipLabel: "no-pull-me",
  levels: {},
  areas: {},
  vale: { enabled: true },
  githubAction: { comment: "on-failure", verifyRunLinks: true },
};

/** Thrown when `.pull-me.json` cannot be read or holds a wrong value. */
export class ConfigError extends Error {}

function assertStrings(value: unknown, field: string): void {
  if (value !== undefined && !(Array.isArray(value) && value.every(v => typeof v === "string"))) {
    throw new ConfigError(`"${field}" must be a list of strings`);
  }
}

/** Checks the shape of a parsed `.pull-me.json`; throws ConfigError with the field at fault. */
export function validateConfig(raw: unknown): PullMeConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ConfigError("the file must hold an object");
  const config = raw as PullMeConfig;
  for (const [name, section] of Object.entries(config.sections ?? {})) {
    if (section.minChars !== undefined && (typeof section.minChars !== "number" || section.minChars < 0)) {
      throw new ConfigError(`"sections.${name}.minChars" must be a number of 0 or more`);
    }
    assertStrings(section.aliases, `sections.${name}.aliases`);
    assertStrings(section.linkPatterns, `sections.${name}.linkPatterns`);
    for (const p of section.linkPatterns ?? []) compilePattern(p, `sections.${name}.linkPatterns`);
  }
  assertStrings(config.optional, "optional");
  assertStrings(config.ignoreAuthors, "ignoreAuthors");
  if (config.drafts !== undefined && !["warn", "check", "skip"].includes(config.drafts)) {
    throw new ConfigError(`"drafts" must be "warn", "check" or "skip"`);
  }
  for (const [rule, level] of Object.entries(config.levels ?? {})) {
    if (!["error", "warning", "off"].includes(level))
      throw new ConfigError(`"levels.${rule}" must be error, warning or off`);
  }
  assertStrings(config.vale?.referencePatterns, "vale.referencePatterns");
  assertStrings(config.vale?.abbreviations, "vale.abbreviations");
  return config;
}

/** Compiles a pattern from the configuration; throws ConfigError naming the field when it is not a valid expression. */
export function compilePattern(pattern: string, field: string, flags = "i"): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new ConfigError(`"${field}": ${(error as Error).message}`);
  }
}

/** Merges a repository's configuration over the defaults. Sections merge field by field; lists replace. */
export function resolveConfig(config: PullMeConfig = {}): ResolvedConfig {
  const sections: ResolvedConfig["sections"] = {};
  for (const [name, defaults] of Object.entries(DEFAULT_CONFIG.sections)) {
    sections[name] = { ...defaults, ...(config.sections?.[name] ?? {}) };
  }
  return {
    sections,
    optional: config.optional ?? DEFAULT_CONFIG.optional,
    drafts: config.drafts ?? DEFAULT_CONFIG.drafts,
    ignoreAuthors: config.ignoreAuthors ?? DEFAULT_CONFIG.ignoreAuthors,
    skipLabel: config.skipLabel ?? DEFAULT_CONFIG.skipLabel,
    levels: { ...DEFAULT_CONFIG.levels, ...(config.levels ?? {}) },
    areas: config.areas ?? DEFAULT_CONFIG.areas,
    vale: { ...DEFAULT_CONFIG.vale, ...(config.vale ?? {}) },
    githubAction: { ...DEFAULT_CONFIG.githubAction, ...(config.githubAction ?? {}) },
  };
}

/** Finds the configuration file of the repository at `root`: the explicit path, else the first of CONFIG_FILES. */
export function findConfigFile(root: string, explicit?: string): string | undefined {
  if (explicit) return path.resolve(root, explicit);
  return CONFIG_FILES.map(f => path.join(root, f)).find(f => fs.existsSync(f));
}

/** Reads, checks and resolves the configuration of the repository at `root`. */
export function loadConfig(root: string, explicit?: string): ResolvedConfig {
  const file = findConfigFile(root, explicit);
  if (!file) return resolveConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`${path.relative(root, file) || file}: ${(error as Error).message}`);
  }
  try {
    return resolveConfig(validateConfig(raw));
  } catch (error) {
    throw new ConfigError(`${path.relative(root, file) || file}: ${(error as Error).message}`);
  }
}
