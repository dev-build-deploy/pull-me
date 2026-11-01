/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ResolvedConfig } from "./config.js";
import { Diagnostic } from "./diagnostic.js";
import { parseBody } from "./markdown.js";
import { DEFAULT_REFERENCE_PATTERNS } from "./rules.js";

const run = promisify(execFile);

/** The Vale release pull-me is built and tested against (MIT licence, https://github.com/errata-ai/vale). */
export const VALE_VERSION = "3.24.0";

/** SHA-256 of each release archive, from vale_3.24.0_checksums.txt of the release. */
export const VALE_CHECKSUMS: Record<string, string> = {
  "Linux_64-bit.tar.gz": "867534ddb678abca7f214bc4706ead0922bd5252ffe8035fc227013f66c8b214",
  "Linux_arm64.tar.gz": "104cbd349279e50c4cb40adb70adf345d93cc4a3a0191f9e68bdccb97086b582",
  "Windows_64-bit.zip": "3a8884774973b6f2826877e1c6388a5feae4704ef88a9a9c912c77ce186990f3",
  "Windows_arm64.zip": "3ec62981d49558d89c2ee2e9836f10db86ca335fdfaa2b701a9fbeca1496a5c7",
  "macOS_64-bit.tar.gz": "eeb39e86f1daac27cc2a77fef3af1824d50559bdc22329fb25fb921c80c79472",
  "macOS_arm64.tar.gz": "87b513f26499f6657c15cf7175ba5b058a7c1ff2bb2d4e07265db2dd43451e44",
};

/** The name of the style package pull-me ships. */
export const STYLE = "DevBuildDeploy";

/** The repository glossary pull-me reads when `vale.glossaryFile` is not set. */
export const DEFAULT_GLOSSARY_FILE = ".github/glossary.md";

/** How long one Vale run may take before pull-me gives up on it. */
const VALE_TIMEOUT_MS = 60_000;

/** Fix-it hints for the rules of the DevBuildDeploy style, by rule name. */
const HINTS: Record<string, string> = {
  [`${STYLE}.SentenceLength`]: "Split the sentence in two; one idea per sentence.",
  [`${STYLE}.Abbreviations`]:
    'Write it out once: "API (application programming interface)", or add it to "vale.abbreviations".',
  [`${STYLE}.BareReferences`]:
    "Say what the issue, decision or document says in a sentence of your own; keep the reference in brackets.",
  [`${STYLE}.Weasel`]: "Remove the word, or replace it with the fact or the number.",
  [`${STYLE}.Wordy`]: "Use the shorter phrase.",
  [`${STYLE}.Hedging`]: "Say what you checked and what you did not check.",
  [`${STYLE}.Readability`]: "Use shorter sentences and shorter words.",
};

/** Thrown when Vale cannot be found, downloaded or run. */
export class ValeError extends Error {}

/** Compares dotted versions: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The release archive suffix of this platform, as keyed in VALE_CHECKSUMS. */
export function platformAsset(platform: string = process.platform, arch: string = process.arch): string {
  const system =
    platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;
  const cpu = arch === "x64" ? "64-bit" : arch;
  const suffix = `${system}_${cpu}.${platform === "win32" ? "zip" : "tar.gz"}`;
  if (!(suffix in VALE_CHECKSUMS)) throw new ValeError(`no Vale release for ${platform}/${arch}`);
  return suffix;
}

/** The cache folder of the pinned Vale binary (override with PULL_ME_CACHE). */
export function cacheDir(): string {
  const base =
    process.env.PULL_ME_CACHE ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "pull-me");
  return path.join(base, `vale-${VALE_VERSION}`);
}

/** Refuses an archive whose SHA-256 is not the pinned one. */
export function verifyChecksum(archive: Buffer, suffix: string, source: string = suffix): void {
  const sum = createHash("sha256").update(archive).digest("hex");
  if (sum !== VALE_CHECKSUMS[suffix])
    throw new ValeError(`checksum mismatch for ${source} (got ${sum}); refusing to run it`);
}

/** The version of a Vale binary, or undefined when it does not run. */
export async function binaryVersion(bin: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(bin, ["--version"]);
    return /\d+\.\d+\.\d+/.exec(stdout)?.[0];
  } catch {
    return undefined;
  }
}

/**
 * Finds the Vale to run: PULL_ME_VALE, else one on the PATH that is at least the pinned version, else the pinned
 * release from GitHub (SHA-256 verified against VALE_CHECKSUMS), cached under the user's cache folder.
 */
export async function resolveVale(): Promise<string> {
  const candidates = [process.env.PULL_ME_VALE, "vale"].filter((c): c is string => !!c);
  for (const bin of candidates) {
    const version = await binaryVersion(bin);
    if (version && compareVersions(version, VALE_VERSION) >= 0) return bin;
  }

  const dir = cacheDir();
  const bin = path.join(dir, process.platform === "win32" ? "vale.exe" : "vale");
  if ((await binaryVersion(bin)) === VALE_VERSION) return bin;

  const suffix = platformAsset();
  const url = `https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}/vale_${VALE_VERSION}_${suffix}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new ValeError(`download failed (${response.status}): ${url}`);
  const archive = Buffer.from(await response.arrayBuffer());
  verifyChecksum(archive, suffix, url);

  // Extract in a private folder and move the binary into place: parallel runs must never see a half-written cache.
  fs.mkdirSync(dir, { recursive: true });
  const work = fs.mkdtempSync(path.join(dir, "tmp-"));
  try {
    const archivePath = path.join(work, `archive.${suffix.endsWith(".zip") ? "zip" : "tar.gz"}`);
    fs.writeFileSync(archivePath, archive);
    await run("tar", ["-xf", archivePath, "-C", work, path.basename(bin)]);
    fs.chmodSync(path.join(work, path.basename(bin)), 0o755);
    fs.renameSync(path.join(work, path.basename(bin)), bin);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return bin;
}

/** The folder with the shipped `.vale.ini`, styles and glossary: next to the sources, the lib/ bundles or the plugin bundle. */
export function shippedValeDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = [path.join(here, "vale"), path.join(here, "..", "vale"), path.join(here, "..", "..", "vale")].find(d =>
    fs.existsSync(path.join(d, ".vale.ini"))
  );
  if (!found) throw new ValeError(`the shipped Vale configuration is missing (looked next to ${here})`);
  return found;
}

/** Reads a glossary in Markdown: one `- **term**: explanation` per line. Other lines are ignored. */
export function parseGlossary(markdown: string): Record<string, string> {
  const terms: Record<string, string> = {};
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\*\*([^*]+)\*\*\s*[:—–-]\s*(.+?)\s*$/.exec(line);
    if (m) terms[m[1].trim()] = m[2];
  }
  return terms;
}

/** The glossary in force: the shipped base glossary, the repository's glossary file, then `vale.glossary`. */
export function loadGlossary(config: ResolvedConfig, root: string): Record<string, string> {
  const base = parseGlossary(fs.readFileSync(path.join(shippedValeDir(), "glossary.md"), "utf8"));
  const file = path.resolve(root, config.vale.glossaryFile ?? DEFAULT_GLOSSARY_FILE);
  const repo = fs.existsSync(file) ? parseGlossary(fs.readFileSync(file, "utf8")) : {};
  return { ...base, ...repo, ...(config.vale.glossary ?? {}) };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const yamlQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * Writes the Vale configuration for one run into `work`: the shipped style with the reference patterns, the glossary
 * terms and the known abbreviations filled in, and a `.vale.ini` with the rule levels of `.pull-me.json`. With
 * `vale.config` set, the repository's own `.vale.ini` is used as it is. Returns the path of the `.vale.ini`.
 */
export function writeValeConfig(
  work: string,
  config: ResolvedConfig,
  root: string,
  glossary: Record<string, string>
): string {
  if (config.vale.config) return path.resolve(root, config.vale.config);

  const shipped = shippedValeDir();
  const styleDir = path.join(work, "styles", STYLE);
  fs.mkdirSync(styleDir, { recursive: true });
  const references = [...DEFAULT_REFERENCE_PATTERNS, ...(config.vale.referencePatterns ?? [])].join("|");
  const terms = Object.keys(glossary)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp)
    .join("|");
  const known = [...(config.vale.abbreviations ?? []), ...Object.keys(glossary).filter(t => /^[A-Z]{2,6}$/.test(t))];

  for (const file of fs.readdirSync(path.join(shipped, "styles", STYLE))) {
    let text = fs.readFileSync(path.join(shipped, "styles", STYLE, file), "utf8");
    if (file === "BareReferences.yml") text = text.split("REFERENCE").join(references.replace(/'/g, "''"));
    if (file === "Glossary.yml") text = text.split("GLOSSARY").join((terms || "(?!x)x").replace(/'/g, "''"));
    if (file === "Abbreviations.yml" && known.length > 0) {
      text = `${text.trimEnd()}\n${known.map(k => `  - ${yamlQuote(k)}`).join("\n")}\n`;
    }
    fs.writeFileSync(path.join(styleDir, file), text);
  }

  const levels = Object.entries(config.vale.rules ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([rule, level]) =>
        `${rule} = ${level === "off" ? "NO" : level === "error" || level === "suggestion" ? level : "warning"}`
    );
  const ini = fs
    .readFileSync(path.join(shipped, ".vale.ini"), "utf8")
    .replace(/^StylesPath\s*=.*$/m, `StylesPath = ${path.join(work, "styles")}`);
  const file = path.join(work, ".vale.ini");
  fs.writeFileSync(file, `${ini.trimEnd()}\n${levels.join("\n")}\n`);
  return file;
}

/** One alert in Vale's JSON output. */
interface ValeAlert {
  Check: string;
  Line: number;
  Span: [number, number];
  Message: string;
  Severity: "error" | "warning" | "suggestion";
  Match: string;
}

/** Maps Vale's alerts to pull-me diagnostics. A glossary alert quotes the glossary's explanation in its hint. */
export function mapAlerts(alerts: ValeAlert[], glossary: Record<string, string> = {}): Diagnostic[] {
  const byTerm = new Map(Object.entries(glossary).map(([t, e]) => [t.toLowerCase(), e]));
  return alerts.map(a => {
    let hint = HINTS[a.Check];
    if (a.Check === `${STYLE}.Glossary` && byTerm.has(a.Match.toLowerCase())) {
      hint = `The glossary says: "${a.Match}: ${byTerm.get(a.Match.toLowerCase())}". Explain it in your own words, in brackets or after a colon.`;
    }
    return {
      rule: a.Check,
      level: a.Severity === "error" ? "error" : "warning",
      line: a.Line,
      column: a.Span[0],
      message: a.Message,
      hint,
      source: "vale" as const,
    };
  });
}

/** The body as Vale sees it: the generated block blanked out, so line numbers still match the original body. */
export function bodyForVale(body: string): string {
  return parseBody(body)
    .lines.map(l => (l.kind === "generated" ? "" : l.text))
    .join("\n");
}

/**
 * Runs Vale on a pull request body with the shipped style (or the repository's `.vale.ini`) and returns its alerts as
 * pull-me diagnostics. `root` is the repository, for `.pull-me.json` paths. Throws ValeError when Vale cannot run.
 */
export async function runVale(
  body: string,
  config: ResolvedConfig,
  root: string,
  vale?: string
): Promise<Diagnostic[]> {
  const bin = vale ?? (await resolveVale());
  const glossary = loadGlossary(config, root);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pull-me-vale-"));
  try {
    const ini = writeValeConfig(work, config, root, glossary);
    const file = path.join(work, "body.md");
    fs.writeFileSync(file, bodyForVale(body));
    let stdout: string;
    try {
      ({ stdout } = await run(bin, ["--output=JSON", "--no-exit", `--config=${ini}`, file], {
        cwd: work,
        timeout: VALE_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      }));
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message: string };
      throw new ValeError(`Vale failed: ${(e.stderr || e.stdout || e.message).trim().split("\n")[0]}`);
    }
    let parsed: Record<string, ValeAlert[]>;
    try {
      parsed = JSON.parse(stdout || "{}");
    } catch {
      throw new ValeError(`Vale printed output pull-me cannot read: ${stdout.slice(0, 200)}`);
    }
    return mapAlerts(Object.values(parsed).flat(), glossary);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
