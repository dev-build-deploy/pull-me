/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareVersions } from "./version.js";

const run = promisify(execFile);

/** The first GitHub CLI release with `--attach` on `gh pr create`, `gh pr edit` and `gh pr comment`. */
export const GH_ATTACH_VERSION = "2.99.0";

/** Thrown when the GitHub CLI is missing, too old, or a call fails. */
export class GhError extends Error {}

/** Runs `gh` with arguments and returns its standard output. */
export async function gh(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run("gh", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { code?: string; stderr?: string; message: string };
    if (e.code === "ENOENT") throw new GhError("the GitHub CLI (gh) is not installed: https://cli.github.com");
    throw new GhError(`gh ${args[0]} ${args[1] ?? ""} failed: ${(e.stderr || e.message).trim().split("\n")[0]}`);
  }
}

/** Fails unless the installed GitHub CLI has `--attach` (2.99.0 or newer). */
export async function requireAttachSupport(): Promise<void> {
  const version = /\d+\.\d+\.\d+/.exec(await gh(["--version"]))?.[0];
  if (!version || compareVersions(version, GH_ATTACH_VERSION) < 0) {
    throw new GhError(
      `gh ${version ?? "(unknown version)"} has no --attach; pull-me attach needs gh ${GH_ATTACH_VERSION} or newer`
    );
  }
}

/** The facts of a pull request that pull-me needs. */
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  isDraft: boolean;
  author: string;
  labels: string[];
  headRefOid: string;
}

/** Reads a pull request of the current repository (or `repo`, `owner/name`). */
export async function viewPullRequest(number: string, repo?: string): Promise<PullRequest> {
  const fields = "number,title,body,isDraft,author,labels,headRefOid";
  const out = await gh(["pr", "view", number, "--json", fields, ...(repo ? ["--repo", repo] : [])]);
  const pr = JSON.parse(out) as Omit<PullRequest, "author" | "labels"> & {
    author: { login: string };
    labels: { name: string }[];
  };
  return { ...pr, author: pr.author.login, labels: pr.labels.map(l => l.name) };
}

/** Replaces a pull request's body with a file, uploading the attachments (`path#alt`) gh rewrites references to. */
export async function editBody(
  number: string,
  bodyFile: string,
  attachments: string[] = [],
  repo?: string
): Promise<string> {
  const attach = attachments.flatMap(a => ["--attach", a]);
  return gh(["pr", "edit", number, "--body-file", bodyFile, ...attach, ...(repo ? ["--repo", repo] : [])]);
}

/** A check run on a commit: its name, its conclusion (or status while it runs) and its page. */
export interface CheckRun {
  name: string;
  conclusion: string;
  url: string;
}

/** The check runs on a commit of the current repository, sorted by name. */
export async function checkRuns(sha: string): Promise<CheckRun[]> {
  const out = await gh([
    "api",
    "--paginate",
    `repos/{owner}/{repo}/commits/${sha}/check-runs`,
    "--jq",
    ".check_runs[] | {name, conclusion: (.conclusion // .status), url: .html_url}",
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as CheckRun)
    .sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
}
