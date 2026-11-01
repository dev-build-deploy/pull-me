/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { DiagnosticsMessage } from "@dev-build-deploy/diagnose-it";

import { countLevels, Diagnostic } from "./diagnostic.js";
import { VERSION } from "./version.js";

/** One diagnostic as diagnose-it prints it: `file:line:col: level: [rule] message`, the line, and the hint. */
export function formatOne(d: Diagnostic, file: string, lines: string[]): string {
  const text = `[${d.rule}] ${d.message}`;
  const message =
    d.level === "error"
      ? DiagnosticsMessage.createError(file, { text, linenumber: d.line, column: d.column })
      : DiagnosticsMessage.createWarning(file, { text, linenumber: d.line, column: d.column });
  const context = lines[d.line - 1];
  if (context !== undefined && context.trim() !== "") message.setContext(d.line, context);
  return `${message.toString()}${d.hint ? `\n  hint: ${d.hint}` : ""}`;
}

/** The one-line summary after the diagnostics. */
export function summaryLine(diagnostics: Diagnostic[]): string {
  const { errors, warnings } = countLevels(diagnostics);
  if (errors === 0 && warnings === 0) return "The pull request description passes every check.";
  return `Found ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"} in the pull request description.`;
}

/** The text report: every diagnostic with its context, then the summary. */
export function formatText(diagnostics: Diagnostic[], file: string, body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  return [...diagnostics.map(d => formatOne(d, file, lines)), summaryLine(diagnostics)].join("\n\n") + "\n";
}

/** The JSON report for other tools. */
export function formatJson(diagnostics: Diagnostic[], skipped?: string): string {
  return `${JSON.stringify({ tool: "pull-me", version: VERSION, ...countLevels(diagnostics), skipped, diagnostics })}\n`;
}

/**
 * The report for the Claude Code plugin: JSON with the counts and a compact text (no colours, no context lines), so the
 * hook can decide on errors and warnings and quote the text in its denial.
 */
export function formatHook(diagnostics: Diagnostic[]): string {
  const text = diagnostics
    .map(d => `line ${d.line}: ${d.level}: [${d.rule}] ${d.message}${d.hint ? ` Fix: ${d.hint}` : ""}`)
    .join("\n");
  return `${JSON.stringify({ ...countLevels(diagnostics), text })}\n`;
}
