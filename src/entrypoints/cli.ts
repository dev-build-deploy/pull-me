#!/usr/bin/env node

/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Command } from "commander";

import { generatedBlock, insertScreenshots, parseAttachment, replaceGenerated, TEMPLATE } from "../body.js";
import { check } from "../check.js";
import { loadConfig } from "../config.js";
import { countLevels } from "../diagnostic.js";
import { formatHook, formatJson, formatText } from "../format.js";
import { checkRuns, editBody, requireAttachSupport, viewPullRequest } from "../gh.js";
import { changedFiles, commitsSince, headSha, mergeBase } from "../git.js";
import { skipReason } from "../rules.js";
import { VERSION } from "../version.js";

/** Exit codes: 0 clean (warnings allowed), 1 errors, 2 pull-me could not run. */
const EXIT_ERRORS = 1;
const EXIT_CANNOT_RUN = 2;

interface CheckFlags {
  pr?: string;
  repo?: string;
  bodyFile?: string;
  stdin?: boolean;
  title?: string;
  draft?: boolean;
  attach?: string[];
  config?: string;
  vale: boolean;
  format: "text" | "json" | "hook";
}

/** Runs an action; any thrown error is printed and exits with EXIT_CANNOT_RUN. */
const guarded =
  <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
  async (...args: T): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      process.stderr.write(`pull-me: error: ${(error as Error).message}\n`);
      process.exitCode = EXIT_CANNOT_RUN;
    }
  };

/** Checks a body and prints the report; returns the exit code. */
async function checkAndReport(
  flags: CheckFlags,
  body: string,
  file: string,
  facts: { title?: string; draft?: boolean }
): Promise<number> {
  const root = process.cwd();
  const config = loadConfig(root, flags.config);
  const attachments = (flags.attach ?? []).map(a => a.split("#")[0]);
  const diagnostics = await check({ body, title: facts.title, draft: facts.draft, attachments }, config, {
    root,
    vale: flags.vale,
  });
  if (flags.format === "json") process.stdout.write(formatJson(diagnostics));
  else if (flags.format === "hook") process.stdout.write(formatHook(diagnostics));
  else process.stdout.write(formatText(diagnostics, file, body));
  return countLevels(diagnostics).errors > 0 ? EXIT_ERRORS : 0;
}

const program = new Command();

program
  .name("pull-me")
  .description("Pull request descriptions that carry their own proof (Why, How, Review hints, Proof)")
  .version(VERSION);

program
  .command("check")
  .description(
    "Check a pull request description. Exit 0 when clean (warnings allowed), 1 on errors, 2 when it cannot run."
  )
  .option("--pr <number>", "check the body of this pull request (needs gh)")
  .option("--repo <owner/name>", "with --pr: the repository (default: the current one)")
  .option("--body-file <file>", "check the body in this file")
  .option("--stdin", "read the body from standard input")
  .option("--title <title>", "the pull request title (for the breaking-change rule)")
  .option("--draft", "treat the pull request as a draft (warnings only)")
  .option("--attach <files...>", "files that will be attached (gh --attach): local images with these paths count")
  .option("-c, --config <file>", "the configuration file (default: .pull-me.json or .github/.pull-me.json)")
  .option("--no-vale", "skip the prose checks (Vale)")
  .option("--format <format>", "text, json or hook", "text")
  .action(
    guarded(async (flags: CheckFlags) => {
      const sources = [flags.pr, flags.bodyFile, flags.stdin].filter(Boolean).length;
      if (sources !== 1) throw new Error("give exactly one of --pr, --body-file, --stdin");
      if (!["text", "json", "hook"].includes(flags.format)) throw new Error("--format must be text, json or hook");

      if (flags.pr) {
        const pr = await viewPullRequest(flags.pr, flags.repo);
        const skipped = skipReason(
          { author: pr.author, labels: pr.labels, draft: pr.isDraft },
          loadConfig(process.cwd(), flags.config)
        );
        if (skipped) {
          process.stdout.write(flags.format === "text" ? `Skipped: ${skipped}.\n` : formatJson([], skipped));
          return;
        }
        process.exitCode = await checkAndReport(flags, pr.body, `pr-${pr.number}.md`, {
          title: flags.title ?? pr.title,
          draft: flags.draft ?? pr.isDraft,
        });
        return;
      }
      const body = flags.stdin ? fs.readFileSync(0, "utf8") : fs.readFileSync(flags.bodyFile ?? "", "utf8");
      const file = flags.bodyFile ? path.basename(flags.bodyFile) : "body.md";
      process.exitCode = await checkAndReport(flags, body, file, { title: flags.title, draft: flags.draft });
    })
  );

program
  .command("body")
  .description("Print the description skeleton with the generated block: commits, changed files and checks.")
  .option("--base <branch>", "the base branch", "main")
  .option("--write <file>", "write to this file instead of standard output")
  .option("--update <number>", "rewrite only the generated block of this pull request's body (needs gh)")
  .option("--no-checks", "leave out the check runs (no network)")
  .option("-c, --config <file>", "the configuration file")
  .action(
    guarded(async (flags: { base: string; write?: string; update?: string; checks: boolean; config?: string }) => {
      const root = process.cwd();
      const config = loadConfig(root, flags.config);
      const from = await mergeBase(flags.base, root);
      const head = await headSha(root);
      const block = generatedBlock({
        commits: await commitsSince(from, root),
        files: await changedFiles(from, root),
        areas: config.areas,
        checks: flags.checks ? await checkRuns(head) : undefined,
        head,
      });

      if (flags.update) {
        const pr = await viewPullRequest(flags.update);
        const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pull-me-")), "body.md");
        fs.writeFileSync(tmp, replaceGenerated(pr.body, block));
        process.stdout.write(await editBody(flags.update, tmp));
        return;
      }
      const text = replaceGenerated(TEMPLATE, block);
      if (flags.write) fs.writeFileSync(flags.write, text);
      else process.stdout.write(text);
    })
  );

program
  .command("attach")
  .description(
    "Attach screenshots under Proof (wraps gh pr edit --attach, gh 2.99 or newer), then check the body again."
  )
  .argument("<number>", "the pull request")
  .argument("<files...>", "the files, each optionally with alt text: shot.png#The login error")
  .option("-c, --config <file>", "the configuration file")
  .option("--no-vale", "skip the prose checks when checking again")
  .action(
    guarded(async (number: string, files: string[], flags: { config?: string; vale: boolean }) => {
      await requireAttachSupport();
      const attachments = files.map(f => parseAttachment(f));
      const pr = await viewPullRequest(number);
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pull-me-")), "body.md");
      fs.writeFileSync(tmp, insertScreenshots(pr.body, attachments));
      process.stdout.write(
        await editBody(
          number,
          tmp,
          attachments.map(a => `${a.path}#${a.alt}`)
        )
      );
      const updated = await viewPullRequest(number);
      process.exitCode = await checkAndReport(
        { vale: flags.vale, format: "text", config: flags.config },
        updated.body,
        `pr-${number}.md`,
        { title: updated.title, draft: updated.isDraft }
      );
    })
  );

program.parseAsync(process.argv);
