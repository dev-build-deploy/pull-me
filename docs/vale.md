<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Prose checks with Vale

PullMe checks the structure of a description itself. The prose is checked by [Vale](https://vale.sh), a linter for
writing (MIT licence). PullMe writes the body to a temporary Markdown file, runs Vale on it, and reports each Vale
alert as its own finding, named after the Vale rule (`DevBuildDeploy.BareReferences`).

## The Vale binary

PullMe runs Vale **3.24.0**. It uses, in order:

1. the binary in the `PULL_ME_VALE` environment variable;
2. a `vale` on the `PATH` that is 3.24.0 or newer;
3. the 3.24.0 release from GitHub, downloaded once into `~/.cache/pull-me/vale-3.24.0` (or `$PULL_ME_CACHE`).
   PullMe checks the archive's SHA-256 checksum against the one in `src/vale.ts` (copied from the release's
   `vale_3.24.0_checksums.txt`) and refuses to run anything else.

## The DevBuildDeploy style

| Rule | Level | What it checks |
| --- | --- | --- |
| `BareReferences` | error | A reference that stands alone: "Implements #12.", "See L4.2.", "Per decision 4, ...". |
| `Abbreviations` | warning | An abbreviation of 2-6 capitals that is not explained the first time: "DST (daylight saving time)". |
| `Glossary` | warning | A glossary term that is not explained the first time, by brackets, a colon or a dash. |
| `SentenceLength` | warning | A sentence of more than 30 words. |
| `Weasel` | warning | Words that weaken a claim: "very", "really", "basically". |
| `Wordy` | warning | Long phrases with a short equivalent: "in order to" becomes "to". |
| `Hedging` | warning | Hedges: "I think", "kind of", "hopefully". |
| `Readability` | off | The Flesch-Kincaid grade level above 12. Technical words have many syllables, so it is off by default. |

The word lists of `Weasel`, `Wordy` and `Hedging` are our own, inspired by the write-good (MIT) and proselint
(BSD-3-Clause) packages for Vale.

A reference is `#12`, `decision 4`, an id such as `L99.1`, `E1` or `D12`, or a ticket such as `ABC-123`. A sentence
is bare when it starts with "see", "per", "as in" or "cf." and a reference, or when it has at most two words besides
its references. "A parent's setting on the website wins over the device (L99.1)." is fine.

## The glossary

PullMe merges three glossaries, the later ones winning:

1. the base glossary it ships ([`vale/glossary.md`](../vale/glossary.md));
2. the repository's `.github/glossary.md` (or the file in `vale.glossaryFile`);
3. the terms in `vale.glossary` of `.pull-me.json`.

A glossary file has one term per line: `- **term**: explanation`. When a term is not explained, the hint quotes the
glossary's explanation for the author to adapt. Glossary terms in capitals also count as known abbreviations.

## Overrides in `.pull-me.json`

```json
{
  "vale": {
    "enabled": true,
    "rules": { "DevBuildDeploy.SentenceLength": "off", "DevBuildDeploy.Readability": "warning" },
    "glossary": { "beat": "a step of the story, with its own test" },
    "glossaryFile": ".github/glossary.md",
    "referencePatterns": ["\\bpf-[a-z-]+\\b"],
    "abbreviations": ["KPI", "OFL"],
    "config": "path/to/.vale.ini"
  }
}
```

- `rules`: a Vale rule `off`, `warning`, `error` or `suggestion`.
- `referencePatterns`: extra regular expressions for the repository's own references.
- `abbreviations`: abbreviations every reader of this repository knows.
- `config`: the repository's own `.vale.ini`, which **replaces** the shipped configuration (and its style).
- `enabled: false`: no prose checks at all.
- `levels` (top level) also works on Vale rules, and a draft gets warnings only, as for PullMe's own rules.
