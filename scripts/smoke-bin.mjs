// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: CC0-1.0

// Runs the committed bundles the way users do, so a bundle or bin wrapper that no longer loads (for example a
// CommonJS `require` of an ESM bundle) fails here and not on a user's machine. Usage: node scripts/smoke-bin.mjs
// (Vale is downloaded on the first run when none is on the PATH.)

import { spawnSync } from "node:child_process";

const pass = "test/fixtures/pass/fenced-output.md";
const fail = "test/fixtures/fail/local-image.md";
const cases = [
  { args: ["bin/pull-me", "--help"], exit: 0, output: /pull-me/ },
  { args: ["bin/pull-me", "--version"], exit: 0, output: /^\d+\.\d+\.\d+/ },
  // The full check, Vale included: proves the bundle finds the shipped Vale configuration.
  { args: ["bin/pull-me", "check", "--body-file", pass], exit: 0, output: /passes every check/ },
  { args: ["bin/pull-me", "check", "--body-file", fail, "--no-vale"], exit: 1, output: /\[PM005\]/ },
  { args: ["bin/pull-me", "check", "--stdin", "--format", "json", "--no-vale"], input: "## Why\n", exit: 1, output: /"errors":4/ },
  { args: ["bin/pull-me", "check", "--body-file", pass, "--stdin"], exit: 2, output: /exactly one of/ },
  // The Claude plugin's call: its own bundle, which must find its own copy of the Vale configuration.
  { args: ["claude-plugin/bundle/index.js", "check", "--stdin", "--format", "hook"], input: "## Why\n", exit: 1, output: /"errors":4/ },
];

let failed = false;
for (const c of cases) {
  const run = spawnSync(process.execPath, c.args, { encoding: "utf8", input: c.input });
  const out = `${run.stdout}${run.stderr}`;
  const ok = run.status === c.exit && (!c.output || c.output.test(out));
  console.log(`${ok ? "ok  " : "FAIL"} node ${c.args.join(" ")} (exit ${run.status}, expected ${c.exit})`);
  if (!ok) {
    failed = true;
    console.error(out.trim());
  }
}
process.exit(failed ? 1 : 0);
