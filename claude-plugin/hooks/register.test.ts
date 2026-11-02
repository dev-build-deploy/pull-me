// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: MIT

import { expect, test } from 'claude-code/testing'

import { bodyHash, parsePrCommand, resolvePath, shellExpands } from './register'

const ROOT = '/private/tmp/pull-me-plugin-test'

const GOOD = '## Why\nW\n## How\nH\n## Review hints\nR\n## Proof\n```\nok\n```\n'
const NO_PROOF = '## Why\nW\n## How\nH\n## Review hints\nR\n'
const WORDY = `${GOOD}\nIt is very fast.\n`

// Stands for the engine beneath the plugin. `process.run` plays the bundled CLI (`check --format hook`): the real
// rules and Vale are covered by the jest suite in test/; here we test what the hook does with the CLI's answers.
function fakeCli(argv: string[], stdin: string) {
  const out = (errors: number, warnings: number, text: string) => ({
    exitCode: errors > 0 ? 1 : 0,
    stdout: JSON.stringify({ errors, warnings, text }),
    stderr: '',
  })
  const attached = argv.includes('--attach') && argv.includes('./shot.png')
  if (stdin.includes('](./shot.png)') && !attached) return out(1, 0, 'line 9: error: [PM005] The image "./shot.png" points to a local path.')
  if (!stdin.includes('## Proof')) return out(1, 0, 'line 1: error: [PM001] The "Proof" section is missing.')
  if (stdin.includes('very')) return out(0, 1, 'line 12: warning: [DevBuildDeploy.Weasel] \'very\' weakens the sentence.')
  return out(0, 0, '')
}

async function setup($: any, on: any, opts: { broken?: boolean; files?: Record<string, string> } = {}) {
  let reached: any
  const runs: { argv: string[]; stdin: string }[] = []
  on('tool.call', (_: any, e: any) => {
    reached = e
    return { result: {} }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.read', (_: any, e: any) => {
    const text = opts.files?.[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('process.run', (_: any, e: any) => {
    const stdin = e.init?.stdin ?? ''
    runs.push({ argv: e.argv, stdin })
    const r = opts.broken ? { exitCode: 2, stdout: '', stderr: 'pull-me: error: Vale failed' } : fakeCli(e.argv, stdin)
    return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  return {
    runs,
    call: async (command: string) => {
      reached = undefined
      const r = await $.tool.call({ tool: 'Bash', command })
      return { text: JSON.stringify(r), reached }
    },
  }
}

const q = (body: string) => `'${body.replace(/'/g, "'\\''")}'`

test('a body without Proof is denied with the sections to write', async ($, on) => {
  const t = await setup($, on)
  const { text, reached } = await t.call(`gh pr create --title "feat: x" --body ${q(NO_PROOF)}`)
  expect(reached).toBeUndefined()
  expect(text).toContain('[PM001]')
  expect(text).toContain('Nothing was created or changed')
  expect(text).toContain('## Review hints')
  expect(t.runs[0].argv).toEqual(expect.arrayContaining(['check', '--stdin', '--format', 'hook', '--title', 'feat: x']))
})

test('a complete body passes', async ($, on) => {
  const t = await setup($, on)
  const { reached } = await t.call(`gh pr create --title "feat: x" --body ${q(GOOD)}`)
  expect(reached.command).toContain('gh pr create')
})

test('a body file is read from the session folder; a heredoc body is checked', async ($, on) => {
  const t = await setup($, on, { files: { [`${ROOT}/body.md`]: NO_PROOF } })
  expect((await t.call('gh pr create -t x -F body.md')).reached).toBeUndefined()
  const heredoc = `gh pr edit 3 --body-file - <<'EOF'\n${GOOD}EOF`
  expect((await t.call(heredoc)).reached.command).toBe(heredoc)
  const subst = `gh pr create --title x --body "$(cat <<'EOF'\n${NO_PROOF}EOF\n)"`
  expect((await t.call(subst)).reached).toBeUndefined()
})

test('a body file in a shell variable or after cd is never let through unchecked', async ($, on) => {
  const t = await setup($, on, { files: { [`${ROOT}/sub/body.md`]: NO_PROOF, '/abs/body.md': NO_PROOF } })
  // the shell expands $S before gh reads it: the hook cannot read it, so it asks for the path written out
  const variable = await t.call('S=/abs; gh pr create -t x --body-file $S/body.md')
  expect(variable.reached).toBeUndefined()
  expect(variable.text).toContain('expanded by the shell')
  expect((await t.call('gh pr edit 3 --body-file ~/body.md')).reached).toBeUndefined()
  expect((await t.call('cd $HOME && gh pr edit 3 -F body.md')).reached).toBeUndefined()
  // a relative path after cd is read from that folder, and checked
  const cd = await t.call('cd sub && gh pr create -t x -F body.md')
  expect(cd.reached).toBeUndefined()
  expect(cd.text).toContain('[PM001]')
  expect((await t.call('cd /elsewhere && gh pr create -t x -F /abs/body.md')).text).toContain('[PM001]')
  // a file that cannot be read is denied, not passed unchecked
  const missing = await t.call('gh pr create -t x -F nope.md')
  expect(missing.reached).toBeUndefined()
  expect(missing.text).toContain('cannot read the body file')
  expect(t.runs).toHaveLength(2)
})

test('--fill is denied, and so is gh pr create without a body', async ($, on) => {
  const t = await setup($, on)
  expect((await t.call('gh pr create --fill')).text).toContain('--fill takes the description from the commits')
  expect((await t.call('gh pr create --title x')).text).toContain('needs a description')
  expect(t.runs).toHaveLength(0)
})

test('a label-only edit, --web and other commands pass unchecked', async ($, on) => {
  const t = await setup($, on)
  expect((await t.call('gh pr edit 3 --add-label bug')).reached).toBeDefined()
  expect((await t.call('gh pr create --web')).reached).toBeDefined()
  expect((await t.call('gh pr view 3')).reached).toBeDefined()
  expect((await t.call('echo gh pr create')).reached).toBeDefined()
  expect(t.runs).toHaveLength(0)
})

test('warnings deny once per body; the same body again goes through', async ($, on) => {
  const t = await setup($, on)
  const command = `gh pr create --title x --body ${q(WORDY)}`
  const first = await t.call(command)
  expect(first.reached).toBeUndefined()
  expect(first.text).toContain('send the same body again')
  expect((await t.call(command)).reached).toBeDefined()
})

test('a local image that is also attached counts', async ($, on) => {
  const t = await setup($, on)
  const body = `${GOOD}\n![shot](./shot.png)\n`
  expect((await t.call(`gh pr edit 3 --body ${q(body)}`)).reached).toBeUndefined()
  expect((await t.call(`gh pr edit 3 --body ${q(body)} --attach './shot.png#The screen'`)).reached).toBeDefined()
})

test('a checker that cannot run does not lock the session', async ($, on) => {
  const t = await setup($, on, { broken: true })
  expect((await t.call(`gh pr create --title x --body ${q(NO_PROOF)}`)).reached).toBeDefined()
})

test('parsePrCommand reads the flags', () => {
  expect(parsePrCommand('cd x && gh pr create -d -t "feat: y" -b body --attach a.png#alt')).toEqual({
    action: 'create',
    body: 'body',
    title: 'feat: y',
    draft: true,
    attach: ['a.png'],
    fill: false,
    web: false,
    cd: 'x',
  })
  expect(parsePrCommand('cd /a && cd b/c; gh pr edit 3 -F d.md')?.cd).toBe('/a/b/c')
  expect(parsePrCommand('gh pr list')).toBeUndefined()
  expect(shellExpands('$S/body.md')).toBe(true)
  expect(shellExpands('~/body.md')).toBe(true)
  expect(shellExpands('/tmp/body.md')).toBe(false)
  expect(resolvePath('/a/b', '../c/./d.md')).toBe('/a/c/d.md')
  expect(bodyHash('a')).not.toBe(bodyHash('b'))
})
