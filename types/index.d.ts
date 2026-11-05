/** A channel this session is on: what the mod needs to post, watch and mark reads. */
export type TincanSub = {
  channel: string
  label: string
  /** The .tincan folder the channel lives in, so later calls don't depend on the cwd. */
  dir: string
  /** The session id at the join; the script knows the label's holder by it. */
  sid: string
  /** Stands for the Claude process, so the label stays this session's after /clear. */
  proc: string
}

/** One message of a channel as the pane shows it. */
export type TincanMessage = {
  /** Its header line, unique within the channel. */
  id: string
  label: string
  /** On a person's broadcast: the session it was sent from, as its signature says; '' otherwise. */
  by: string
  /** Where its header is in the channel file, from 1: what seen and read receipts compare with. */
  line: number
  /** HH:MM:SS, UTC. */
  time: string
  body: string
  /** A join, reopen or close: drawn dim. */
  isControl: boolean
  /** On this session's own messages: '✓' delivered to every other session, '✓✓' read by every one. */
  mark: string
}

/** What the pane draws: the channel picked, its last messages and who is watching. */
export type TincanPane = {
  channels: string[]
  channel: string
  /** This session's label on the channel shown. */
  me: string
  messages: TincanMessage[]
  /** This session first, then the others on the channel, each watching or away. */
  watching: { label: string; isWatching: boolean }[]
  /** How many blocks of the channel TinCan couldn't verify: never drawn, only counted. */
  hidden: number
  /** True while the session has no secret to verify with: nothing is drawn. */
  locked: boolean
}

/** What the secret's box draws. None of it is secret: the secret lives in the mod's memory alone. */
export type TincanKey = {
  /** 'paste' asks for the secret; 'new' shows one /tincan:key new made. */
  mode: 'paste' | 'new'
  /** How many characters have been typed: the box draws that many dots. */
  dots: number
  error: string
  /** The command waiting for the secret, as typed; '' when none is. */
  what: string
  /** The fingerprint of the secret the session holds now; '' when none. */
  fp: string
}

declare module 'claude-code' {
  interface PluginState {
    tincan: {
      subs: TincanSub[]
      pane: Shaped<TincanPane>
      key: Shaped<TincanKey>
      /** Per channel: what this session has delivered (MACs, newest block time in ms), so a copy put back is dropped. */
      delivered: Record<string, { since: number; macs: string[] }>
      /** What made this session read outside content since its last /clear or compaction; '' when nothing has. */
      tainted: string
    }
  }
}
