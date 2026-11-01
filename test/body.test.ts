/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  areaOf,
  generatedBlock,
  globToRegExp,
  groupCommits,
  insertScreenshots,
  parseAttachment,
  replaceGenerated,
  TEMPLATE,
} from "../src/body.js";
import { resolveConfig } from "../src/config.js";
import { GENERATED_END, GENERATED_START } from "../src/markdown.js";
import { checkStructure } from "../src/rules.js";

const commits = [
  { hash: "a1", subject: "chore: tidy" },
  { hash: "b2", subject: "fix(cli): handle an empty body" },
  { hash: "c3", subject: "feat(rules): add PM004" },
  { hash: "d4", subject: "not conventional" },
  { hash: "e5", subject: "docs: describe the rules" },
];
const files = [
  { path: "src/rules.ts", added: 10, removed: 2 },
  { path: "README.md", added: 1, removed: 0 },
  { path: "engine/core/a.c", added: 5, removed: 5 },
  { path: "docs/logo.png" },
];

describe("the template", () => {
  test("has the four sections, empty, so it fails PM002 until the author writes them", () => {
    expect(checkStructure({ body: TEMPLATE }, resolveConfig()).map(d => d.rule)).toEqual(Array(4).fill("PM002"));
  });
});

describe("the generated block", () => {
  test("globs and areas", () => {
    expect(globToRegExp("engine/**").test("engine/core/a.c")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(areaOf("engine/core/a.c", { engine: "engine/**" })).toBe("engine");
    expect(areaOf("src/rules.ts", {})).toBe("src");
    expect(areaOf("README.md", {})).toBe("(root)");
  });
  test("commits group as feat, fix, the rest alphabetically, then other", () => {
    expect(groupCommits(commits).map(([type]) => type)).toEqual(["feat", "fix", "chore", "docs", "other"]);
  });
  test("is sorted, has no clock, and lists checks only when given", () => {
    const block = generatedBlock({ commits, files, areas: { engine: "engine/**" } });
    expect(block.startsWith(GENERATED_START)).toBe(true);
    expect(block.endsWith(GENERATED_END)).toBe(true);
    expect(block).toContain("**engine** (+5 -5)");
    expect(block).toContain("- `docs/logo.png` +binary -binary");
    expect(block).not.toContain("### Checks");
    expect(block.indexOf("**(root)**")).toBeLessThan(block.indexOf("**src**"));
    const withChecks = generatedBlock({
      commits,
      files,
      areas: {},
      head: "0123456789",
      checks: [{ name: "Unit Tests", conclusion: "success", url: "https://github.com/o/r/actions/runs/1/job/2" }],
    });
    expect(withChecks).toContain("### Checks on 0123456");
    expect(withChecks).toContain("- [Unit Tests](https://github.com/o/r/actions/runs/1/job/2): success");
  });
  test("does not count as Proof evidence", () => {
    const block = generatedBlock({
      commits,
      files,
      areas: {},
      checks: [{ name: "CI", conclusion: "success", url: "https://github.com/o/r/actions/runs/1" }],
    });
    const body = TEMPLATE.replace(/<!-- The value[^>]*-->/, "x".repeat(90))
      .replace(/<!-- The implementation[^>]*-->/, "y".repeat(90))
      .replace(/<!-- Where the risk[^>]*-->/, "z".repeat(50));
    expect(checkStructure({ body: replaceGenerated(body, block) }, resolveConfig()).map(d => d.rule)).toEqual([
      "PM002",
    ]);
  });
  test("replaceGenerated keeps the author's text byte-identical", () => {
    const author = "## Why\r\n\r\nKeep  this   exactly.\n\n";
    const first = replaceGenerated(author, `${GENERATED_START}\nold\n${GENERATED_END}`);
    const second = replaceGenerated(`${first}\nAfter.\n`, `${GENERATED_START}\nnew\n${GENERATED_END}`);
    expect(second.startsWith("## Why\r\n\r\nKeep  this   exactly.")).toBe(true);
    expect(second).toContain("new");
    expect(second).not.toContain("old");
    expect(second.endsWith("\nAfter.\n")).toBe(true);
  });
});

describe("attachments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-me-attach-"));
  fs.writeFileSync(path.join(dir, "shot.png"), "png");
  fs.writeFileSync(path.join(dir, "notes.txt"), "text");
  fs.writeFileSync(path.join(dir, "huge.png"), Buffer.alloc(10 * 1024 * 1024 + 1));

  test("parseAttachment reads the alt text and checks type and size", () => {
    expect(parseAttachment("shot.png#The login error", dir)).toEqual({ path: "./shot.png", alt: "The login error" });
    expect(parseAttachment("./shot.png", dir)).toEqual({ path: "./shot.png", alt: "shot" });
    expect(() => parseAttachment("notes.txt", dir)).toThrow("only .png");
    expect(() => parseAttachment("missing.png", dir)).toThrow("no such file");
    expect(() => parseAttachment("huge.png", dir)).toThrow("10 MB");
  });

  test("insertScreenshots puts the images under ### Screenshots at the end of Proof", () => {
    const body = "## Why\n\nW.\n\n## Proof\n\n```\nok\n```\n\n## Follow-ups\n\n- more\n";
    const out = insertScreenshots(body, [{ path: "./shot.png", alt: "Login" }]);
    expect(out).toBe(
      "## Why\n\nW.\n\n## Proof\n\n```\nok\n```\n\n### Screenshots\n\n![Login](./shot.png)\n\n## Follow-ups\n\n- more\n"
    );
    const again = insertScreenshots(out, [{ path: "./two.png", alt: "Two" }]);
    expect(again.match(/### Screenshots/g)).toHaveLength(1);
    expect(again).toContain("![Two](./two.png)");
  });

  test("insertScreenshots adds a Proof section when there is none", () => {
    expect(insertScreenshots("## Why\n\nW.\n", [{ path: "./a.png", alt: "A" }])).toBe(
      "## Why\n\nW.\n\n## Proof\n\n### Screenshots\n\n![A](./a.png)\n"
    );
  });

  test("an image about to be attached passes PM005 when the check knows the attachment", () => {
    const body = insertScreenshots("## Proof\n", [{ path: "./shot.png", alt: "Shot" }]);
    const rules = (attachments: string[]): string[] =>
      checkStructure({ body, attachments }, resolveConfig())
        .filter(d => ["PM004", "PM005"].includes(d.rule))
        .map(d => d.rule);
    expect(rules([])).toEqual(["PM004", "PM005"]);
    expect(rules(["./shot.png"])).toEqual([]);
  });
});
