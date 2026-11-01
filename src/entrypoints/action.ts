/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

import { check } from "../check.js";
import { loadConfig, ResolvedConfig } from "../config.js";
import { countLevels, Diagnostic, sortDiagnostics } from "../diagnostic.js";
import {
  ANNOTATION_TITLE,
  annotationText,
  COMMENT_MARKER,
  commentBody,
  summaryRows,
  verifyRunLinks,
} from "../report.js";
import { applyLevels, skipReason } from "../rules.js";

type Octokit = ReturnType<typeof github.getOctokit>;

/** Creates, updates or deletes PullMe's one comment on the pull request. */
async function syncComment(octokit: Octokit, number: number, body: string | undefined): Promise<void> {
  const { owner, repo } = github.context.repo;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
  const mine = comments.find(c => c.body?.includes(COMMENT_MARKER));
  if (body === undefined) {
    if (mine) await octokit.rest.issues.deleteComment({ owner, repo, comment_id: mine.id });
  } else if (mine) {
    if (mine.body !== body) await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
  }
}

/** PM006: looks up the run links of the body through the API. */
async function runLinkWarnings(octokit: Octokit, body: string): Promise<Diagnostic[]> {
  const { owner, repo } = github.context.repo;
  return verifyRunLinks(body, owner, repo, async link => {
    if (link.kind === "run") {
      return {
        conclusion: (await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: link.id })).data.conclusion,
      };
    }
    if (link.kind === "job") {
      return {
        conclusion: (await octokit.rest.actions.getJobForWorkflowRun({ owner, repo, job_id: link.id })).data.conclusion,
      };
    }
    return { conclusion: (await octokit.rest.checks.get({ owner, repo, check_run_id: link.id })).data.conclusion };
  });
}

/** Writes the job summary: the result, then each rule with pass or fail. */
async function writeSummary(diagnostics: Diagnostic[], skipped?: string): Promise<void> {
  const summary = core.summary.addHeading("PullMe: pull request description", 2);
  if (skipped) {
    await summary.addRaw(`Skipped: ${skipped}.`).write();
    return;
  }
  const { errors, warnings } = countLevels(diagnostics);
  summary.addRaw(
    errors === 0 ? `✅ Passed, with ${warnings} warning(s).` : `❌ ${errors} error(s) and ${warnings} warning(s).`,
    true
  );
  summary.addTable([
    [
      { data: "Rule", header: true },
      { data: "What it checks", header: true },
      { data: "Result", header: true },
    ],
    ...summaryRows(diagnostics),
  ]);
  if (diagnostics.length > 0) summary.addList(diagnostics.map(annotationText));
  await summary.write();
}

/** Main entry point of the GitHub Action. */
async function run(): Promise<void> {
  try {
    const pr = github.context.payload.pull_request;
    if (!pr || !["pull_request", "pull_request_target"].includes(github.context.eventName)) {
      core.setFailed("PullMe only runs on pull_request and pull_request_target events.");
      return;
    }
    const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const config: ResolvedConfig = loadConfig(root, core.getInput("config") || undefined);
    if (core.getInput("comment"))
      config.githubAction.comment = core.getInput("comment") === "never" ? "never" : "on-failure";
    if (core.getInput("verify-run-links"))
      config.githubAction.verifyRunLinks = core.getBooleanInput("verify-run-links");
    const token = core.getInput("token");
    const octokit = token ? github.getOctokit(token) : undefined;

    const facts = {
      author: pr.user?.login,
      labels: (pr.labels ?? []).map((l: { name: string }) => l.name),
      draft: pr.draft === true,
    };
    const skipped = skipReason(facts, config);
    if (skipped) {
      core.info(`Skipped: ${skipped}.`);
      await writeSummary([], skipped);
      core.setOutput("errors", 0);
      core.setOutput("warnings", 0);
      return;
    }

    const body: string = pr.body ?? "";
    let diagnostics = await check({ body, title: pr.title, draft: facts.draft }, config, { root });
    if (octokit && config.githubAction.verifyRunLinks) {
      diagnostics = sortDiagnostics([
        ...diagnostics,
        ...applyLevels(await runLinkWarnings(octokit, body), config, facts.draft),
      ]);
    }

    for (const d of diagnostics) {
      if (d.level === "error") core.error(annotationText(d), { title: ANNOTATION_TITLE });
      else core.warning(annotationText(d), { title: ANNOTATION_TITLE });
    }
    await writeSummary(diagnostics);
    const { errors, warnings } = countLevels(diagnostics);
    core.setOutput("errors", errors);
    core.setOutput("warnings", warnings);

    if (octokit && config.githubAction.comment === "on-failure") {
      const runUrl = `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${github.context.runId}`;
      try {
        await syncComment(octokit, pr.number, errors > 0 ? commentBody(diagnostics, runUrl) : undefined);
      } catch (error) {
        core.warning(`PullMe could not update its comment (needs pull-requests: write): ${(error as Error).message}`);
      }
    }

    if (errors > 0) core.setFailed(`The pull request description has ${errors} error(s) and ${warnings} warning(s).`);
    else core.info(`The pull request description passes, with ${warnings} warning(s).`);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
