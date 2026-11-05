import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { parseList, suggestionsFor, wantsChannels } from '../hooks/complete'

// Channel names in the prompt box's typeahead, and /tincan:who with no channel.
// Every channel here is sample data.

// Sessions here hold this secret, as a headless test run may (TINCAN_ALLOW_HEADLESS=1): sample data.
const SIGNED = { TINCAN_ALLOW_HEADLESS: '1', TINCAN_TEST_SECRET: 'tc1-abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst' }

const CHANNELS = parseList('alpha open\nbeta closed\nlive open\n')
const MINE = new Map([['live', 'A']])
const texts = (before: string) => suggestionsFor(before, CHANNELS, MINE).map((s) => s.text)

test('the channel list parses', () => {
  expect(CHANNELS).toEqual([
    { name: 'alpha', isOpen: true },
    { name: 'beta', isOpen: false },
    { name: 'live', isOpen: true },
  ])
})

test('right after the command, the typeahead offers it with each channel that fits', () => {
  expect(texts('/tincan:join')).toEqual(['/tincan:join alpha'])
  expect(texts('/tincan:reopen')).toEqual(['/tincan:reopen beta'])
  expect(texts('/tincan:close')).toEqual(['/tincan:close live'])
  expect(texts('/tincan:who')).toEqual(['/tincan:who alpha', '/tincan:who live'])
  expect(texts('/tincan:open')).toEqual([])
})

test('while the channel is being typed, it offers the names that start that way', () => {
  expect(texts('/tincan:join al')).toEqual(['alpha'])
  expect(texts('/tincan:join li')).toEqual([])
  expect(texts('/tincan:show l')).toEqual(['live'])
  expect(texts('/tincan:send l')).toEqual(['live'])
  expect(texts('/tincan:leave x')).toEqual([])
  expect(suggestionsFor('/tincan:close l', CHANNELS, MINE)[0]?.description).toBe("you're on it as A")
})

test('other text gets no rows and lists no channels', () => {
  expect(texts('hello wor')).toEqual([])
  expect(texts('/tincan:send live hi')).toEqual([])
  expect(wantsChannels('hello wor')).toBe(false)
  expect(wantsChannels('/tincan:join')).toBe(true)
  expect(wantsChannels('/tincan:join al')).toBe(true)
  expect(wantsChannels('/tincan:send live hi')).toBe(false)
})

const entered = (channel: string) =>
  [`TinCan: on channel '${channel}' as 'A' (/repo/.tincan/${channel}/messages.md)`, '--- history ---', '--- end of history (line 9) ---', ''].join('\n')

const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

function engine(on: On) {
  mock.clock(on)
  mock.session(on)
  mock.env(on, SIGNED)
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__tincan__${e.name}` } }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(2) as string[]
    const stdout =
      args[0] === 'join'
        ? entered(args[1] ?? '')
        : args[0] === 'who'
          ? `channel '${args[1]}' is open; your last message: ## A · 2026-11-04 00:00:00 UTC\n  B: watching, read\n`
          : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    await new Promise<void>(() => {})
    return { value: { code: 0, signal: null } }
  })
}

test('/tincan:who with no channel answers for every channel this session is on', async ($, on) => {
  engine(on)
  expect((await $.command.run(typed('tincan:who', ''))).text).toContain('on no channel')
  await $.command.run(typed('tincan:join', 'live as A'))
  expect((await $.command.run(typed('tincan:who', ''))).text).toContain("channel 'live' is open")
  await $.command.run(typed('tincan:join', 'alpha as A'))
  const both = (await $.command.run(typed('tincan:who', ''))).text
  expect(both).toContain("channel 'live' is open")
  expect(both).toContain("channel 'alpha' is open")
})
