<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# GitHub Action

```yaml
name: Pull request description
on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read        # .pull-me.json and the glossary
  pull-requests: write  # the comment while the check fails
  actions: read         # verifying links to workflow runs (PM006)
  checks: read          # verifying links to check runs (PM006)

jobs:
  pull-me:
    name: Pull request description
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: dev-build-deploy/pull-me@v0
```

The checkout is only needed for `.pull-me.json` and `.github/glossary.md`; without it, PullMe uses its defaults.
Make the job a required status check to block merging on errors.

## What it does

- Checks the body and the title of the pull request from the event (no API call), with PullMe's rules and Vale.
- Each finding becomes an annotation titled "Pull request description", with the line in the body.
- The job summary has a table of every rule with its result, and the findings.
- While the check fails, one comment on the pull request lists the findings. PullMe finds its own comment by a
  hidden marker and updates it in place; once the check passes, it deletes the comment. A Claude Code session
  reads pull request comments, so it sees what to fix.
- PM006: each run link in Proof is looked up; a run in another repository, a run that cannot be found or a run that
  finished without success gives a warning. A run that is still going is fine.
- A draft gets warnings only, so the job passes. Authors in `ignoreAuthors` (default `dependabot[bot]`) and pull
  requests with the `no-pull-me` label are skipped; the job summary says why.

## Inputs and outputs

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `github.token` | For the comment and for PM006. |
| `config` | `.pull-me.json`, then `.github/.pull-me.json` | The configuration file. |
| `comment` | from the configuration (`on-failure`) | `on-failure` or `never`. |
| `verify-run-links` | from the configuration (`true`) | Look up run links (PM006). |

Outputs: `errors` and `warnings`, the counts.

Vale is downloaded on each run (a few megabytes from GitHub, checksum verified). To use a Vale that is already on
the runner, put it on the `PATH` or set `PULL_ME_VALE`.
