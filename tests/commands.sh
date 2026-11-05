#!/usr/bin/env bash
# Headless checks of the plugin's /tincan:<verb> commands: each one must be
# answered by the mod itself, with no model turn. Run: bash tests/commands.sh
# Every check is one `claude -p` run in a throwaway git repository. If the mod
# failed to answer, the command's fallback would cost one small model turn,
# so the runs use the cheapest model. Commands run only for a person, so these
# headless runs set the test switch TINCAN_ALLOW_HEADLESS=1.
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pass=0 fail=0
repo="$work/repo"
mkdir -p "$repo" && git -C "$repo" init -q -b main && git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init

# The secret these sessions hold (sample data): honoured only with the headless switch on.
SECRET=tc1-abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst

cmd() { # cmd <name> <prompt> <expected text> [switch value] [secret]
  local out
  out=$(cd "$repo" && TINCAN_ALLOW_HEADLESS=${4-1} TINCAN_TEST_SECRET=${5-$SECRET} timeout 120 claude -p "$2" --plugin-dir "$here" --model haiku --output-format json 2>/dev/null |
    python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d.get("num_turns")); print(d.get("result") or "")')
  local turns=${out%%$'\n'*} text=${out#*$'\n'}
  if [ "$turns" = 0 ] && [[ $text == *"$3"* ]]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); echo "FAIL: $1: expected 0 turns and '$3', got $turns turns:"; printf '%s\n' "$text" | sed 's/^/    /'
  fi
}

cmd "a headless run without the switch is refused" "/tincan:open t as A" "Only a person runs /tincan: commands" 0
cmd "a command without the secret waits for it" "/tincan:open t as A" "Paste your TinCan secret" 1 ""
cmd "key with a secret shows its fingerprint" "/tincan:key" "This session's secret: "
cmd "open" "/tincan:open t as A" "On channel 't' as 'A'"
cmd "open an existing channel" "/tincan:open t as Z" "join it with /tincan:join t"
cmd "join" "/tincan:join t as B" "On channel 't' as 'B'"
cmd "join a missing channel" "/tincan:join nosuch" "open it with /tincan:open nosuch"
cmd "reopen an open channel" "/tincan:reopen t as C" "join it with /tincan:join t"
cmd "join with a taken label" "/tincan:join t as A" "already joined"
cmd "send" "/tincan:send t hello from a person" "Sent to 't' as user."
cmd "send without a message" "/tincan:send t" "Usage: /tincan:send"
cmd "who" "/tincan:who t" "the channel's last message: ## user"
cmd "close from a session not on it" "/tincan:close t" "isn't on 't'"
cmd "leave a channel this session isn't on" "/tincan:leave t" "isn't on 't'"
cmd "open with no channel" "/tincan:open" "Usage: /tincan:open"

f="$repo/.tincan/t/messages.md"
if grep -q '^## user · ' "$f" && grep -q '^hello from a person$' "$f"; then pass=$((pass + 1)); else
  fail=$((fail + 1)); echo "FAIL: the broadcast is in the channel file"; fi
if [ ! -e "$repo/.tincan/t/labels/Z" ] && [ ! -e "$repo/.tincan/nosuch" ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); echo "FAIL: refused commands left folders behind"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
