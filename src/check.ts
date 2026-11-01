/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { ResolvedConfig } from "./config.js";
import { Diagnostic, sortDiagnostics } from "./diagnostic.js";
import { applyLevels, checkStructure, CheckInput } from "./rules.js";
import { runVale } from "./vale.js";

/** How a full check runs. */
export interface CheckOptions {
  /** The repository root, where `.pull-me.json` paths and the glossary file are read. */
  root: string;
  /** false: skip Vale (the structure rules only). */
  vale?: boolean;
  /** A Vale binary to use instead of resolving one. */
  valeBinary?: string;
}

/**
 * Checks a pull request description: PullMe's structure rules, then Vale's prose rules (unless `vale` is false or
 * the configuration turns Vale off). Levels from `.pull-me.json` and the draft downgrade apply to both.
 * Throws ValeError when Vale is wanted but cannot run.
 */
export async function check(input: CheckInput, config: ResolvedConfig, options: CheckOptions): Promise<Diagnostic[]> {
  const structure = checkStructure(input, config);
  if (options.vale === false || config.vale.enabled === false) return structure;
  const prose = await runVale(input.body, config, options.root, options.valeBinary);
  return sortDiagnostics([...structure, ...applyLevels(prose, config, input.draft === true)]);
}
