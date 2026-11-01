/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

/** The markers around the part of the body that `pull-me body` writes. */
export const GENERATED_START = "<!-- pull-me:generated:start -->";
export const GENERATED_END = "<!-- pull-me:generated:end -->";

/** What one line of the body is, after the block-level scan. */
export type LineKind = "text" | "heading" | "fence" | "code" | "comment" | "generated";

/** One line of the body. `number` is 1-based, as editors and diagnostics count. */
export interface BodyLine {
  number: number;
  text: string;
  kind: LineKind;
  /** The rule ids switched off on this line by a trailing `<!-- pull-me-ignore PM005 -->`. */
  ignore: string[];
}

/** A `##` section of the body. */
export interface Section {
  /** The heading text as written ("Review hints"). */
  title: string;
  /** The line of the heading. */
  line: number;
  /** The lines under the heading, up to the next `#` or `##` heading. */
  lines: BodyLine[];
}

/** A pull request body, split into lines and sections. */
export interface ParsedBody {
  lines: BodyLine[];
  sections: Section[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const IGNORE = /<!--\s*pull-me-ignore\s+([A-Za-z0-9_., -]+?)\s*-->\s*$/;

/**
 * Splits a body into lines and `##` sections. Fenced code blocks, HTML comments and the generated block are marked,
 * so no rule reads a heading or an image inside them. Windows line ends are treated as Unix ones.
 */
export function parseBody(body: string): ParsedBody {
  const raw = body.replace(/\r\n?/g, "\n").split("\n");
  const lines: BodyLine[] = [];
  let fence: string | undefined;
  let inComment = false;
  let inGenerated = false;

  for (let i = 0; i < raw.length; i++) {
    const text = raw[i];
    const ignore =
      IGNORE.exec(text)?.[1]
        .split(/[\s,]+/)
        .filter(Boolean) ?? [];
    let kind: LineKind = "text";
    const trimmed = text.trim();

    if (inGenerated) {
      kind = "generated";
      if (trimmed === GENERATED_END) inGenerated = false;
    } else if (fence) {
      const close = FENCE.exec(text);
      if (close && close[1].startsWith(fence[0]) && close[1].length >= fence.length && text.trim() === close[1]) {
        kind = "fence";
        fence = undefined;
      } else {
        kind = "code";
      }
    } else if (inComment) {
      kind = "comment";
      if (text.includes("-->")) inComment = false;
    } else if (trimmed === GENERATED_START) {
      kind = "generated";
      inGenerated = true;
    } else if (FENCE.test(text)) {
      kind = "fence";
      fence = FENCE.exec(text)?.[1];
    } else if (trimmed.startsWith("<!--") && stripInlineComments(trimmed).trim() === "") {
      kind = "comment";
    } else if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
      kind = "comment";
      inComment = true;
    } else if (HEADING.test(text)) {
      kind = "heading";
    }
    lines.push({ number: i + 1, text, kind, ignore });
  }

  const sections: Section[] = [];
  let current: Section | undefined;
  for (const line of lines) {
    if (line.kind === "heading") {
      const [, hashes, title = ""] = HEADING.exec(line.text) ?? [];
      if (hashes.length <= 2) {
        current = hashes.length === 2 ? { title: title.trim(), line: line.number, lines: [] } : undefined;
        if (current) sections.push(current);
        continue;
      }
    }
    current?.lines.push(line);
  }
  return { lines, sections };
}

/** Normalises a heading for matching: lower case, single spaces, no trailing colon. */
export function normaliseHeading(title: string): string {
  return title.replace(/[*_`]/g, "").replace(/:$/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The lines of a section that an author wrote: no comments, no generated block, no blank lines. */
export function authorLines(section: Section): BodyLine[] {
  return section.lines.filter(l => l.kind !== "comment" && l.kind !== "generated" && l.text.trim() !== "");
}

/** Removes inline HTML comments from a line of text, until none is left (a removal can join two halves into one). */
export function stripInlineComments(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return current;
}
