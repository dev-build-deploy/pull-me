<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Why

Parents can now change the game's settings from the website, and the game picks them up on its next sync. Before,
a parent had to open the game on the child's device to change anything.

## How

The website stores the settings on the server. The device fetches them at every sync and applies them; a change
made on the device itself is ignored while the website holds a value.

## Review hints

The privacy checks on the new endpoints matter most. Not tested: two parents changing the same setting at once.

## Proof

- **End-to-end test against the running server: all checks pass.**
- The dashboard's unit tests pass: 47.
- In a real browser, the game page renders without errors.
