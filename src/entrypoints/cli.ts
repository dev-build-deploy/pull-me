#!/usr/bin/env node

/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Command } from "commander";

import { VERSION } from "../version.js";

const program = new Command();

program
  .name("pull-me")
  .description("Pull request descriptions that carry their own proof (Why, How, Review hints, Proof)")
  .version(VERSION);

program.parse(process.argv);
