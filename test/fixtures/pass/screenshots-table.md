<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Why

Parents asked for one page that shows how their child is doing this week, without reading every session. The new
overview page answers that question at a glance, on a phone and on a laptop.

## How

- The page reads the same weekly summary the server already computes, so no new endpoint was needed.
- Charts are plain SVG (scalable vector graphics, images drawn from shapes), so they stay sharp on every screen.
- Light and dark themes follow the system setting.

## Review hints

The riskiest part is the week boundary: a session after midnight on Sunday must count for the next week. Look at
`summary.ts` first. Not tested: screen readers.

## Proof

- Screenshots:

  | Desktop | Phone |
  |---|---|
  | ![Overview at 1280 px, light](https://github.com/user-attachments/assets/260ff9cf-f7a6-4c52-961c-df72f44634d7) | ![Overview at 390 px, dark](https://github.com/user-attachments/assets/fb89de5a-3bb4-4d46-9633-66a008d21507) |

- **CI:** [Conventional Commits](https://github.com/example/project/actions/runs/41286932687/job/124790025188) ✅
