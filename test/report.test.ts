/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from "@jest/globals";

import { Diagnostic } from "../src/diagnostic.js";
import { COMMENT_MARKER, commentBody, LookupRun, runLinksInProof, summaryRows, verifyRunLinks } from "../src/report.js";

const BODY = [
  "## Why",
  "",
  "See https://github.com/o/r/actions/runs/1 (not in Proof).",
  "",
  "## Proof",
  "",
  "- [Unit Tests](https://github.com/o/r/actions/runs/10/job/11)",
  "- https://github.com/o/r/actions/runs/20",
  "- https://github.com/o/r/runs/30 and https://github.com/o/r/pull/5/checks?check_run_id=40",
  "- https://github.com/other/repo/actions/runs/50",
  "- `https://github.com/o/r/actions/runs/60` in code",
  "<!-- https://github.com/o/r/actions/runs/70 -->",
].join("\n");

describe("run links (PM006)", () => {
  test("only the links in Proof, outside comments (a link in a code span still counts)", () => {
    expect(runLinksInProof(BODY).map(l => `${l.line}:${l.kind}:${l.id}:${l.owner}/${l.repo}`)).toEqual([
      "7:job:11:o/r",
      "8:run:20:o/r",
      "9:check-run:30:o/r",
      "9:check-run:40:o/r",
      "10:run:50:other/repo",
      "11:run:60:o/r",
    ]);
  });

  test("warns on another repository, a missing run and a failed run; a running one is fine", async () => {
    const results: Record<number, { conclusion: string | null } | undefined> = {
      11: { conclusion: "success" },
      20: { conclusion: "failure" },
      30: undefined,
      40: { conclusion: null },
      60: { conclusion: "skipped" },
    };
    const lookup: LookupRun = async link => results[link.id];
    const found = await verifyRunLinks(BODY, "O", "r", lookup);
    expect(found.map(d => `${d.line}:${d.rule}:${d.level}`)).toEqual([
      "8:PM006:warning",
      "9:PM006:warning",
      "10:PM006:warning",
    ]);
    expect(found[0].message).toContain("did not succeed (failure)");
    expect(found[1].message).toContain("cannot be found");
    expect(found[2].message).toContain("another repository");
  });

  test("a lookup that throws counts as not found", async () => {
    const found = await verifyRunLinks("## Proof\n\nhttps://github.com/o/r/actions/runs/1\n", "o", "r", async () => {
      throw new Error("404");
    });
    expect(found.map(d => d.message)).toEqual([
      "The linked run https://github.com/o/r/actions/runs/1 cannot be found.",
    ]);
  });
});

describe("summary and comment", () => {
  const d = (rule: string, level: "error" | "warning", source: "pull-me" | "vale" = "pull-me"): Diagnostic => ({
    rule,
    level,
    line: 3,
    column: 1,
    message: "m",
    source,
  });

  test("the summary lists every rule of PullMe and the Vale rules that raised something", () => {
    const rows = summaryRows([
      d("PM004", "error"),
      d("DevBuildDeploy.Weasel", "warning", "vale"),
      d("PM007", "warning"),
    ]);
    expect(rows.find(r => r[0] === "PM001")?.[2]).toBe("✅");
    expect(rows.find(r => r[0] === "PM004")?.[2]).toBe("❌ 1");
    expect(rows.find(r => r[0] === "PM007")?.[2]).toBe("⚠️ 1");
    expect(rows[rows.length - 1]).toEqual(["DevBuildDeploy.Weasel", "Vale prose rule", "⚠️ 1"]);
  });

  test("the comment carries the marker, the counts, each finding and the run link", () => {
    const text = commentBody([d("PM004", "error")], "https://github.com/o/r/actions/runs/1");
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text).toContain("1 error and 0 warnings");
    expect(text).toContain("- ❌ Line 3: [PM004] m");
    expect(text).toContain("[The check run](https://github.com/o/r/actions/runs/1)");
  });
});
