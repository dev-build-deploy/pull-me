// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: MIT

import type { Register } from 'claude-code'

/**
 * Claude Code companion of PullMe: a pull request is not created or edited with a description that misses Why, How,
 * Review hints or Proof, or whose Proof has no evidence. The checking is the same deterministic pull-me CLI the GitHub
 * Action runs, bundled in `../bundle`; this hook only parses the gh command and calls it.
 */

/** What a `gh pr create` or `gh pr edit` command line carries. */
export type PrCommand = {
  action: 'create' | 'edit'
  body?: string
  bodyFile?: string
  title?: string
  draft: boolean
  attach: string[]
  fill: boolean
  web: boolean
}

// gh at the start of a command: the line start, or after ;, &&, ||, |, ( or a newline (not `echo gh pr create`).
const GH_PR = /(?:^|[;&|(\n])\s*gh\s+pr\s+(create|edit)(?=\s|$)/
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2(?=\s|\)|$)/

/** Splits the shell words of the first simple command, honouring quotes; stops at an unquoted operator. */
export function words(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      cur += text.slice(i + 1, end < 0 ? undefined : end)
      i = end < 0 ? text.length : end
      has = true
    } else if (c === '"') {
      i++
      for (; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\' && '"\\$`\n'.includes(text[i + 1] ?? '')) i++
        cur += text[i]
      }
      has = true
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[++i]
      has = true
    } else if (/\s/.test(c)) {
      if (c === '\n' && !has && out.length === 0) continue
      if (c === '\n') break
      if (has) out.push(cur)
      cur = ''
      has = false
    } else if (';&|'.includes(c)) {
      break
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/** Parses a `gh pr create` or `gh pr edit` command. Undefined: neither. */
export function parsePrCommand(command: string): PrCommand | undefined {
  const m = GH_PR.exec(command)
  if (!m) return undefined
  const rest = command.slice(m.index + m[0].length)
  const pr: PrCommand = { action: m[1] as 'create' | 'edit', draft: false, attach: [], fill: false, web: false }

  // A heredoc body: --body "$(cat <<'EOF' ... EOF)" or --body-file - <<'EOF' ... EOF
  const heredoc = HEREDOC.exec(rest)
  const beforeHeredoc = heredoc ? rest.slice(0, heredoc.index) : ''
  const heredocBody = heredoc && /(\s(-b|--body)\s+["']?\$\(|\s(-F|--body-file)\s+-(\s|$)|--body-file=-)/.test(beforeHeredoc)
  const args = words(heredocBody ? beforeHeredoc.replace(/\s(-b|--body)\s+["']?\$\(\s*cat\s*$/, ' --body __HEREDOC__') : rest)

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const value = (): string => args[++i] ?? ''
    if (a === '-b' || a === '--body') pr.body = value()
    else if (a.startsWith('--body=')) pr.body = a.slice(7)
    else if (a === '-F' || a === '--body-file') pr.bodyFile = value()
    else if (a.startsWith('--body-file=')) pr.bodyFile = a.slice(12)
    else if (a === '-t' || a === '--title') pr.title = value()
    else if (a.startsWith('--title=')) pr.title = a.slice(8)
    else if (a === '--attach') pr.attach.push(value().split('#')[0])
    else if (a.startsWith('--attach=')) pr.attach.push(a.slice(9).split('#')[0])
    else if (a === '-d' || a === '--draft') pr.draft = true
    else if (a === '-f' || a === '--fill' || a === '--fill-first' || a === '--fill-verbose') pr.fill = true
    else if (a === '-w' || a === '--web') pr.web = true
  }
  if (heredoc && heredocBody) {
    pr.body = heredoc[3]
    pr.bodyFile = undefined
  }
  return pr
}

/** A small, stable hash of a body (FNV-1a), to remember which bodies were already warned about. */
export function bodyHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/** The answer of `pull-me check --format hook`, or undefined when pull-me could not run. */
export function parseHook(exitCode: number, stdout: string): { errors: number; warnings: number; text: string } | undefined {
  if (exitCode !== 0 && exitCode !== 1) return undefined
  try {
    const parsed = JSON.parse(stdout) as { errors: number; warnings: number; text: string }
    return typeof parsed.errors === 'number' ? parsed : undefined
  } catch {
    return undefined
  }
}

export const TEMPLATE = [
  '## Why',
  'The value: what this achieves, for whom, and which issue or decision asks for it (say what it says).',
  '## How',
  'The choices and their reasons, not a file list.',
  '## Review hints',
  'The riskiest part first, the known gaps, what was not tested.',
  '## Proof',
  'Test output in a fenced block, links to the CI runs (.../actions/runs/<id>), screenshots (--attach shot.png).',
].join('\n')

const NOTHING = 'Nothing was created or changed; fix the body and run the command again.'
const SKILL = 'The writing-pull-requests skill shows how to write each section.'

export const register: Register = on => {
  const warned = new Set<string>()
  // One toast per session when the check cannot run: a broken checker must not lock the session; CI is the gate.
  let noted = false
  const once = (why: string): string | undefined => {
    if (noted) return undefined
    noted = true
    return `pull-me: description not checked (${why}).`
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const pr = parsePrCommand(e.command)
    if (!pr || pr.web) return next(e)
    if (pr.action === 'create' && pr.fill) {
      return {
        deny: `pull-me: gh pr create --fill takes the description from the commits, so it has none of the four sections. ${NOTHING}\nGive a body with --body-file (or --body) that has these sections:\n${TEMPLATE}\n${SKILL}`,
      }
    }
    if (pr.body === undefined && pr.bodyFile === undefined) {
      if (pr.action === 'edit') return next(e)
      return {
        deny: `pull-me: gh pr create needs a description: pass --body-file (or --body) with these sections:\n${TEMPLATE}\n${SKILL}`,
      }
    }

    const cwd = await $.session.cwd()
    let body = pr.body
    if (body === undefined && pr.bodyFile && pr.bodyFile !== '-') {
      try {
        body = await $.fs.read(pr.bodyFile.startsWith('/') ? pr.bodyFile : `${cwd}/${pr.bodyFile}`)
      } catch {
        return next(e) // gh reports an unreadable file itself
      }
    }
    if (body === undefined || body.includes('$(')) {
      const toast = once('the body is built by the shell')
      if (toast) $.ui.toast(toast)
      return next(e)
    }

    const argv = ['node', `${$.plugin.root}/bundle/index.js`, 'check', '--stdin', '--format', 'hook']
    if (pr.title) argv.push('--title', pr.title)
    if (pr.draft) argv.push('--draft')
    if (pr.attach.length > 0) argv.push('--attach', ...pr.attach)
    const run = await $.process
      .run(argv, { cwd, stdin: body, timeoutMs: 120000 })
      .catch(() => undefined)
    const result = run ? parseHook(run.exitCode, run.stdout) : undefined
    if (!result) {
      const toast = once((run?.stderr || 'node is not available').trim().split('\n')[0])
      if (toast) $.ui.toast(toast)
      return next(e)
    }

    if (result.errors > 0) {
      return {
        deny: `pull-me: the pull request description has ${result.errors} error(s) and ${result.warnings} warning(s). ${NOTHING}\n\n${result.text}\n\nEvery description has these sections:\n${TEMPLATE}\n${SKILL}`,
      }
    }
    if (result.warnings > 0) {
      // Warnings deny once per body: Claude rereads the text, and the same body sent again goes through,
      // so a false positive never blocks the work.
      const key = bodyHash(body)
      if (!warned.has(key)) {
        warned.add(key)
        return {
          deny: `pull-me: the description passes, but has ${result.warnings} warning(s) a junior engineer would trip over. Nothing was created or changed yet.\n\n${result.text}\n\nFix them, or send the same body again to keep it as it is. ${SKILL}`,
        }
      }
    }
    return next(e)
  })
}
