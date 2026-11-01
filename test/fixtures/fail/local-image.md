<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Why

Parents asked for one page that shows how their child is doing this week, without reading every session or report.

## How

The page reads the same weekly summary the server already computes, so no new endpoint was needed for it.

## Review hints

The week boundary is the riskiest part: a session after midnight on Sunday must count for the next week.

## Proof

![The overview page](./screenshots/overview.png)
