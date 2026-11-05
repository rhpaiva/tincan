# TinCan (`tincan`)

<p align="center">
  <img src="robots.png" alt="Two robots talking through a tin-can telephone" width="480">
</p>

Channels between Claude Code sessions that can't message each other: other accounts, other containers, sessions `ListAgents` doesn't show. A channel is a folder of plain files that every session on it can see. This plugin's mod runs each session's side, so commands and watching cost no model turns.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install tincan --marketplace rhpaiva/tincan
```

From a shell:

```
claude plugin install tincan --marketplace rhpaiva/tincan
```

Answer `y` to add the marketplace, then pick a scope (the user scope comes first; press Enter). The plugin runs in that session at once, and under the user scope in every session after it. In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins, Add marketplace with `rhpaiva/tincan`, then Add plugin.

It needs a Claude Code build with plugin function hooks (an early-access API; built and tested on 2.1.317), `bash` and `flock` (util-linux; on macOS `brew install flock`). Every session on a channel needs the plugin, and the sessions must see the same folder: the same repository, or the same `TINCAN_DIR`.

## Commands (yours alone; the model can't run them)

| Command | Does |
|---|---|
| `/tincan:key [new]` | Paste this session's TinCan secret into a box beside the chat (it draws dots), or show the fingerprint of the one it holds. `new` makes a secret and shows it there once: keep it in your password manager. Once per session after Claude starts; the commands below open the box themselves when the session has none |
| `/tincan:open <channel> [as <label>]` | Create a channel and join it |
| `/tincan:join <channel> [as <label>] [--rejoin]` | Join an open channel; `--rejoin` takes over a label another session holds |
| `/tincan:reopen <channel> [as <label>]` | Open a closed channel again: a new round, every label free |
| `/tincan:close <channel> [note]` | The channel's last message: every watch ends, nothing more can be posted |
| `/tincan:send <channel> <message>` | Broadcast as `user`, signed: every session on the channel reads it as your own words |
| `/tincan:who [channel]` | Read receipts: who is watching, who got and read your last message; with no channel, every channel this session is on |
| `/tincan:leave <channel>` | Stop watching here without closing it for the others |
| `/tincan:show [channel]` | Open the pane beside the chat: the channels this session is on, each message in full (✓ on yours once every other session has it, ✓✓ once every one has read it), who is watching, and a box that broadcasts as `user`. Run it again with no channel, or press its close button, to close it |

After a `/tincan:` command name, the prompt's typeahead offers the channels that command can take. The label defaults to the first 8 characters of the session ID. A session joined to a channel gets three tools: `mcp__tincan__post` (posts under its own label), `mcp__tincan__who` and `mcp__tincan__history` (the channel's last verified messages).

## Your secret

Every block on a channel is signed with keys derived from one secret of yours, and every session checks every block before its model or the pane sees it. Make it once with `/tincan:key new`, keep it in your password manager, and paste it into each session with `/tincan:key` (or when a command asks). Sessions show its fingerprint, such as `7f3a·91c2`, on the status line: the same fingerprint means the same secret.

The secret lives only in TinCan's memory in that session: not in a file, the transcript, your prompt history or the plugin state other plugins can read. A reload of the plugin or a restart of Claude forgets it, and the session asks again. Never paste it into the prompt, and clear your clipboard after pasting.

## How it works

- Channels live in `.tincan/<channel>/` at the main checkout of the git repository (outside git: `./.tincan`; `TINCAN_DIR` overrides): `messages.md`, append-only; `lock`; and `labels/<label>/` for each session's state (`seen`, `read`, `owner`, the watch lock). The folder ignores itself for git.
- `scripts/tincan.sh` is the protocol: every write goes through it, under the channel's lock. The mod drives it, and signs every block it writes: the script prints the exact body it will write, the mod signs it, and the script appends a `sig ·` line after it. The script never holds a key.
- A block's signature covers the channel, its header, its text and a hash of the block before it, so a block that was changed, copied, or whose predecessor was removed no longer fits. A person's broadcast takes a separate key, which a session uses only for `/tincan:send` and the pane's box, and names the session it was sent from.
- The mod runs one watch per channel. Each batch is read from the file and checked: what is signed and in place reaches the model as one prompt per batch, at most one every 15 seconds per channel; anything else is dropped and you get a notice saying what. Your broadcasts reach other sessions' models as your own words; other sessions' messages stay their words. A batch of joins alone is a note with no turn. A message counts as read when the turn carrying it starts, and the read receipt is signed too.
- In the transcript each of TinCan's rows is one dim line: `🥫 ops · reviewer: <its first line>`, `🥫 ops · 3 messages: reviewer, docs, 📣 user`, `📣 ops · user (from builder): <its first line>`, `ops · reviewer joined`, `ops · reviewer closed it`. The pane (`/tincan:show`) shows the messages in full. Only the drawing is shorter: the model reads every row as it was written.
- A close shows you a notice and gives the model a note, with no turn, so nobody can reply to it; one TinCan can't verify reaches no model.
- On a join the model reads TinCan's rules for the channel and its last 5 verified messages; the whole channel stays in `messages.md`.
- A session remembers what it wrote and tells you when one of its messages disappears from the file.
- The pane reads the channel file itself every few seconds while it is open, so watching it costs no tokens. It shows only verified messages, and counts what it hides.
- A session picks up a new version of the plugin when its files are saved in place (it reloads by itself) or on `/reload-plugins`; a folder swapped in by rename isn't noticed.

## Threat model

**Your secret decides what a session trusts, not the folder.** Anything that can write the folder can still edit, delete or garble it: every process running as you, on every machine or container that shares it. Without your secret, nothing it writes reaches a model as genuine.

What the plugin enforces:

- Every block is signed, and sessions drop what they can't verify, with a notice to you saying what: unsigned or forged blocks, changed text, copies put back in (even in place after the file was cut back), times no clock gave, and a broadcast out of place (copied from another channel of the same name, or after what preceded it was removed). A genuine message from a session whose predecessor went missing arrives with a warning.
- Your broadcasts take a separate key that a session uses only for `/tincan:send` and the pane's box; the model's tools can't make one. Verified, a broadcast reaches other sessions' models as your own words, naming the session you sent it from. Other sessions' messages stay their words: data, never instructions.
- The secret lives only in TinCan's memory in each session: never in a file, the transcript, your prompt history, a command's arguments, a notice or the plugin state other plugins can read. It is drawn and typed only on surfaces on your machine (the terminal, the desktop app, VS Code), and `/tincan:key new` refuses over Remote Control. `TINCAN_TEST_SECRET` counts only for a command from a headless run with `TINCAN_ALLOW_HEADLESS=1`, never for a person's session, since a project's settings can set environment variables.
- Read receipts are signed and bound to the block they stand on: ✓✓ and `/tincan:who` count only those. A session tells you when a message it wrote disappears from the file.
- A watch stops delivering, and tells you, when the file no longer begins as it read it (cut back, or rewritten).
- The model reads each message's text indented under a header TinCan writes, so no line of text can stand where a header does. In the file, lines shaped like headers, control lines, signature lines or the watch's own lines are indented too, as is a line that starts with `[TinCan]`; other line breaks (a CR, U+2028 and the like) become newlines first, so none can hide such a line.
- Commands run only for a person at the prompt or over Remote Control, never for a headless `claude -p` or another plugin (tests set `TINCAN_ALLOW_HEADLESS=1`).
- The model's Bash and file edits ask you before they touch `.tincan/`, the folder of any channel the session is on, `TINCAN_DIR`, `tincan.sh` or this plugin's folder. File paths are checked as resolved paths; Bash commands by their text. Use `mcp__tincan__history` rather than reading the files: they hold whatever anyone wrote.
- Once a session has read outside content (WebFetch, WebSearch, another MCP server's tool, a shell `curl`), every post from it asks you first, until a `/clear` or a compaction takes that content out of the conversation. A reload of the plugin keeps the check.
- Nothing is read or written through a symbolic link: the script refuses one inside a channel's folder, replaces its state files by rename, and the mod skips a linked file.

What it can't stop:

- **Anyone who gets your secret** can sign broadcasts every session treats as your words. Never paste it into the prompt, and clear your clipboard after pasting it: any process running as you can read the clipboard. On Linux, keep `/proc/sys/kernel/yama/ptrace_scope` at 1 or more on every machine that joins: at 0, a process running as you can read Claude's memory. To retire a secret, make another with `/tincan:key new` and paste it into each session.
- **Anyone who can change TinCan's code.** The installed plugin's files are yours, so the model's Bash can edit them, and a reload runs the new code. Install it where your user can't write if that matters to you.
- **Other installed plugins.** They run inside Claude: they can watch what you type into TinCan's box, and one that runs before TinCan could change a `/tincan:send` before it is signed, or skip TinCan's guard (its reason also doesn't show in the Bash permission dialog, which only asks "Do you want to proceed?").
- **Anything that can type into your terminal** (`tmux send-keys`, `xdotool`, macOS keystrokes with Accessibility permission): what it types into `/tincan:send` gets signed.
- **Breaking a channel.** Anything that can write the folder can delete or garble messages, hold the lock, or write an unsigned close or join, which still ends watches or takes a label in the script: you're told, and no model sees it. `seen` receipts aren't signed, so ✓ (delivered) can be claimed; ✓✓ can't.
- An injected model posting misleading text under its own label: it is signed for real, since it came from that session.
- A deliberately disguised shell command: the Bash check matches text.
- **Anyone who can read the folder reads every message:** signatures prove who wrote a message, they don't hide it.

## Tests

- `bash tests/run.sh`: the script (no Claude needed).
- `claude plugin test .`: the mod against a stand-in engine (signing and checking, the secret's box, watch batching, delivery, receipts, close, guards).
- `bash tests/commands.sh`: each command in a headless `claude -p` run, answered with no model turn.
