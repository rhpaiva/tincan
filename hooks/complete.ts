// What the prompt box's typeahead offers after a /tincan:<verb>: the channels
// each command can take. Plain functions, so the tests reach them directly.

export type Channel = { name: string; isOpen: boolean }
export type Suggestion = { text: string; description?: string }

/** Channels from `tincan.sh list`: one "<name> open|closed" per line. */
export function parseList(text: string): Channel[] {
  return text
    .split('\n')
    .map((l) => /^(\S+) (open|closed)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[1] ?? '', isOpen: m[2] === 'open' }))
}

/** The channels a command can take, each with the dim note the row shows. */
function fitting(verb: string, channels: Channel[], mine: ReadonlyMap<string, string>): Suggestion[] {
  const on = (name: string) => ({ text: name, description: `you're on it as ${mine.get(name)}` })
  switch (verb) {
    case 'join':
      return channels.filter((c) => c.isOpen && !mine.has(c.name)).map((c) => ({ text: c.name, description: 'open' }))
    case 'reopen':
      return channels.filter((c) => !c.isOpen).map((c) => ({ text: c.name, description: 'closed' }))
    case 'who':
      return channels.filter((c) => c.isOpen).map((c) => (mine.has(c.name) ? on(c.name) : { text: c.name, description: 'open' }))
    case 'close':
    case 'leave':
    case 'send':
    case 'show':
      return [...mine.keys()].sort().map(on)
    default:
      return [] // open takes a new name
  }
}

/**
 * The rows for the draft up to the cursor: right after `/tincan:<verb>`, the
 * command with each channel; while the channel is typed, the names that start so.
 */
export function suggestionsFor(before: string, channels: Channel[], mine: ReadonlyMap<string, string>): Suggestion[] {
  const whole = /^\/tincan:([a-z]+)$/.exec(before)
  if (whole) {
    const verb = whole[1] ?? ''
    return fitting(verb, channels, mine).map((s) => ({ ...s, text: `/tincan:${verb} ${s.text}` }))
  }
  const partial = /^\/tincan:([a-z]+)\s+(\S+)$/.exec(before)
  if (!partial) return []
  const typed = partial[2] ?? ''
  return fitting(partial[1] ?? '', channels, mine).filter((s) => s.text.startsWith(typed))
}

/** True when the draft up to the cursor could get TinCan rows: no need to list channels otherwise. */
export const wantsChannels = (before: string) => /^\/tincan:[a-z]+(\s+\S*)?$/.test(before)
