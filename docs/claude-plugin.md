<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Claude Code plugin

The `pull-me` plugin makes a [Claude Code](https://claude.com/claude-code) session write a complete pull request
description *before* the pull request exists, instead of failing the check in CI afterwards. It lives in
[`claude-plugin/`](../claude-plugin) and bundles the same CLI (`claude-plugin/bundle`, with its own copy of the Vale
configuration; rebuilt by `npm run build:plugin`, checked in CI), so it needs only `node` on the `PATH`.

## Install

```text
/plugin marketplace add dev-build-deploy/claude-plugins
/plugin install pull-me@dev-build-deploy
```

or straight from a clone: `claude --plugin-dir ./claude-plugin`.

## What it does

- **Bash `gh pr create` and `gh pr edit`**: the body (`--body`/`-b`, `--body-file`/`-F` with a file or `-` and a
  heredoc) and the title are checked with `pull-me check --format hook`, with the repository's `.pull-me.json`.
  - Errors **deny** the command, with each finding, its fix and the four sections. Nothing is created.
  - Warnings deny **once per body**: the same body sent again goes through, so a false positive never blocks work.
  - `gh pr create --fill` (and `--fill-first`, `--fill-verbose`) and `gh pr create` without a body are denied.
  - A local image that is also given to `--attach` counts as an image.
  - Passed through: `gh pr edit` without a body (labels, reviewers), `--web`, and a body built by the shell (`$(...)`
    other than a heredoc).
- **Skill `writing-pull-requests`**: who the reader is, what goes in each section, what counts as Proof, a before and
  after example, and what to do when the hook denies.
- If the check cannot run (no `node`, no network for the first Vale download), the command goes through with one
  toast: a broken checker must not lock the session. CI remains the gate.

Not covered yet: the GitHub MCP server's `create_pull_request` and `update_pull_request` tools.

## Tests

`npm run test:plugin` (`claude plugin test claude-plugin`): a body without Proof is denied, a complete one passes,
`--fill` is denied, a label-only edit passes, warnings deny once, an attached local image counts, a broken checker lets
the command through. The real rules and Vale are covered by the jest suite.

## Marketplace entry

For `dev-build-deploy/claude-plugins` (`.claude-plugin/marketplace.json`, in `plugins`):

```json
{
  "name": "pull-me",
  "description": "Denies a gh pr create or gh pr edit whose description misses Why, How, Review hints or Proof, or has no evidence in Proof.",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/dev-build-deploy/pull-me.git",
    "path": "claude-plugin",
    "ref": "v0.1.0"
  }
}
```
