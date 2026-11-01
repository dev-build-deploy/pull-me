/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CommitInfo, FileChange } from "./body.js";

const run = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  try {
    return (await run("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout;
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message).trim().split("\n")[0]}`);
  }
}

/** The merge base of HEAD and the base branch: `origin/<base>` when it exists, else `<base>`. */
export async function mergeBase(base: string, cwd: string): Promise<string> {
  for (const ref of [`origin/${base}`, base]) {
    try {
      return (await git(["merge-base", "HEAD", ref], cwd)).trim();
    } catch {
      // try the next ref
    }
  }
  throw new Error(`no merge base between HEAD and ${base} (fetch it first: git fetch origin ${base})`);
}

/** The commits between the merge base and HEAD, oldest first, without merge commits. */
export async function commitsSince(from: string, cwd: string): Promise<CommitInfo[]> {
  const out = await git(["log", "--reverse", "--no-merges", "--format=%h%x09%s", `${from}..HEAD`], cwd);
  return out
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [hash, ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    });
}

/** The files changed between the merge base and HEAD, with their line counts. */
export async function changedFiles(from: string, cwd: string): Promise<FileChange[]> {
  const out = await git(["diff", "--numstat", "--no-renames", `${from}..HEAD`], cwd);
  return out
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [added, removed, ...file] = line.split("\t");
      return {
        path: file.join("\t"),
        added: added === "-" ? undefined : Number(added),
        removed: removed === "-" ? undefined : Number(removed),
      };
    });
}

/** The full hash of HEAD. */
export async function headSha(cwd: string): Promise<string> {
  return (await git(["rev-parse", "HEAD"], cwd)).trim();
}
