<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Why

The nightly export wrote every file with the same licence header, so the compliance check failed for files that are
not ours. Each file now gets the licence of the folder it lives in, so the check passes without a long allowlist.

## How

- A small table in `tools/licences.txt` maps folders to licences; the first match wins.
- The pre-commit hook reads the same table, so a new file gets the right header before it is committed.
- I kept the old allowlist for one release, so a branch that is still open does not break.

## Review hints

Read `tools/licences.txt` first: a wrong pattern there gives a whole folder the wrong licence. Not covered: files
without a comment syntax, which still need an entry in `.reuse/dep5`.

## Proof

- CI: [REUSE compliance](https://github.com/example/project/actions/runs/41286891025/job/124789899874) ✅ and
  [Conventional Commits](https://github.com/example/project/actions/runs/41287254125/job/124790955914) ✅.
