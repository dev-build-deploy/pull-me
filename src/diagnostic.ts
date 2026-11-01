/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

/** How serious a finding is. Errors fail the check; warnings only report. */
export type Level = "error" | "warning";

/** One finding about a pull request description, from PullMe's own rules or from Vale. */
export interface Diagnostic {
  /** The rule id: "PM004", or the Vale rule name ("DevBuildDeploy.SentenceLength"). */
  rule: string;
  level: Level;
  /** 1-based line and column in the body. */
  line: number;
  column: number;
  /** What is wrong, in one sentence. */
  message: string;
  /** How to fix it. */
  hint?: string;
  /** Which checker found it. */
  source: "pull-me" | "vale";
}

/** Sorts diagnostics by line, then column, then rule: the same input always gives the same order. */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
}

/** Counts the errors and warnings in a list of diagnostics. */
export function countLevels(diagnostics: Diagnostic[]): { errors: number; warnings: number } {
  const errors = diagnostics.filter(d => d.level === "error").length;
  return { errors, warnings: diagnostics.length - errors };
}
