/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, test } from "@jest/globals";

import { resolveConfig } from "../src/config.js";
import { parseBody } from "../src/markdown.js";
import { checkStructure, CheckInput, isBreakingTitle, proseOf, skipReason } from "../src/rules.js";

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const rules = (body: string, extra: Partial<CheckInput> = {}): string[] =>
  checkStructure({ body, ...extra }, resolveConfig()).map(d => `${d.rule}:${d.level}`);

const GOOD = read("pass/fenced-output.md");

describe("passing bodies", () => {
  for (const file of fs.readdirSync(path.join(FIXTURES, "pass"))) {
    test(file, () => {
      expect(checkStructure({ body: read(`pass/${file}`) }, resolveConfig())).toEqual([]);
    });
  }
});

describe("failing bodies", () => {
  const expected: Record<string, string[]> = {
    "missing-proof.md": ["PM001:error"],
    "template-only.md": ["PM002:error", "PM002:error", "PM002:error", "PM002:error"],
    "placeholders.md": ["PM002:error", "PM002:error", "PM002:error", "PM002:error"],
    "local-image.md": ["PM004:error", "PM005:error"],
    "prose-proof.md": ["PM004:error"],
    "bare-references.md": ["PM003:error", "PM003:error", "PM003:error"],
    "out-of-order.md": ["PM007:warning"],
  };
  test("every failing fixture has an expectation", () => {
    expect(fs.readdirSync(path.join(FIXTURES, "fail")).sort()).toEqual(Object.keys(expected).sort());
  });
  for (const [file, want] of Object.entries(expected)) {
    test(file, () => {
      expect(rules(read(`fail/${file}`))).toEqual(want);
    });
  }
});

describe("PM001", () => {
  test("an empty body misses all four sections", () => {
    expect(rules("")).toEqual(["PM001:error", "PM001:error", "PM001:error", "PM001:error"]);
  });
  test("headings match case-insensitively and with a trailing colon", () => {
    expect(rules(GOOD.replace("## Why", "## WHY:").replace("## How", "## **how**"))).toEqual([]);
  });
  test("a level-3 heading is not a section", () => {
    expect(rules(GOOD.replace("## Proof", "### Proof"))).toContain("PM001:error");
  });
  test("a heading inside a fenced block is not a section", () => {
    const body = "```\n## Why\n## How\n## Review hints\n## Proof\n```\n";
    expect(rules(body).filter(r => r.startsWith("PM001"))).toHaveLength(4);
  });
  test("the message names the section and the hint says what belongs there", () => {
    const [d] = checkStructure({ body: GOOD.replace("## Review hints", "## Notes") }, resolveConfig());
    expect(d.message).toBe('The "Review hints" section is missing.');
    expect(d.hint).toContain("what is not covered");
  });
});

describe("PM003", () => {
  test("prose drops code, links, URLs and references", () => {
    const parsed = parseBody("## Why\nImplements [L99](https://x.y/z), see #3 and `a.ts` https://example.com.\n");
    expect(proseOf(parsed.sections[0].lines, [/\bL\d+\b/, /#\d+/])).toBe("Implements , see and");
  });
  test("minChars comes from the configuration; 0 turns it off", () => {
    const body = GOOD.replace(/## Why\n[\s\S]*?## How/, "## Why\n\nShort but real.\n\n## How");
    expect(rules(body)).toEqual(["PM003:error"]);
    const off = resolveConfig({ sections: { Why: { minChars: 0 } } });
    expect(checkStructure({ body }, off)).toEqual([]);
  });
});

describe("PM004", () => {
  const withProof = (proof: string): string =>
    GOOD.replace(/## Proof[\s\S]*?## Follow-ups/, `## Proof\n\n${proof}\n\n## Follow-ups`);
  test.each([
    ["an image", "![shot](https://github.com/user-attachments/assets/abc)"],
    ["an HTML image", '<img src="https://github.com/user-attachments/assets/abc" width="400">'],
    ["a run link", "[CI](https://github.com/o/r/actions/runs/123)"],
    ["a job link", "https://github.com/o/r/actions/runs/123/job/456"],
    ["a check-run link", "https://github.com/o/r/runs/789"],
    ["a checks tab link", "https://github.com/o/r/pull/5/checks?check_run_id=789"],
    ["an artifact link", "https://github.com/o/r/actions/runs/123/artifacts/9"],
    ["a fenced block with output", "```\nok 3 tests\n```"],
    ["an unclosed fence with output", "```\nok 3 tests"],
  ])("%s counts as evidence", (_, proof) => {
    expect(rules(withProof(proof))).toEqual([]);
  });
  test.each([
    ["prose with numbers", "Coverage went from 42% to 46%."],
    ["a fenced block with commands only", "```\n$ npm test\n$ npm run lint\n```"],
    ["a link to a pull request", "https://github.com/o/r/pull/5"],
    ["a link to another site", "https://ci.example.com/build/42"],
    ["a run link inside another site's URL", "https://evil.example/?u=https://github.com/o/r/actions/runs/123"],
    ["an image in a comment", "It works. <!-- ![shot](https://github.com/user-attachments/assets/abc) -->"],
  ])("%s is not evidence", (_, proof) => {
    expect(rules(withProof(proof))).toEqual(["PM004:error"]);
  });
  test("extra link patterns from the configuration count", () => {
    const config = resolveConfig({ sections: { Proof: { linkPatterns: ["^https://ci\\.example\\.com/build/\\d+"] } } });
    expect(checkStructure({ body: withProof("https://ci.example.com/build/42") }, config)).toEqual([]);
  });
  test("the evidence kinds can be narrowed", () => {
    const config = resolveConfig({ sections: { Proof: { evidence: ["image"] } } });
    expect(checkStructure({ body: GOOD }, config).map(d => d.rule)).toEqual(["PM004"]);
  });
});

describe("PM005", () => {
  const body = read("fail/local-image.md");
  test("points at the line and column of the image", () => {
    const d = checkStructure({ body }, resolveConfig()).find(x => x.rule === "PM005");
    expect(d).toMatchObject({ line: body.split("\n").findIndex(l => l.startsWith("![")) + 1, column: 1 });
    expect(d?.hint).toContain("pull-me attach");
  });
  test("an image that is also given to --attach counts and is not local", () => {
    expect(rules(body, { attachments: ["screenshots/overview.png"] })).toEqual([]);
  });
  test("an image inside a code span is an example, not an image", () => {
    expect(rules(GOOD.replace("Read `limiter.ts` first.", "Write `![alt](./shot.png)` first."))).toEqual([]);
  });
  test("a trailing pull-me-ignore comment skips the rule on that line", () => {
    const ignored = body.replace(".png)", ".png) <!-- pull-me-ignore PM005 -->");
    expect(rules(ignored)).toEqual(["PM004:error"]);
  });
});

describe("PM008", () => {
  test("a breaking title needs a Breaking changes section", () => {
    expect(rules(GOOD, { title: "feat(api)!: drop the v1 endpoints" })).toEqual(["PM008:warning"]);
    expect(rules(`${GOOD}\n## Breaking changes\n\nThe v1 endpoints are gone.\n`, { title: "feat!: x" })).toEqual([]);
  });
  test("titles are parsed with commit-it", () => {
    expect(isBreakingTitle("fix!: x")).toBe(true);
    expect(isBreakingTitle("fix: x")).toBe(false);
    expect(isBreakingTitle("Not a conventional title!")).toBe(false);
  });
});

describe("levels, drafts and skipping", () => {
  test("a draft gets warnings only", () => {
    expect(rules("", { draft: true })).toEqual(Array(4).fill("PM001:warning"));
  });
  test('"drafts": "check" checks a draft as a ready pull request', () => {
    const config = resolveConfig({ drafts: "check" });
    expect(checkStructure({ body: "", draft: true }, config).every(d => d.level === "error")).toBe(true);
  });
  test("levels switch rules off or change their level", () => {
    const config = resolveConfig({ levels: { PM007: "off", PM004: "warning" } });
    expect(checkStructure({ body: read("fail/out-of-order.md") }, config)).toEqual([]);
    expect(checkStructure({ body: read("fail/prose-proof.md") }, config).map(d => d.level)).toEqual(["warning"]);
  });
  test("the same input gives the same output", () => {
    const body = read("fail/local-image.md");
    expect(JSON.stringify(checkStructure({ body }, resolveConfig()))).toBe(
      JSON.stringify(checkStructure({ body }, resolveConfig()))
    );
  });
  test("skipReason: ignored authors, the skip label, drafts with skip", () => {
    const config = resolveConfig();
    expect(skipReason({ author: "dependabot[bot]" }, config)).toContain("ignoreAuthors");
    expect(skipReason({ labels: ["no-pull-me"] }, config)).toContain("no-pull-me");
    expect(skipReason({ author: "someone", labels: ["bug"], draft: true }, config)).toBeUndefined();
    expect(skipReason({ draft: true }, resolveConfig({ drafts: "skip" }))).toContain("draft");
  });
});

describe("Windows line ends", () => {
  test("CRLF bodies parse like LF bodies", () => {
    expect(rules(GOOD.replace(/\n/g, "\r\n"))).toEqual([]);
  });
});

// Real pull request bodies from a private repository cannot be committed to this public one. Point this variable at a
// folder of `<n>.md` files (the body, optionally after a first `# title` line) to check them locally.
const REAL = process.env.PULL_ME_REAL_BODIES;
(REAL ? describe : describe.skip)("real bodies (PULL_ME_REAL_BODIES)", () => {
  const dir = REAL ?? "";
  for (const file of REAL
    ? fs
        .readdirSync(dir)
        .filter(f => f.endsWith(".md"))
        .sort()
    : []) {
    test(file, () => {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const [first, ...rest] = text.split("\n");
      const title = first.startsWith("# ") ? first.slice(2).replace(/ draft=\w+$/, "") : undefined;
      const body = title ? rest.join("\n") : text;
      const found = checkStructure({ body, title }, resolveConfig()).map(d => `${d.rule} ${d.message}`);
      console.log(`${file}: ${found.length === 0 ? "pass" : found.join("; ")}`);
      expect(Array.isArray(found)).toBe(true);
    });
  }
});
