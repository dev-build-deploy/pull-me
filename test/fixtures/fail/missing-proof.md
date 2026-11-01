<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC0-1.0
-->

## Why

The nightly export wrote every file with the same licence header, so the compliance check failed for files that are
not ours.

## How

A small table maps folders to licences; the first match wins. The pre-commit hook reads the same table.

## Review hints

Read the table first: a wrong pattern gives a whole folder the wrong licence.
