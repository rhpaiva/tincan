// What a session does with a channel's verified blocks: which to deliver, which to drop, and
// how a block reads for the model. Pure: the mod reads the file and verifies it (sign.ts).

import type { Checked } from './sign'
import { verdict } from './sign'

/** What this session has delivered on a channel: the MACs, and the newest block time (ms). */
export type Seen = { macs: Set<string>; since?: number }

export type Sorted = { deliver: Checked[]; warn: Checked[]; dropped: { block: Checked; why: string }[] }

const timeOf = (b: Checked) => Date.parse(`${b.time.replace(' ', 'T')}Z`)

/** A block as a model reads it: its header, with the session a broadcast came from, then its body. */
export const shown = (b: Checked) => `${b.header}${b.by ? ` · from ${b.by}` : ''}\n\n${b.body}`

/** True when this session wrote the block: its own post, or the person's broadcast sent from it. */
const mine = (b: Checked, me: string) => b.label === me || (b.label === 'user' && b.by === me)

/**
 * The blocks whose header is in (from, to], sorted: what to deliver (and of that, what to deliver
 * with a warning), and what to drop and why. This session's own blocks are neither. `seen` takes
 * what is delivered, so a copy of it later is dropped.
 */
export function sortArrivals(blocks: Checked[], from: number, to: number, me: string, nowMs: number, seen: Seen): Sorted {
  const out: Sorted = { deliver: [], warn: [], dropped: [] }
  for (const b of blocks) {
    if (b.line <= from || b.line > to) continue
    const v = verdict(b, nowMs, seen)
    if (v.action === 'drop') {
      out.dropped.push({ block: b, why: v.why ?? 'forged' })
      continue
    }
    if (b.sig) seen.macs.add(b.sig.mac)
    seen.since = Math.max(seen.since ?? 0, timeOf(b))
    if (mine(b, me)) continue
    out.deliver.push(b)
    if (v.action === 'warn') out.warn.push(b)
  }
  return out
}

/** What a join remembers of the history it read: every genuine block counts as delivered. */
export function seenIn(blocks: Checked[], seen: Seen): Seen {
  for (const b of blocks) {
    if (b.status !== 'ok' && b.status !== 'out-of-chain') continue
    if (b.sig) seen.macs.add(b.sig.mac)
    seen.since = Math.max(seen.since ?? 0, timeOf(b))
  }
  return seen
}

/** True for a batch of joins and reopens alone: news that needs no answer. */
export const onlyJoins = (bs: Checked[]) => bs.length > 0 && bs.every((b) => /^(joined|reopened) · session \S+$/.test(b.body))

/** The line, above the channel's text, that says something before a genuine block went missing or changed. */
export const gapWarning = (b: Checked) =>
  `Something before ${b.label}'s message of ${b.time} UTC was removed or changed in the channel file; that message itself is genuine.`

const WHY: Record<string, string> = {
  unsigned: 'unsigned',
  forged: "with a signature that doesn't match",
  copy: 'a copy of an earlier message',
  clock: 'with a time no clock gave',
}

/** The person's notice for what was dropped: how many, why, and what they claimed to be. */
export function dropNotice(channel: string, dropped: Sorted['dropped']): string {
  const counts = new Map<string, number>()
  for (const d of dropped) counts.set(d.why, (counts.get(d.why) ?? 0) + 1)
  const parts = [...counts].map(([why, n]) => `${n} ${WHY[why] ?? why}`)
  const claimed = [...new Set(dropped.map((d) => `'${d.block.label}'`))].join(', ')
  const n = dropped.length
  return `TinCan ${channel}: dropped ${n} message${n === 1 ? '' : 's'} TinCan couldn't verify (${parts.join(', ')}; claiming ${claimed}). Something wrote the channel folder directly; the model never saw ${n === 1 ? 'it' : 'them'}.`
}
