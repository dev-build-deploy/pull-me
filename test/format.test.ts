/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from "@jest/globals";

import { Diagnostic } from "../src/diagnostic.js";
import { formatHook, formatJson, formatText, summaryLine } from "../src/format.js";

const error: Diagnostic = {
  rule: "PM004",
  level: "error",
  line: 2,
  column: 1,
  message: 'The "Proof" section has no evidence.',
  hint: "Add a fenced block.",
  source: "pull-me",
};
const warning: Diagnostic = {
  ...error,
  rule: "DevBuildDeploy.Weasel",
  level: "warning",
  message: "very",
  hint: undefined,
  source: "vale",
};
const strip = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, ""); // eslint-disable-line no-control-regex

describe("formats", () => {
  test("text: diagnose-it's file:line:col, the context line, the hint and the summary", () => {
    const out = strip(formatText([error, warning], "body.md", "## Why\n## Proof\n"));
    expect(out).toContain('body.md:2:1: error: [PM004] The "Proof" section has no evidence.');
    expect(out).toContain("2 | ## Proof");
    expect(out).toContain("hint: Add a fenced block.");
    expect(out).toContain("body.md:2:1: warning: [DevBuildDeploy.Weasel] very");
    expect(out.trimEnd().endsWith("Found 1 error and 1 warning in the pull request description.")).toBe(true);
  });
  test("summary when clean", () => {
    expect(summaryLine([])).toBe("The pull request description passes every check.");
  });
  test("json: counts and the diagnostics", () => {
    const out = JSON.parse(formatJson([error, warning]));
    expect(out).toMatchObject({ tool: "pull-me", errors: 1, warnings: 1 });
    expect(out.diagnostics).toHaveLength(2);
    expect(JSON.parse(formatJson([], "a reason")).skipped).toBe("a reason");
  });
  test("hook: counts and a compact text without colours", () => {
    const out = JSON.parse(formatHook([error]));
    expect(out).toEqual({
      errors: 1,
      warnings: 0,
      text: 'line 2: error: [PM004] The "Proof" section has no evidence. Fix: Add a fenced block.',
    });
  });
});
