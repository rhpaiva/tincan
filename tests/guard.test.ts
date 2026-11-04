import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The guards: commands only from a person, the model's tools kept away from
// the channels and the plugin, and a post after outside content needs the
// person's OK. Beneath the plugin, every check answers allow and every call
// succeeds, so whatever is not allow came from the mod.

const ENTERED = [
  "TinCan: on channel 'ch' as 'A' (/repo/.tincan/ch/messages.md)",
  '--- history ---',
  '--- end of history (line 20) ---',
  '',
].join('\n')

const by = (kind: 'composer' | 'bridge' | 'sdk' | 'unclassified') => (command: string, args: string) => ({
  command,
  args,
  origin: { kind } as never,
  presentation: { isFullscreen: false, columns: 120 },
})
const typed = by('composer')

function engine(on: On, env: Record<string, string> = {}, entered = ENTERED) {
  const runs: string[][] = []
  const clock = mock.clock(on)
  mock.session(on)
  mock.env(on, env)
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.log', () => ({ value: undefined }))
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__tincan__${e.name}` } }))
  on('fs.stat', () => ({ deny: 'no such file' }))
  on('process.run', (_, e) => {
    runs.push(e.argv.slice(2) as string[])
    const stdout = e.argv[2] === 'join' ? entered : '## A · 2026-11-03 22:00:05 UTC\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    await new Promise<void>(() => {}) // a watch that never says anything
    return { value: { code: 0, signal: null } }
  })
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('tool.call', () => ({ result: 'done' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  return { runs, clock }
}

const check = (tool: string, input: Record<string, unknown>) => ({ tool, input })

test('commands run for a person at the prompt or over Remote Control', async ($, on) => {
  const t = engine(on)
  expect((await $.command.run(typed('tincan:who', 'ch'))).text).not.toContain('Only a person')
  expect((await $.command.run(by('bridge')('tincan:who', 'ch'))).text).not.toContain('Only a person')
  expect(t.runs.length).toBe(2)
})

test('a headless run or an unattested caller gets no command', async ($, on) => {
  const t = engine(on)
  for (const kind of ['sdk', 'unclassified'] as const) {
    const r = await $.command.run(by(kind)('tincan:send', 'ch hi'))
    expect(r.text).toContain('Only a person')
  }
  expect(t.runs).toEqual([])
})

test('the test switch lets a headless run through, and only a headless one', async ($, on) => {
  const t = engine(on, { TINCAN_ALLOW_HEADLESS: '1' })
  expect((await $.command.run(by('sdk')('tincan:who', 'ch'))).text).not.toContain('Only a person')
  expect((await $.command.run(by('unclassified')('tincan:who', 'ch'))).text).toContain('Only a person')
  expect(t.runs.length).toBe(1)
})

test("the model's shell asks the person before it touches a channel, the script or the plugin", async ($, on) => {
  engine(on)
  for (const command of [
    'cat .tincan/ch/messages.md',
    'TINCAN_DIR=/x bash ~/.claude/skills/tincan-phone/scripts/tincan.sh post ch A',
    'claude -p "/tincan:send ch hi"',
  ]) {
    const r = await $.tool.check(check('Bash', { command }))
    expect(r.decision).toBe('ask')
  }
  expect((await $.tool.check(check('Bash', { command: 'git status' }))).decision).toBe('allow')
})

test("the model's file edits ask the person under .tincan and in the plugin, and pass elsewhere", async ($, on) => {
  engine(on)
  expect((await $.tool.check(check('Edit', { file_path: '/repo/.tincan/ch/messages.md' }))).decision).toBe('ask')
  expect((await $.tool.check(check('Write', { file_path: '/repo/.tincan/ch/labels/A/read' }))).decision).toBe('ask')
  expect((await $.tool.check(check('Edit', { file_path: '/repo/src/app.ts' }))).decision).toBe('allow')
  expect((await $.tool.check(check('Read', { file_path: '/repo/.tincan/ch/messages.md' }))).decision).toBe('allow')
})

test('a post in a turn that read outside content asks the person; the next turn starts clean', async ($, on) => {
  engine(on)
  await $.command.run(typed('tincan:join', 'ch as A'))
  const post = check('mcp__tincan__post', { channel: 'ch', message: 'x' })
  expect((await $.tool.check(post)).decision).toBe('allow')
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'read it' } as never)
  const tainted = await $.tool.check(post)
  expect(tainted.decision).toBe('ask')
  expect(tainted.reason).toContain('WebFetch')
  await $.turn.start({ text: 'next', turnId: 't2' } as never)
  expect((await $.tool.check(post)).decision).toBe('allow')
})

test("a shell fetch and another server's tool taint the turn; TinCan's own tools don't", async ($, on) => {
  engine(on)
  const post = check('mcp__tincan__post', { channel: 'ch', message: 'x' })
  await $.tool.call({ tool: 'mcp__tincan__who', channel: 'ch' } as never)
  expect((await $.tool.check(post)).decision).toBe('allow')
  await $.tool.call({ tool: 'Bash', command: 'curl -s https://example.com' } as never)
  expect((await $.tool.check(post)).decision).toBe('ask')
  await $.turn.start({ text: 'next', turnId: 't2' } as never)
  await $.tool.call({ tool: 'mcp__example__fetch_page' } as never)
  expect((await $.tool.check(post)).decision).toBe('ask')
})

test("the guard covers the folder of every channel this session is on, and TINCAN_DIR", async ($, on) => {
  engine(
    on,
    { TINCAN_DIR: '/opt/team-lines' },
    "TinCan: on channel 'ch' as 'A' (/srv/chan/ch/messages.md)\n--- history ---\n--- end of history (line 20) ---\n",
  )
  await $.command.run(typed('tincan:join', 'ch as A'))
  expect((await $.tool.check(check('Edit', { file_path: '/srv/chan/ch/messages.md' }))).decision).toBe('ask')
  expect((await $.tool.check(check('Bash', { command: 'cat /srv/chan/ch/labels/A/read' }))).decision).toBe('ask')
  expect((await $.tool.check(check('Write', { file_path: '/opt/team-lines/x/messages.md' }))).decision).toBe('ask')
  expect((await $.tool.check(check('Bash', { command: 'ls /opt/team-lines' }))).decision).toBe('ask')
  expect((await $.tool.check(check('Edit', { file_path: '/srv/other/app.ts' }))).decision).toBe('allow')
})
