import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The session's secret: /tincan:key, its box, and the commands that wait for it.
// Every secret, channel and label here is sample data.

const SECRET = 'tc1-abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst'

const ENTERED = [
  "TinCan: on channel 'ch' as 'A' (/repo/.tincan/ch/messages.md)",
  '--- history ---',
  '--- end of history (line 20) ---',
  '',
].join('\n')

const KEY_PROPS = {
  plugin: 'tincan',
  component: 'Pane',
  requestId: 'tincan-key',
  props: {
    title: 'TinCan secret',
    isFocused: true,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

function engine(on: On, env: Record<string, string> = {}) {
  const runs: string[][] = []
  const opened: { id: string; focus?: boolean; closeOnEscape?: boolean; holdToasts?: boolean }[] = []
  const status: (string | undefined)[] = []
  const clock = mock.clock(on)
  const session = mock.session(on)
  mock.env(on, env)
  let open = new Set<string>()
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    opened.push(e)
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...open].map((id) => ({ id, title: id })) as never }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__tincan__${e.name}` } }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(2) as string[]
    runs.push(args)
    const stdout = args[0] === 'join' || args[0] === 'open' ? ENTERED : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    await new Promise<void>(() => {})
    return { value: { code: 0, signal: null } }
  })
  const rows = (type: 'system' | 'user') =>
    session
      .appended()
      .filter((r) => r.message.type === type)
      .map((r) => JSON.stringify(r.message.content))
  return { runs, opened, status, clock, isOpen: (id: string) => open.has(id), notices: () => rows('system'), notes: () => rows('user') }
}

test('/tincan:key opens a box that takes the keyboard, and a pasted secret sets it', async ($, on) => {
  const t = engine(on)
  const r = await $.command.run(typed('tincan:key', ''))
  expect(r.text).toContain('Paste your TinCan secret in the TinCan box')
  expect(t.opened.at(-1)).toMatchObject({ id: 'tincan-key', focus: true, closeOnEscape: true, holdToasts: true })
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  await ui.input({ key: 'secret', text: `  ${SECRET}\n` })
  await t.clock.settle()
  expect(t.isOpen('tincan-key')).toBe(false)
  expect(t.notices().join('\n')).toMatch(/secret is set · [0-9a-f]{4}·[0-9a-f]{4}/)
  expect(t.status.at(-1)).toMatch(/^TinCan [0-9a-f]{4}·[0-9a-f]{4}$/)
  // The secret itself is in no row, no notice and no status.
  expect([...t.notices(), ...t.notes(), ...t.status.map(String)].join('\n')).not.toContain(SECRET)
  await ui.unmount()
})

test('what is typed into the box is drawn as dots', async ($, on) => {
  engine(on)
  await $.command.run(typed('tincan:key', ''))
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  await ui.input({ key: 'secret', text: SECRET.slice(0, 10), kind: 'change' })
  expect((await ui.find({ key: 'secret' }))?.props.value).toBe('•'.repeat(10))
  await ui.input({ key: 'secret', text: `${'•'.repeat(10)}${SECRET.slice(10)}`, kind: 'change' })
  expect((await ui.find({ key: 'secret' }))?.props.value).toBe('•'.repeat(SECRET.length))
  await ui.input({ key: 'secret', text: '•'.repeat(SECRET.length - 1), kind: 'change' })
  expect((await ui.find({ key: 'secret' }))?.props.value).toBe('•'.repeat(SECRET.length - 1))
  await ui.unmount()
})

test('a paste that is no secret says so and keeps the box open', async ($, on) => {
  const t = engine(on)
  await $.command.run(typed('tincan:key', ''))
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  await ui.input({ key: 'secret', text: 'hunter2' })
  await t.clock.settle()
  expect((await ui.find({ type: 'Text', text: /isn't a TinCan secret/ }))?.text).toContain('tc1-')
  expect(t.isOpen('tincan-key')).toBe(true)
  expect(t.notices().join('\n')).not.toContain('secret is set')
  await ui.unmount()
})

test('/tincan:key new makes a secret, shows it once in the box, and sets it', async ($, on) => {
  const t = engine(on)
  const r = await $.command.run(typed('tincan:key', 'new'))
  expect(r.text).toContain('password manager')
  expect(r.text).not.toMatch(/tc1-[a-z2-7]{52}/)
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  const shown = (await ui.find({ type: 'Text', text: /^tc1-/ }))?.text ?? ''
  expect(shown).toMatch(/^tc1-[a-z2-7]{52}$/)
  expect([...t.notices(), ...t.notes()].join('\n')).not.toContain(shown)
  await ui.press({ key: 'done' })
  await t.clock.settle()
  expect(t.isOpen('tincan-key')).toBe(false)
  expect(t.notices().join('\n')).toMatch(/secret is set/)
  await ui.unmount()
  // Drawn again, the box no longer shows it.
  await $.command.run(typed('tincan:key', ''))
  const again = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /^tc1-/ })).toBeUndefined()
  await again.unmount()
})

test('a new secret is never drawn on a phone', async ($, on) => {
  engine(on)
  await $.command.run(typed('tincan:key', 'new'))
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'mobile' })
  expect(await ui.find({ type: 'Text', text: /tc1-/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /at your computer/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('a join without the secret waits for it, then runs once it is pasted', async ($, on) => {
  const t = engine(on)
  const r = await $.command.run(typed('tincan:join', 'ch as A'))
  expect(r.text).toContain('to finish /tincan:join ch as A')
  expect(t.runs.some((a) => a[0] === 'join')).toBe(false)
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /to finish \/tincan:join ch as A/ }))?.text).toBeDefined()
  await ui.input({ key: 'secret', text: SECRET })
  await t.clock.settle()
  expect(t.runs.some((a) => a[0] === 'join' && a[1] === 'ch')).toBe(true)
  expect(t.notices().join('\n')).toContain("On channel 'ch' as 'A'")
  expect(t.notes().join('\n')).toContain("put this session on channel 'ch'")
  await ui.unmount()
})

test('cancelling the box without a paste drops what waited, and says so', async ($, on) => {
  const t = engine(on)
  await $.command.run(typed('tincan:send', 'ch hi'))
  const ui = await $.ui.mount({ ...KEY_PROPS, surface: 'terminal' })
  await ui.press({ key: 'cancel' })
  await t.clock.settle()
  await ui.unmount()
  expect(t.isOpen('tincan-key')).toBe(false)
  expect(t.notices().join('\n')).toContain("/tincan:send ch hi didn't run")
  expect(t.runs.some((a) => a[0] === 'post')).toBe(false)
})

test('the model cannot post before the session has its secret', async ($, on) => {
  engine(on)
  const r = await $.tool.call({ tool: 'mcp__tincan__post', channel: 'ch', message: 'x' } as never)
  expect(JSON.stringify(r)).toContain('/tincan:key')
})

test('a test run may name its secret, but only with the headless switch on', async ($, on) => {
  const t = engine(on, { TINCAN_ALLOW_HEADLESS: '1', TINCAN_TEST_SECRET: SECRET })
  const r = await $.command.run(typed('tincan:join', 'ch as A'))
  expect(r.text).toContain("On channel 'ch' as 'A'")
  expect(t.runs.some((a) => a[0] === 'join')).toBe(true)
})

test('without the switch the named secret is ignored', async ($, on) => {
  const t = engine(on, { TINCAN_TEST_SECRET: SECRET })
  const r = await $.command.run(typed('tincan:join', 'ch as A'))
  expect(r.text).toContain('Paste your TinCan secret')
  expect(t.runs.some((a) => a[0] === 'join')).toBe(false)
})
