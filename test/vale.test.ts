/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { beforeAll, describe, expect, test } from "@jest/globals";

import { check } from "../src/check.js";
import { resolveConfig } from "../src/config.js";
import { GENERATED_END, GENERATED_START } from "../src/markdown.js";
import {
  bodyForVale,
  mapAlerts,
  parseGlossary,
  platformAsset,
  resolveVale,
  runVale,
  VALE_CHECKSUMS,
  VALE_VERSION,
  verifyChecksum,
  writeValeConfig,
} from "../src/vale.js";

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "pull-me-test-"));

describe("the pinned Vale release", () => {
  test("every supported platform has a checksum", () => {
    expect(platformAsset("linux", "x64")).toBe("Linux_64-bit.tar.gz");
    expect(platformAsset("darwin", "arm64")).toBe("macOS_arm64.tar.gz");
    expect(platformAsset("win32", "x64")).toBe("Windows_64-bit.zip");
    expect(Object.values(VALE_CHECKSUMS).every(sum => /^[0-9a-f]{64}$/.test(sum))).toBe(true);
    expect(() => platformAsset("aix", "ppc64")).toThrow("no Vale release");
  });
  test("an archive with another checksum is refused", () => {
    expect(() => verifyChecksum(Buffer.from("not vale"), "Linux_64-bit.tar.gz")).toThrow("checksum mismatch");
  });
});

describe("configuration", () => {
  test("parseGlossary reads `- **term**: explanation` lines only", () => {
    expect(parseGlossary("# Title\n\n- **fixture**: a recorded week\n* **beat** - a story step\nplain line\n")).toEqual(
      {
        fixture: "a recorded week",
        beat: "a story step",
      }
    );
  });
  test("writeValeConfig fills in references, glossary terms, abbreviations and levels", () => {
    const work = tmp();
    const config = resolveConfig({
      vale: {
        referencePatterns: ["\\bRFC-\\d+\\b"],
        abbreviations: ["KPI"],
        rules: { "DevBuildDeploy.Weasel": "off" },
      },
    });
    const ini = writeValeConfig(work, config, work, { fixture: "a recorded week", OFL: "open font licence" });
    const styles = path.join(work, "styles", "DevBuildDeploy");
    expect(fs.readFileSync(path.join(styles, "BareReferences.yml"), "utf8")).toContain("\\bRFC-\\d+\\b");
    expect(fs.readFileSync(path.join(styles, "BareReferences.yml"), "utf8")).not.toContain("REFERENCE");
    expect(fs.readFileSync(path.join(styles, "Glossary.yml"), "utf8")).toContain("(fixture|OFL)");
    expect(fs.readFileSync(path.join(styles, "Abbreviations.yml"), "utf8")).toMatch(/- 'KPI'\n {2}- 'OFL'\n$/);
    const text = fs.readFileSync(ini, "utf8");
    expect(text).toContain(`StylesPath = ${path.join(work, "styles")}`);
    expect(text).toContain("DevBuildDeploy.Readability = NO");
    expect(text).toContain("DevBuildDeploy.Weasel = NO");
  });
  test("a repository's own .vale.ini replaces the shipped one", () => {
    const work = tmp();
    expect(writeValeConfig(work, resolveConfig({ vale: { config: "docs/.vale.ini" } }), "/repo", {})).toBe(
      "/repo/docs/.vale.ini"
    );
    expect(fs.readdirSync(work)).toEqual([]);
  });
  test("the generated block is blanked, keeping the line numbers", () => {
    const body = `## How\n\nText.\n${GENERATED_START}\nSee #3.\n${GENERATED_END}\nEnd.`;
    expect(bodyForVale(body).split("\n")).toEqual(["## How", "", "Text.", "", "", "", "End."]);
  });
  test("mapAlerts maps severities and quotes the glossary in the hint", () => {
    const [glossary, bare] = mapAlerts(
      [
        {
          Check: "DevBuildDeploy.Glossary",
          Line: 3,
          Span: [5, 11],
          Message: "Explain it",
          Severity: "warning",
          Match: "Fixture",
        },
        {
          Check: "DevBuildDeploy.BareReferences",
          Line: 4,
          Span: [1, 7],
          Message: "bare",
          Severity: "error",
          Match: "See #3",
        },
      ],
      { fixture: "a recorded week of events" }
    );
    expect(glossary).toMatchObject({
      rule: "DevBuildDeploy.Glossary",
      level: "warning",
      line: 3,
      column: 5,
      source: "vale",
    });
    expect(glossary.hint).toContain("a recorded week of events");
    expect(bare.level).toBe("error");
  });
});

// These run the real Vale: the pinned release is downloaded (and its checksum verified) when none is on the PATH.
describe("running Vale", () => {
  let vale: string;
  const root = tmp();
  beforeAll(async () => {
    vale = await resolveVale();
  }, 120_000);

  const alerts = async (body: string, config = resolveConfig()): Promise<string[]> =>
    (await runVale(body, config, root, vale)).map(d => `${d.line}:${d.rule.replace("DevBuildDeploy.", "")}:${d.level}`);

  test(`the resolved binary is Vale ${VALE_VERSION} or newer`, () => {
    expect(vale).toBeTruthy();
  });

  test("the passing fixtures have no Vale errors", async () => {
    for (const file of fs.readdirSync(path.join(FIXTURES, "pass"))) {
      const errors = (await runVale(read(`pass/${file}`), resolveConfig(), root, vale)).filter(
        d => d.level === "error"
      );
      expect({ file, errors }).toEqual({ file, errors: [] });
    }
  });

  test("bare references are errors; a reference inside a real sentence is not", async () => {
    const body = [
      "Implements L99.",
      "",
      "See #41 for the details.",
      "",
      "Per decision 4, we cap them.",
      "",
      "A parent's setting on the website wins over the device (L99.1), so the child cannot undo it.",
      "",
      "Fixes #12 and #13.",
    ].join("\n");
    expect(await alerts(body)).toEqual([
      "1:BareReferences:error",
      "3:BareReferences:error",
      "5:BareReferences:error",
      "9:BareReferences:error",
    ]);
  });

  test("extra reference patterns come from .pull-me.json", async () => {
    const config = resolveConfig({ vale: { referencePatterns: ["\\bpf-[a-z-]+\\b"] } });
    expect(await alerts("Implements pf-record-sync.", config)).toEqual(["1:BareReferences:error"]);
  });

  test("abbreviations must be explained on first use, unless known", async () => {
    expect(await alerts("The DST switch is handled.")).toEqual(["1:Abbreviations:warning"]);
    expect(await alerts("The DST (daylight saving time) switch is handled.")).toEqual([]);
    expect(await alerts("Daylight saving time (DST, one hour in summer) moves the DST switch.")).toEqual([]);
    expect(await alerts("The API and the CI are fine.")).toEqual([]);
    expect(await alerts("The KPI is fine.", resolveConfig({ vale: { abbreviations: ["KPI"] } }))).toEqual([]);
  });

  test("glossary terms must be explained on first use; repository terms are added", async () => {
    expect(await alerts("We bundle it with ncc now.")).toEqual(["1:Glossary:warning"]);
    expect(await alerts("We bundle it with ncc (a bundler for Node.js) now.")).toEqual([]);
    expect(await alerts("We bundle it with ncc, a bundler for Node.js, and ncc is fast.")).toEqual([]);
    fs.mkdirSync(path.join(root, ".github"), { recursive: true });
    fs.writeFileSync(path.join(root, ".github", "glossary.md"), "- **beat**: a step of the story\n");
    const [d] = await runVale("The beat ends here.", resolveConfig(), root, vale);
    expect(d.rule).toBe("DevBuildDeploy.Glossary");
    expect(d.hint).toContain("a step of the story");
  });

  test("long sentences, weasel words, wordy phrases and hedges are warnings", async () => {
    const long = `${Array(31).fill("word").join(" ")}.`;
    expect(await alerts(long)).toEqual(["1:SentenceLength:warning"]);
    expect(await alerts("It is very fast.")).toEqual(["1:Weasel:warning"]);
    expect(await alerts("We did it in order to ship.")).toEqual(["1:Wordy:warning"]);
    expect(await alerts("I think it works.")).toEqual(["1:Hedging:warning"]);
  });

  test("Flesch-Kincaid is off by default and can be switched on", async () => {
    const hard =
      "Comprehensive internationalisation infrastructure modifications necessitate considerable organisational coordination.";
    expect(await alerts(hard)).toEqual([]);
    const on = resolveConfig({ vale: { rules: { "DevBuildDeploy.Readability": "warning" } } });
    expect(await alerts(hard, on)).toContain("1:Readability:warning");
  });

  test("code spans, fenced blocks and the generated block are not linted", async () => {
    const body = `\`See #3\` is code.\n\n\`\`\`\nSee #3.\n\`\`\`\n\n${GENERATED_START}\nSee #4.\n${GENERATED_END}\n`;
    expect(await alerts(body)).toEqual([]);
  });

  test("check() merges structure and Vale findings, and a draft gets warnings only", async () => {
    const body = read("fail/bare-references.md");
    const ready = await check({ body }, resolveConfig(), { root, valeBinary: vale });
    expect(ready.filter(d => d.source === "vale" && d.level === "error").length).toBeGreaterThan(0);
    expect(ready.filter(d => d.source === "pull-me").map(d => d.rule)).toEqual(["PM003", "PM003", "PM003"]);
    const draft = await check({ body, draft: true }, resolveConfig(), { root, valeBinary: vale });
    expect(draft.every(d => d.level === "warning")).toBe(true);
    const off = await check({ body }, resolveConfig({ vale: { enabled: false } }), { root, valeBinary: vale });
    expect(off.every(d => d.source === "pull-me")).toBe(true);
  });
});
