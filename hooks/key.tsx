import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface } from 'claude-code'
import { fingerprint, newSecret, parseSecret } from './sign'

// The session's secret and the box that takes it. The secret lives in this module's memory
// and nowhere else: not in $.state (any installed plugin reads any value there), not in a
// command's arguments (the prompt history and the transcript keep those), not in a notice
// or the status line (the transcript keeps notices; only the fingerprint is shown). A reload
// of the plugin forgets it, and the session asks for it again.

type $ = EngineInterface

export const KEY_PANE = 'tincan-key'

/** A command that waits for the secret: register.tsx runs it once the secret is set. */
export type Pending = { what: string; verb: 'open' | 'join' | 'reopen' | 'close' | 'send'; args: string }

let secret: string | undefined
/** What has been typed or pasted into the box so far: the box draws it as dots. */
let typed = ''
/** A secret /tincan:key new made, drawn once in the box until the person closes it. */
let shown: string | undefined
let waiting: Pending | undefined
/** Set while this module closes the box itself, so the close isn't read as a cancel. */
let closing = false

// What the box draws, none of it secret. Change the shape when TincanKey's fields change.
const box = atom(
  { plugin: 'tincan', key: 'key' } as const,
  { mode: 'paste', dots: 0, error: '', what: '', fp: '' },
  { shape: 'key-1' },
)

export const currentSecret = () => secret

async function tell($: $, text: string) {
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })
}

/** Sets the secret; answers the command that waited for it, for the caller to run. */
async function setSecret($: $, s: string, opts: { quiet?: boolean } = {}): Promise<Pending | undefined> {
  secret = s
  const fp = await fingerprint(s)
  try {
    $.ui.status(`TinCan ${fp}`)
  } catch {
    // The status line is a convenience; the secret is set without it.
  }
  if (!opts.quiet) {
    await tell($, `TinCan: this session's secret is set · ${fp}. Other sessions show the same fingerprint when they hold the same secret.`)
  }
  const w = waiting
  waiting = undefined
  return w
}

// The surfaces that run on the person's own machine. A secret is drawn, or typed, only there:
// a phone, or any surface not named here, may be drawn through the cloud.
const LOCAL = new Set(['terminal', 'desktop', 'vscode'])

/**
 * For a command from a headless test run alone (origin 'sdk', with TINCAN_ALLOW_HEADLESS=1),
 * the secret TINCAN_TEST_SECRET names. Never for a person's command or at a session's start:
 * a project's settings can set both variables, and a secret it chose would let it sign
 * broadcasts this session trusts.
 */
async function testSecret($: $, origin: string) {
  if (secret || origin !== 'sdk') return
  if ((await $.env.get('TINCAN_ALLOW_HEADLESS').catch(() => undefined)) !== '1') return
  const s = parseSecret((await $.env.get('TINCAN_TEST_SECRET').catch(() => undefined)) ?? '')
  if (s) {
    await tell($, 'TinCan: this headless run uses the test secret TINCAN_TEST_SECRET names.')
    await setSecret($, s, { quiet: true })
  }
}

async function openBox($: $, mode: 'paste' | 'new', what: string) {
  typed = ''
  const fp = secret ? await fingerprint(secret) : ''
  await update($, box, () => ({ mode, dots: 0, error: '', what, fp }))
  await $.ui.open({ id: KEY_PANE, title: 'TinCan secret', focus: true, closeOnEscape: true, holdToasts: true, rows: 8 })
}

async function closeBox($: $) {
  typed = ''
  shown = undefined
  closing = true
  try {
    await $.ui.close({ id: KEY_PANE })
  } finally {
    closing = false
  }
}

/** Undefined when the session has its secret (the caller goes on); else the answer to give, with the box open. */
export async function needSecret($: $, p: Pending, origin: string): Promise<string | undefined> {
  await testSecret($, origin)
  if (secret) return undefined
  waiting = p
  await openBox($, 'paste', p.what)
  return `Paste your TinCan secret in the TinCan box to finish ${p.what}. No secret yet? /tincan:key new makes one.`
}

/** `/tincan:key` opens the box; `/tincan:key new` makes a secret and shows it there once. */
export async function keyCommand($: $, args: string, origin: string): Promise<{ text: string; then?: Pending }> {
  const word = args.trim()
  if (word === 'new' && origin !== 'composer') {
    return { text: 'Make a new secret at your computer (/tincan:key new at its prompt): TinCan shows it only there.' }
  }
  if (word === 'new') {
    shown = newSecret()
    await openBox($, 'new', '')
    const then = await setSecret($, shown)
    return {
      text: "Made a new TinCan secret and set it here. Copy it from the TinCan box into your password manager: it shows this once. Sessions holding another secret drop this one's messages.",
      ...(then ? { then } : {}),
    }
  }
  if (word !== '') return { text: 'Usage: /tincan:key, or /tincan:key new' }
  await testSecret($, origin)
  await openBox($, 'paste', waiting?.what ?? '')
  if (secret) return { text: `This session's secret: ${await fingerprint(secret)}. Paste another in the TinCan box to replace it.` }
  return { text: 'Paste your TinCan secret in the TinCan box. No secret yet? /tincan:key new makes one.' }
}

/** The box's text with the dots put back: the dots stand for what was typed before. */
function untangle(value: string): string {
  const m = /^(•*)([\s\S]*)$/.exec(value)
  return typed.slice(0, m?.[1]?.length ?? 0) + (m?.[2] ?? '')
}

async function typedInto($: $, value: string) {
  typed = untangle(value)
  await update($, box, (v) => ({ ...v, dots: typed.length, error: '' }))
}

/** Enter in the box: sets the secret it holds and answers the command that waited, or says what's wrong. */
export async function acceptSecret($: $, value: string): Promise<Pending | undefined> {
  const s = parseSecret(untangle(value))
  typed = ''
  if (!s) {
    await update($, box, (v) => ({
      ...v,
      dots: 0,
      error: "That isn't a TinCan secret: it starts tc1- and has 52 letters and digits after it.",
    }))
    return undefined
  }
  await closeBox($)
  return setSecret($, s)
}

/** Cancel in the box: closes it and drops the command that waited. */
async function cancelBox($: $) {
  const w = waiting
  waiting = undefined
  await closeBox($)
  if (w && !secret) await tell($, `TinCan: ${w.what} didn't run: no secret was pasted.`)
}

/** The box closed: by the person (Esc) it cancels what waited. */
export async function keyClosed($: $) {
  if (closing) return
  typed = ''
  shown = undefined
  const w = waiting
  waiting = undefined
  if (w && !secret) await tell($, `TinCan: ${w.what} didn't run: no secret was pasted.`)
}

/** The box: a masked field for the secret, or a new secret shown once. */
export async function drawKeyBox($: $, e: Parameters<EngineInterface['ui']['resolve']>[0], onSubmit: (value: string) => void) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const v = await read($, box)
  const local = LOCAL.has(e.surface)
  if (v.mode === 'new' && shown) {
    return (
      <Box flexDirection="column">
        <Text bold>Your new TinCan secret</Text>
        {local ? (
          <Text key="new-secret" color="success">
            {shown}
          </Text>
        ) : (
          <Text>Open this box at your computer to see it: TinCan never draws a secret on this surface.</Text>
        )}
        <Text>Copy it into your password manager now: TinCan shows it this once. Give it to your other sessions with /tincan:key.</Text>
        <Text dimColor>Never paste it into the prompt.</Text>
        <Button key="done" variant="primary" label="Done" onPress={() => void closeBox($).catch(() => {})} />
      </Box>
    )
  }
  const Input = local ? ($.ui.resolve(e) as unknown as Elements['terminal']).Input : undefined
  return (
    <Box flexDirection="column">
      <Text bold>{v.what ? `Paste your TinCan secret to finish ${v.what}` : 'Paste your TinCan secret'}</Text>
      {v.fp ? <Text dimColor>{`This session's secret now: ${v.fp}. A paste replaces it.`}</Text> : null}
      {Input ? (
        <Input
          key="secret"
          label="secret:"
          placeholder="tc1-…"
          value={'•'.repeat(v.dots)}
          submitLabel="unlock"
          autoFocus
          onInput={(value: string) => void typedInto($, value).catch(() => {})}
          onSubmit={onSubmit}
        />
      ) : (
        <Text>Paste it at your computer: TinCan takes a secret only there.</Text>
      )}
      {v.error ? <Text color="error">{v.error}</Text> : null}
      <Text dimColor>Esc cancels · never paste it into the prompt</Text>
      <Button key="cancel" plain dimColor label="Cancel" onPress={() => void cancelBox($).catch(() => {})} />
    </Box>
  )
}
