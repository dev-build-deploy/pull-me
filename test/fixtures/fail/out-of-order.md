<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Proof

```text
Tests: 3 passed, 3 total
```

## Why

The release notes listed every dependency bump as a feature, so users could not find the real changes they made.

## How

The release tool now reads the commit scope: commits with the deps scope go under a Dependencies heading.

## Review hints

The grouping is by scope only: a bump without the deps scope still shows up as a feature.
