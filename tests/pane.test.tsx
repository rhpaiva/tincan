import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The pane against a stand-in engine: tincan.sh and the channel file are the
// test's own. Every value here is sample data.

// Sessions here hold this secret, as a headless test run may (TINCAN_ALLOW_HEADLESS=1): sample data.
const SIGNED = { TINCAN_ALLOW_HEADLESS: '1', TINCAN_TEST_SECRET: 'tc1-abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst' }

const ENTERED = [
  "TinCan: on channel 'ch' as 'A' (/repo/.tincan/ch/messages.md)",
  '--- history ---',
  '--- end of history (line 20) ---',
  '',
].join('\n')

const FILE = [
  '# TinCan · ch',
  '',
  'Rules for every session on this line:',
  '- (sample rules)',
  '',
  '## A · 2026-11-03 22:18:02 UTC',
  '',
  'joined · session aaaaaaaa',
  '',
  '## B · 2026-11-03 22:22:39 UTC',
  '',
  'Which branch or worktree are you on right now?',
  'And which plan?',
  '',
  '## A · 2026-11-03 22:25:00 UTC',
  '',
  'main, no plan open.',
  '',
  '## user · 2026-11-03 22:30:01 UTC',
  '',
  'restarting the stack in 5 min',
  '',
].join('\n')

// A's own message: where its header is in FILE, which the receipts compare with.
const OWN = FILE.split('\n').indexOf('## A · 2026-11-03 22:25:00 UTC') + 1
// B has read past it; C's watch delivered it but C hasn't read it: '✓', not '✓✓'.
const STATE: Record<string, string> = {
  '/repo/.tincan/ch/messages.md': FILE,
  '/repo/.tincan/ch/labels/B/seen': `${OWN + 8}`,
  '/repo/.tincan/ch/labels/B/read': `${OWN + 8} 2026-11-03 22:31:00 UTC`,
  '/repo/.tincan/ch/labels/C/seen': `${OWN + 8}`,
}

// Paths the stand-in folder holds as symbolic links.
const LINKED = new Set<string>()

const WHO = "channel 'ch' is open; your last message: ## A · 2026-11-03 22:25:00 UTC\n  B: watching, read\n  C: not watching, delivered, not read\n"

const PANE_PROPS = {
  plugin: 'tincan',
  component: 'Pane',
  requestId: 'tincan',
  props: {
    title: 'TinCan',
    isFocused: true,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'sdk' as const }, // a headless test run, which may name its secret
  presentation: { isFullscreen: false, columns: 120 },
})

function engine(on: On) {
  const runs: { args: string[]; stdin?: string }[] = []
  mock.clock(on)
  mock.session(on)
  mock.env(on, SIGNED)
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  let isOpen = false
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: isOpen ? ([{ id: 'tincan', title: 'TinCan' }] as never) : [] }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__tincan__${e.name}` } }))
  on('fs.read', (_, e) => (e.path in STATE ? { value: STATE[e.path]! } : { deny: 'no such file' }))
  on('fs.stat', (_, e) =>
    e.path in STATE
      ? { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: LINKED.has(e.path) } }
      : { deny: 'no such file' },
  )
  on('process.run', (_, e) => {
    const args = e.argv.slice(2) as string[]
    runs.push({ args, stdin: e.init?.stdin })
    const stdout = args[0] === 'join' ? ENTERED : args[0] === 'who' ? WHO : '## user · 2026-11-03 22:31:00 UTC\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    await new Promise<void>(() => {})
    return { value: { code: 0, signal: null } }
  })
  return { runs, isOpen: () => isOpen }
}

test('before any join the pane says to join first', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE_PROPS, surface })
    expect((await ui.find({ type: 'Text', text: /Not on any channel/ }))?.text).toContain('/tincan:join')
    await ui.unmount()
  }
})

test('the pane shows the channels, each message in full, your receipts and who is watching', async ($, on) => {
  engine(on)
  await $.command.run(typed('tincan:join', 'ch as A'))
  const opened = await $.command.run(typed('tincan:show', ''))
  expect(opened.text).toContain('Opened the TinCan pane')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE_PROPS, surface })
    expect((await ui.find({ type: 'Text', text: 'Channels:' }))?.text).toBe('Channels:')
    expect((await ui.find({ key: 'tab-0' }))?.text).toBe('[ ch ]')
    expect((await ui.find({ type: 'Text', text: /^B$/ }))?.text).toBe('B')
    expect((await ui.find({ type: 'Text', text: '22:22:39' }))?.text).toBe('22:22:39')
    expect((await ui.find({ key: 'body-1' }))?.text).toContain('And which plan?')
    expect((await ui.findAll({ type: 'Text', text: /^✓+$/ })).map((t) => t.text)).toEqual(['✓'])
    expect((await ui.find({ type: 'Text', text: /joined/ }))?.text).toBe('A joined')
    expect((await ui.find({ type: 'Text', text: '📣 user' }))?.text).toBe('📣 user')
    expect((await ui.findAll({ type: 'Text', text: /^[●○] / })).map((t) => t.text)).toEqual(['● A', '● B', '○ C away'])
    expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text).toBe('─'.repeat(48))
    expect(await ui.find({ key: 'say' })).toBeDefined()
    await ui.unmount()
  }
})

test('once every other session has read your message it gets ✓✓', async ($, on) => {
  engine(on)
  STATE['/repo/.tincan/ch/labels/C/read'] = `${OWN + 8} 2026-11-03 22:32:00 UTC`
  try {
    await $.command.run(typed('tincan:join', 'ch as A'))
    await $.command.run(typed('tincan:show', 'ch'))
    const ui = await $.ui.mount({ ...PANE_PROPS, surface: 'terminal' })
    expect((await ui.findAll({ type: 'Text', text: /^✓+$/ })).map((t) => t.text)).toEqual(['✓✓'])
    await ui.unmount()
  } finally {
    delete STATE['/repo/.tincan/ch/labels/C/read']
  }
})

test('Enter in the box broadcasts as user on the channel shown', async ($, on) => {
  const t = engine(on)
  await $.command.run(typed('tincan:join', 'ch as A'))
  await $.command.run(typed('tincan:show', ''))
  const ui = await $.ui.mount({ ...PANE_PROPS, surface: 'terminal' })
  await ui.input({ key: 'say', text: 'stack is back up' })
  const post = t.runs.find((r) => r.args[0] === 'post')
  expect(post?.args).toEqual(['post', 'ch', 'user'])
  expect(post?.stdin).toBe('stack is back up')
  await ui.unmount()
})

test('show refuses a channel this session is not on', async ($, on) => {
  engine(on)
  const r = await $.command.run(typed('tincan:show', 'other'))
  expect(r.text).toContain("isn't on 'other'")
})

test('/tincan:show with no channel closes an open pane, and the close button does too', async ($, on) => {
  const t = engine(on)
  await $.command.run(typed('tincan:join', 'ch as A'))
  expect((await $.command.run(typed('tincan:show', ''))).text).toContain('Opened')
  expect(t.isOpen()).toBe(true)
  expect((await $.command.run(typed('tincan:show', ''))).text).toContain('Closed the TinCan pane')
  expect(t.isOpen()).toBe(false)
  await $.command.run(typed('tincan:show', 'ch'))
  const ui = await $.ui.mount({ ...PANE_PROPS, surface: 'terminal' })
  await ui.press({ key: 'close' })
  expect(t.isOpen()).toBe(false)
  await ui.unmount()
})

test('a channel file that is a symbolic link is not read: the pane shows no messages', async ($, on) => {
  engine(on)
  LINKED.add('/repo/.tincan/ch/messages.md')
  try {
    await $.command.run(typed('tincan:join', 'ch as A'))
    await $.command.run(typed('tincan:show', 'ch'))
    const ui = await $.ui.mount({ ...PANE_PROPS, surface: 'terminal' })
    expect(await ui.find({ key: 'body-1' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^B$/ })).toBeUndefined()
    await ui.unmount()
  } finally {
    LINKED.clear()
  }
})
