/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  ConfigError,
  DEFAULT_CONFIG,
  findConfigFile,
  loadConfig,
  resolveConfig,
  validateConfig,
} from "../src/config.js";

const repo = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-me-config-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

describe("configuration", () => {
  test("no file gives the defaults", () => {
    expect(loadConfig(repo({}))).toEqual(DEFAULT_CONFIG);
  });
  test(".pull-me.json wins over .github/.pull-me.json, like commit-me", () => {
    const dir = repo({ ".pull-me.json": "{}", ".github/.pull-me.json": "{}" });
    expect(findConfigFile(dir)).toBe(path.join(dir, ".pull-me.json"));
    const only = repo({ ".github/.pull-me.json": '{ "skipLabel": "skip-it" }' });
    expect(loadConfig(only).skipLabel).toBe("skip-it");
  });
  test("sections merge field by field; lists replace", () => {
    const config = resolveConfig({ sections: { Why: { minChars: 20 } }, optional: ["Notes"] });
    expect(config.sections.Why).toEqual({ minChars: 20, aliases: [] });
    expect(config.sections.How.minChars).toBe(80);
    expect(config.optional).toEqual(["Notes"]);
  });
  test.each([
    ["[]", "must hold an object"],
    ['{ "sections": { "Why": { "minChars": -1 } } }', "minChars"],
    ['{ "drafts": "maybe" }', "drafts"],
    ['{ "levels": { "PM001": "loud" } }', "levels.PM001"],
    ['{ "ignoreAuthors": "bot" }', "ignoreAuthors"],
    ['{ "sections": { "Proof": { "linkPatterns": ["("] } } }', "linkPatterns"],
  ])("%s is refused (%s)", (text, field) => {
    expect(() => validateConfig(JSON.parse(text))).toThrow(field);
  });
  test("a file that is not JSON names the file", () => {
    const dir = repo({ ".pull-me.json": "{ nope" });
    expect(() => loadConfig(dir)).toThrow(ConfigError);
    expect(() => loadConfig(dir)).toThrow(".pull-me.json");
  });
});
