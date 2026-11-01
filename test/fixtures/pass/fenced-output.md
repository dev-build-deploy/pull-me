<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

<!-- Write for a junior engineer new to this repo. -->

## Why

Clients that send too many requests slowed the API (application programming interface) for everyone. The team
decided to cap each client at 10 requests a second, so one busy client cannot slow down the others.

## How

This adds a token bucket: each client gets 20 tokens, and one comes back every 100 ms. A request without a token
gets HTTP 429 (too many requests). The bucket lives in memory, because one server handles all traffic today.

## Review hints

Read `limiter.ts` first. The clock is injected, so the tests do not sleep. Not covered: several servers sharing one
limit; that needs a shared store and is a follow-up.

## Proof

```text
$ npm test
PASS test/limiter.test.ts
Tests:       12 passed, 12 total
```

## Follow-ups

- A shared store for the limit when there is more than one server.
