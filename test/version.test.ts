/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from "node:fs";

import { describe, expect, test } from "@jest/globals";

import { VERSION } from "../src/version.js";

describe("version", () => {
  test("is a semantic version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
