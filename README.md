<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# PullMe

PullMe checks that a pull request description carries its own proof. Every description has four sections:

1. **Why**: the value; what we wanted to achieve, and for whom.
2. **How**: the implementation; the choices and their reasons.
3. **Review hints**: the risks, what to read first, what is not covered.
4. **Proof**: the evidence that it works: test output, links to CI runs, screenshots.

A description must also be **self-contained** (a reader understands it without opening another source) and
**readable for a junior engineer** who is new to the repository.

PullMe is deterministic: there is no AI inside. It comes as a [Command Line Interface](./docs/cli.md), a
[GitHub Action](./docs/github-action.md) and a [Claude Code plugin](./docs/claude-plugin.md), like the other
dev-build-deploy tools ([commit-me](https://github.com/dev-build-deploy/commit-me),
[reuse-me](https://github.com/dev-build-deploy/reuse-me), [secret-me](https://github.com/dev-build-deploy/secret-me)).

> [!NOTE]
> PullMe is being built in small pull requests. The sections below describe the finished tool; the documents in
> `docs/` arrive with the pull request that adds each part.

## What it checks

PullMe checks the **structure** itself:

| Rule | Level | What it means |
| --- | --- | --- |
| PM001 | error | A required section (Why, How, Review hints, Proof) is missing. |
| PM002 | error | A section is empty or holds only placeholders such as `TODO`. |
| PM003 | error | A section is shorter than its minimum length (Why 80, How 80, Review hints 40 characters of prose). |
| PM004 | error | Proof has no evidence: no image, no link to a CI run or artifact, no fenced block with output. |
| PM005 | error | An image points to a local path, so it will render broken. |
| PM006 | warning | A linked CI run is not in this repository, cannot be found, or did not succeed (GitHub Action only). |
| PM007 | warning | The sections are out of order. |
| PM008 | warning | The title marks a breaking change (`feat!:`) but there is no `## Breaking changes` section. |

The **prose** is checked by [Vale](https://vale.sh), a linter for writing. PullMe ships a Vale configuration and a
style package called `DevBuildDeploy`: sentence length, abbreviations explained on first use, glossary terms explained
on first use, bare references such as "Implements #12." (an error), and a few plain-English rules. Each repository can
override it in `.pull-me.json`. PullMe downloads a pinned Vale release and checks its SHA-256 checksum before it runs.

A draft pull request gets warnings only. Errors fail the check, so it can be a required status check.

## Attaching screenshots

`pull-me attach <pr> shot.png` puts a screenshot under Proof. It wraps `gh pr edit --attach` (GitHub CLI 2.99 or
newer), which uploads the file to GitHub's attachment store: no branch, no commit. A screenshot made in CI goes up as
an Actions artifact instead, and Proof links to that artifact.

## Configuration

PullMe reads `.pull-me.json` or `.github/.pull-me.json`. See the [configuration document](./docs/config.md).

## Contributing

If you have suggestions for how PullMe could be improved, or want to report a bug, open an issue. We'd love all and
any contributions. For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

- [MIT](./LICENSES/MIT.txt) © 2026 Kevin de Jong \<monkaii@hotmail.com\>
