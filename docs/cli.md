<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Command Line Interface

Run it from a clone: `npm ci && node bin/pull-me --help` (or `npm link` for a `pull-me` command). It needs Node.js 24
or newer; `--pr`, `body --update` and `attach` also need the [GitHub CLI](https://cli.github.com) (`gh`).

## `pull-me check`

Checks a description. Exit code 0 when it is clean (warnings allowed), 1 on errors, 2 when PullMe cannot run.

```text
pull-me check --body-file body.md [--title "feat: ..."] [--draft]
pull-me check --pr 12 [--repo owner/name]
pull-me check --stdin < body.md
```

| Option | Meaning |
| --- | --- |
| `--pr <n>` | Check the body of pull request `n` (title, draft state, author and labels come with it). |
| `--body-file <f>`, `--stdin` | Check a body from a file or from standard input. |
| `--title <t>` | The title, for the breaking-change rule (PM008). |
| `--draft` | Treat it as a draft: warnings only. |
| `--attach <files...>` | Files that will be uploaded with `gh --attach`: local images with these paths count as images. |
| `--no-vale` | Skip the prose checks. |
| `--format text\|json\|hook` | `text` for people, `json` for tools, `hook` for the Claude Code plugin. |
| `-c, --config <f>` | The configuration file (default: `.pull-me.json`, then `.github/.pull-me.json`). |

```text
body.md:18:1: error: [PM004] The "Proof" section has no evidence.

  18 | ## Proof
     | ^
  hint: Add a fenced block with the test output, a link to the CI run (.../actions/runs/<id>), or a screenshot: `pull-me attach <pr> shot.png`.

Found 1 error and 0 warnings in the pull request description.
```

## `pull-me body`

Prints the skeleton of a description (the four sections with a comment each, like the org's pull request template)
and a generated block between `<!-- pull-me:generated:start -->` and `<!-- pull-me:generated:end -->`:

- the commits since the merge base with `--base` (default `main`), grouped by Conventional Commit type;
- the changed files by area (the `areas` globs of `.pull-me.json`, else the top folder) with their line counts;
- the check runs on the head commit with their conclusion (leave them out with `--no-checks`).

The block is sorted and has no timestamps. It sits in a collapsed `<details>` and never counts toward a section, so it
cannot satisfy Proof. `--write <f>` writes to a file; `--update <n>` rewrites only the generated block of pull request
`n` and leaves everything the author wrote byte-identical.

## `pull-me attach`

```text
pull-me attach 12 shot.png "error.png#The login error state"
```

Checks each file (png, jpg, gif, webp, mp4 or mov, at most 10 MB), puts `![alt](./shot.png)` under a
`### Screenshots` heading at the end of Proof, and runs `gh pr edit 12 --body-file <tmp> --attach ...`. gh uploads the
files to GitHub's attachment store (no branch, no commit) and replaces each local path with the uploaded file's URL.
Then PullMe checks the body again. It needs gh 2.99.0 or newer and write access to the repository; in a private
repository, only people with access to it can see the files.
