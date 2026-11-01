<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Configuration

PullMe reads `.pull-me.json`, else `.github/.pull-me.json` (the same lookup as commit-me), or the file given with
`--config` or the Action's `config` input. Every field is optional; these are the defaults:

```json
{
  "sections": {
    "Why": { "minChars": 80 },
    "How": { "minChars": 80 },
    "Review hints": { "minChars": 40, "aliases": ["Review notes"] },
    "Proof": { "evidence": ["image", "run-link", "artifact-link", "fenced-block"], "linkPatterns": [] }
  },
  "optional": ["Stacked on", "Breaking changes", "Follow-ups"],
  "drafts": "warn",
  "ignoreAuthors": ["dependabot[bot]"],
  "skipLabel": "no-pull-me",
  "levels": {},
  "areas": {},
  "vale": { "enabled": true },
  "githubAction": { "comment": "on-failure", "verifyRunLinks": true }
}
```

| Field | Meaning |
| --- | --- |
| `sections.<name>.minChars` | The minimum prose length (PM003): text without code, links, URLs and references. 0 turns it off. |
| `sections.<name>.aliases` | Other headings that count as this section. The four section names themselves are fixed. |
| `sections.Proof.evidence` | The kinds of evidence that count (PM004). |
| `sections.Proof.linkPatterns` | Regular expressions for more links that count as evidence, such as an external CI. |
| `drafts` | `warn`: a draft gets warnings only; `check`: checked like a ready pull request; `skip`: not checked. |
| `ignoreAuthors` | Pull requests by these authors are not checked. |
| `skipLabel` | A pull request with this label is not checked; the job summary says so. |
| `levels` | A rule (PullMe's or Vale's) `error`, `warning` or `off`: `{ "PM007": "off" }`. |
| `areas` | Area names to globs, for the changed files in `pull-me body`: `{ "engine": "engine/**" }`. |
| `vale` | The prose checks: see [Vale](./vale.md). |
| `githubAction.comment` | `on-failure`: one comment on the pull request while the check fails, deleted once it passes; `never`. |
| `githubAction.verifyRunLinks` | Look up each linked run and warn when it is in another repository or did not succeed (PM006). |
