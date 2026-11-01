// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: CC0-1.0

// Runs the committed bundles the way users do, so a bundle or bin wrapper that no longer loads (for example a
// CommonJS `require` of an ESM bundle) fails here and not on a user's machine. Usage: node scripts/smoke-bin.mjs

import { spawnSync } from "node:child_process";

const cases = [
  { args: ["bin/pull-me", "--help"], exit: 0, output: /pull-me/ },
  { args: ["bin/pull-me", "--version"], exit: 0, output: /^\d+\.\d+\.\d+/ },
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
