// Signing a channel: the person's secret, the keys it gives each channel, and the chain of
// signed blocks in a channel file. Nothing here reads or writes a file: the mod reads, the
// script writes. The secret itself lives only in the mod's memory.
//
// A block as the script writes it:
//
//   ## <label> · <YYYY-MM-DD HH:MM:SS> UTC
//
//   <body, as the script escaped it>
//
//   sig · prev=<16 hex> [· by=<label>] · <32 hex>
//
// `prev` is the hash of the block before it in the file, whatever that block is, so a block
// that was copied, or whose predecessor was removed or changed, no longer fits. The MAC covers
// the channel, the header, the body, `prev` and, on a 'user' block, `by`: the label of the
// session the person sent it from. 'user' blocks take the user key, which a mod uses only for
// the person's own /tincan:send and pane box; every other block takes the session key.

const NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}'
export const ZERO = '0000000000000000'
const HEADER = /^## ([A-Za-z0-9][A-Za-z0-9._-]*) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC$/
export const SIG = new RegExp(`^sig · prev=([0-9a-f]{16})(?: · by=(${NAME}))? · ([0-9a-f]{32})$`)
const BY = new RegExp(`^${NAME}$`)

/** Raw HMAC-SHA256 keys: the mod's environment offers SHA-256 (`crypto.subtle.digest`) and no
 *  more, so HMAC and HKDF are built on it here (RFC 2104, RFC 5869). */
export type Keys = { post: Uint8Array; user: Uint8Array }

export type Block = {
  label: string
  /** YYYY-MM-DD HH:MM:SS, UTC. */
  time: string
  header: string
  /** Where the header is in the file, from 1: what receipts and watches count. */
  line: number
  body: string
  sig?: { prev: string; by?: string; mac: string }
  /** The block's lines from its header to its last non-empty line, each ended by a newline. */
  text: string
}

/** ok: signed and in place. unsigned: no signature line. forged: the signature doesn't match.
 *  out-of-chain: genuine, but the block before it isn't the one it was signed after. */
export type Status = 'ok' | 'unsigned' | 'forged' | 'out-of-chain'
export type Checked = Block & { status: Status; hash: string; prev?: string; by?: string }

const enc = (s: string) => new TextEncoder().encode(s)
const hex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data))
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** HMAC-SHA256 (RFC 2104). */
export async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const block = new Uint8Array(64)
  block.set(key.length > 64 ? await sha256(key) : key)
  const inner = await sha256(concat(block.map((b) => b ^ 0x36), data))
  return sha256(concat(block.map((b) => b ^ 0x5c), inner))
}

/** HKDF-SHA256 (RFC 5869), its first 32 bytes. */
export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  return hmac(await hmac(salt, ikm), concat(info, Uint8Array.of(1)))
}
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** 32 random bytes as `tc1-` and 52 base32 letters. */
export function newSecret(): string {
  let out = ''
  let value = 0
  let bits = 0
  for (const b of crypto.getRandomValues(new Uint8Array(32))) {
    value = ((value << 8) | b) & 0xfff
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return `tc1-${out}`
}

/** A pasted secret, spaces and case forgiven; undefined when it isn't one. */
export function parseSecret(text: string): string | undefined {
  const s = text.replace(/\s+/g, '').toLowerCase()
  return /^tc1-[a-z2-7]{52}$/.test(s) ? s : undefined
}

/** What a session shows for its secret, so two sessions can be compared at a glance. */
export async function fingerprint(secret: string): Promise<string> {
  const h = hex(await crypto.subtle.digest('SHA-256', enc(`tincan-fp-v1\n${secret}`)))
  return `${h.slice(0, 4)}·${h.slice(4, 8)}`
}

/** The channel's two keys: one for sessions' blocks, one for the person's broadcasts. */
export async function channelKeys(secret: string, channel: string): Promise<Keys> {
  const derive = (info: string) => hkdf(enc(secret), enc('tincan-v1'), enc(info))
  return { post: await derive(`post ${channel}`), user: await derive(`user ${channel}`) }
}

export const hashOf = async (text: string) => hex(await crypto.subtle.digest('SHA-256', enc(text))).slice(0, 16)

async function macOf(keys: Keys, channel: string, header: string, label: string, body: string, prev: string, by?: string) {
  const kind = label === 'user' ? 'user' : 'post'
  const data = enc(JSON.stringify(['tincan-v1', kind, channel, header, body, prev, by ?? '']))
  return hex(await hmac(kind === 'user' ? keys.user : keys.post, data)).slice(0, 32)
}

/** The channel file's blocks, oldest first. Lines before the first header (title, rules) are no block. */
export function blocksOf(file: string): Block[] {
  const lines = file.split('\n')
  const heads = lines.flatMap((l, i) => (HEADER.test(l) ? [i] : []))
  return heads.map((start, k) => {
    const block = lines.slice(start, heads[k + 1] ?? lines.length)
    while (block.length > 1 && block.at(-1) === '') block.pop()
    const [, label = '', time = ''] = HEADER.exec(block[0] ?? '') ?? []
    const s = block.length > 1 ? SIG.exec(block.at(-1) ?? '') : null
    let body = s ? block.slice(1, -1) : block.slice(1)
    if (body[0] === '') body = body.slice(1)
    if (s && body.at(-1) === '') body = body.slice(0, -1)
    return {
      label,
      time,
      header: block[0] ?? '',
      line: start + 1,
      body: body.join('\n'),
      ...(s ? { sig: { prev: s[1] ?? '', ...(s[2] ? { by: s[2] } : {}), mac: s[3] ?? '' } } : {}),
      text: `${block.join('\n')}\n`,
    }
  })
}

/**
 * The signature line for a block appended to `file` as it stands, and the file's size in bytes
 * then: the script refuses the write if the file has changed size since, and the mod signs again.
 */
export async function signBlock(file: string, channel: string, keys: Keys, label: string, at: string, body: string, by?: string) {
  const header = `## ${label} · ${at} UTC`
  if (!HEADER.test(header)) throw new Error(`not a header: ${header}`)
  if ((label === 'user') !== (by !== undefined) || (by !== undefined && !BY.test(by))) {
    throw new Error("a 'user' block names the session it came from with 'by'; no other block does")
  }
  if (body.endsWith('\n')) throw new Error('the body ends with a newline the script would drop')
  const last = blocksOf(file).at(-1)
  const prev = last ? await hashOf(last.text) : ZERO
  const mac = await macOf(keys, channel, header, label, body, prev, by)
  return { sig: `sig · prev=${prev}${by ? ` · by=${by}` : ''} · ${mac}`, size: enc(file).length, prev }
}

/** How old a genuine block that doesn't fit the chain may be and still be delivered (with a
 *  warning): older, it reads as a copy of an old message put back in. */
export const FRESH_MS = 10 * 60 * 1000

export type Verdict = { action: 'deliver' | 'warn' | 'drop'; why?: 'unsigned' | 'forged' | 'copy' | 'gap' }

/**
 * What a session does with a block that has just arrived: deliver what is signed and in place;
 * deliver a genuine, recent block that doesn't follow its predecessor, with a warning (something
 * before it was removed or changed); drop the rest, and any block whose signature it has
 * already delivered.
 */
export function verdict(b: Checked, nowMs: number, delivered: ReadonlySet<string>): Verdict {
  if (b.status === 'unsigned') return { action: 'drop', why: 'unsigned' }
  if (b.status === 'forged' || !b.sig) return { action: 'drop', why: 'forged' }
  if (delivered.has(b.sig.mac)) return { action: 'drop', why: 'copy' }
  if (b.status === 'ok') return { action: 'deliver' }
  const age = nowMs - Date.parse(`${b.time.replace(' ', 'T')}Z`)
  return age > FRESH_MS ? { action: 'drop', why: 'copy' } : { action: 'warn', why: 'gap' }
}

/** Every block of the file with what its signature says about it. */
export async function verify(file: string, channel: string, keys: Keys): Promise<Checked[]> {
  const out: Checked[] = []
  let before = ZERO
  for (const b of blocksOf(file)) {
    const hash = await hashOf(b.text)
    let status: Status = 'unsigned'
    if (b.sig) {
      const { prev, by, mac } = b.sig
      const shaped = (b.label === 'user') === (by !== undefined)
      const genuine = shaped && mac === (await macOf(keys, channel, b.header, b.label, b.body, prev, by))
      status = !genuine ? 'forged' : prev === before ? 'ok' : 'out-of-chain'
    }
    out.push({ ...b, status, hash, ...(b.sig ? { prev: b.sig.prev } : {}), ...(b.sig?.by ? { by: b.sig.by } : {}) })
    before = hash
  }
  return out
}
