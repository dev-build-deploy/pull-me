<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Why

The release notes listed every dependency bump as a feature, so users could not find the real changes. Grouping
the bumps under one heading makes the notes readable again.

## How

The release tool now reads the commit scope: commits with the `deps` scope go under "Dependencies". Nothing else
changes, so existing releases keep their notes.

## Review notes

The grouping is by scope only. A dependency bump without the `deps` scope still shows up as a feature.

## Proof

Before and after, from a dry run on the last release:

```
Features: 14 -> 3
Dependencies: 0 -> 11
```
