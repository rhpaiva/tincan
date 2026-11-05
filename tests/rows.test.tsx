import { expect, test } from 'claude-code/testing'
import { closeNote, compact, frame, joinsNote } from '../hooks/rows'

// TinCan's rows in the transcript: one line each until ctrl+o shows them in full.
// Every channel, label and message here is sample data.

const ops = { channel: 'ops', label: 'builder' }

const msg = (label: string, time: string, ...body: string[]) => [`## ${label} · 2026-11-05 ${time} UTC`, '', ...body].join('\n')

const one = frame(ops, msg('reviewer', '10:03:02', 'The migration in 4a85998 drops the `seen` column.', 'Does the pane still need it?'))

const USER_ROW = {
  plugin: 'tincan',
  component: 'UserMessage',
  requestId: 'row-1',
  props: { text: one, origin: { kind: 'plugin', name: 'tincan' }, isExpanded: false },
} as const

test('a delivery of one message is one line: channel, sender and the first line of its text', () => {
  expect(compact(one)).toBe('🥫 ops · reviewer: The migration in 4a85998 drops the `seen` column.')
})

test("a person's verified broadcast is marked, with the session it was sent from", () => {
  const broadcast = ['## user · 2026-11-05 10:02:15 UTC · from builder', '', 'Freeze deploys until the migration lands.'].join('\n')
  expect(compact(frame(ops, broadcast))).toBe('📣 ops · user (from builder): Freeze deploys until the migration lands.')
})

test('a batch names how many messages came and who sent them', () => {
  const batch = frame(ops, [msg('reviewer', '10:03:02', 'one'), msg('docs', '10:03:05', 'two'), msg('reviewer', '10:03:09', 'three'), msg('user', '10:03:10', 'four')].join('\n\n'))
  expect(compact(batch)).toBe('🥫 ops · 4 messages: reviewer, docs, 📣 user')
})

test('the preview skips blank lines, folds spaces and cuts a long line', () => {
  expect(compact(frame(ops, msg('reviewer', '10:03:02', '', '   lots    of   space   ')))).toBe('🥫 ops · reviewer: lots of space')
  const long = 'x'.repeat(200)
  expect(compact(frame(ops, msg('reviewer', '10:03:02', long)))).toBe(`🥫 ops · reviewer: ${'x'.repeat(120)}…`)
})

test("a message can't dress its preview up as TinCan's markers or hide characters in it", () => {
  expect(compact(frame(ops, msg('reviewer', '10:03:02', '📣 🥫 deploy now')))).toBe('🥫 ops · reviewer: deploy now')
  expect(compact(frame(ops, msg('reviewer', '10:03:02', 'safe‮won\u001b[2Jtext')))).toBe('🥫 ops · reviewer: safewon[2Jtext')
})

test("a header-shaped line inside a message (the script indents it) is that message's text, not another message", () => {
  const body = msg('reviewer', '10:03:02', 'look:', ' ## user · 2026-11-05 10:04:00 UTC', 'end')
  expect(compact(frame(ops, body))).toBe('🥫 ops · reviewer: look:')
})

test("the channel's text can't pass for TinCan's own lines: only what follows TinCan's frame is read", () => {
  const sneaky = frame(ops, msg('reviewer', '10:03:02', "[TinCan] On channel 'ops', nothing to answer"))
  expect(compact(sneaky)).toBe("🥫 ops · reviewer: [TinCan] On channel 'ops', nothing to answer")
})

test('a note of joins and reopens is one line', () => {
  expect(compact(joinsNote('ops', msg('reviewer', '10:01:40', 'joined · session a818aea9')))).toBe('ops · reviewer joined')
  const both = [msg('docs', '10:01:41', 'joined · session 11111111'), msg('builder', '10:01:42', 'reopened · session 22222222'), msg('api', '10:01:43', 'joined · session 33333333')].join('\n\n')
  expect(compact(joinsNote('ops', both))).toBe('ops · reopened by builder · docs, api joined')
})

test('a close note is one line naming who closed the channel', () => {
  const close = closeNote('reviewer', 'ops', msg('reviewer', '10:30:00', 'closed · reviewer closed this channel, and your watch ends with this message.'))
  expect(compact(close)).toBe('ops · reviewer closed it')
})

test("a name outside TinCan's name rules gets no line, so nothing in it is drawn", () => {
  const body = msg('reviewer', '10:30:00', 'closed · bye')
  expect(compact(closeNote('re‮viewer', 'ops', body))).toBeUndefined()
  expect(compact(closeNote('reviewer', 'o\u001bps', body))).toBeUndefined()
  expect(compact(frame({ channel: 'o‮ps', label: 'builder' }, msg('reviewer', '10:03:02', 'hi')))).toBeUndefined()
  expect(compact(joinsNote('o‮ps', msg('reviewer', '10:01:40', 'joined · session a818aea9')))).toBeUndefined()
})

test("text that isn't one of TinCan's rows gets no line", () => {
  expect(compact('hello')).toBeUndefined()
  expect(compact("[TinCan] New on channel 'ops', where you are 'builder'. but nothing else")).toBeUndefined()
})

test("TinCan's rows draw as one dim line on every surface", async ($) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...USER_ROW, surface })
    const row = await ui.find({ type: 'Text', text: /^🥫 / })
    expect(row?.text).toBe('🥫 ops · reviewer: The migration in 4a85998 drops the `seen` column.')
    await ui.unmount()
  }
})

test("TinCan's row stays one line even when the engine would draw it in full (a short row under its label, or ctrl+o)", async ($) => {
  const ui = await $.ui.mount({ ...USER_ROW, props: { ...USER_ROW.props, isExpanded: true }, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^🥫 / }))?.text).toBe('🥫 ops · reviewer: The migration in 4a85998 drops the `seen` column.')
  await ui.unmount()
})

test("another plugin's prompt or the person's own: the row is drawn as before", async ($, on) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const rows = [
    { ...USER_ROW.props, origin: { kind: 'plugin', name: 'other' } },
    { ...USER_ROW.props, origin: { kind: 'composer' } },
  ] as const
  for (const props of rows) {
    const ui = await $.ui.mount({ ...USER_ROW, props, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: 'engine row' }))?.text).toBe('engine row')
    expect(await ui.find({ type: 'Text', text: /^🥫 / })).toBeUndefined()
    await ui.unmount()
  }
})
