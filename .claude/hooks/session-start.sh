#!/usr/bin/env bash
# SessionStart hook: prints where the project stands, so any session (cloud or local)
# can continue where the last one stopped. Read-only: it never changes files or branches.
# Its output is added to Claude's context. Docs: docs/process/SESSIONS.md §9.
#
# Portable on purpose (Linux, macOS, Windows Git Bash): bash + git + sed/awk only; no jq, no gh.
# M00 will add dependency installation for cloud sessions (see the session-start-hook skill).

set -u
MEM="docs/memory/NOW.md"

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
export GIT_TERMINAL_PROMPT=0

# Why the session started: startup | resume | clear | compact (from the JSON on stdin, if any).
input=""
if [ ! -t 0 ]; then input="$(cat 2>/dev/null || true)"; fi
reason="$(printf '%s' "$input" | tr -d '\n' | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')"

# 1) Refresh remote refs (local clones go stale). Bounded, quiet, never fatal.
fetch_note=""
if command -v timeout >/dev/null 2>&1; then
  timeout 20 git fetch --quiet --prune origin >/dev/null 2>&1 || fetch_note="  (git fetch failed or timed out: remote info below may be stale)"
else
  git fetch --quiet --prune origin >/dev/null 2>&1 || fetch_note="  (git fetch failed: remote info below may be stale)"
fi

echo "=== Ads Agent session context (.claude/hooks/session-start.sh${reason:+, start reason: $reason}) ==="
[ -n "$fetch_note" ] && echo "$fetch_note"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "Environment: CLOUD session. No production secrets; use the GitHub MCP tools (no gh); push only to the assigned branch."
else
  echo "Environment: LOCAL session. Never use the production 'worker'/'gateway' Doppler configs."
fi

# 2) The checkout
branch="$(git branch --show-current 2>/dev/null)"
head_info="$(git log -1 --format='%h %s (%cd)' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null)"
echo "Checkout: ${branch:-detached HEAD} @ ${head_info:-(no commits yet)}"

dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [ "${dirty:-0}" != "0" ]; then
  echo "WARNING: $dirty uncommitted/untracked file(s) in the working tree. Leftover work from an earlier session? Check 'git status' before starting."
fi

have_main=0
git rev-parse -q --verify origin/main >/dev/null 2>&1 && have_main=1
if [ "$have_main" = 1 ]; then
  behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
  ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
  echo "Versus origin/main: $ahead commit(s) ahead, $behind behind."
fi
if [ -n "$branch" ] && git rev-parse -q --verify "origin/$branch" >/dev/null 2>&1; then
  unpushed="$(git rev-list --count "origin/$branch..HEAD" 2>/dev/null || echo 0)"
  [ "$unpushed" != "0" ] && echo "NOTE: $unpushed local commit(s) on '$branch' are not pushed yet."
fi

# 3) Unfinished work branches on GitHub (merged branches are auto-deleted, so these are open PRs or abandoned attempts)
if [ "$have_main" = 1 ]; then
  others="$(git for-each-ref --sort=-committerdate --format='%(refname:short)|%(committerdate:short)|%(subject)' refs/remotes/origin 2>/dev/null \
            | grep -v -e '^origin/HEAD|' -e '^origin/main|' -e '^origin|' | head -n 8)"
  if [ -n "$others" ]; then
    echo "Work branches on GitHub (newest first; ahead of main):"
    printf '%s\n' "$others" | while IFS='|' read -r ref day subject; do
      n="$(git rev-list --count "origin/main..$ref" 2>/dev/null || echo '?')"
      [ "$n" = "0" ] && continue
      echo "  - $ref  [$day, +$n]  $subject"
    done
  fi
fi

# 4) Where is the newest memory? (the most recent commit that touched NOW.md, on any remote branch)
newest_ref=""; newest_ts=0
for ref in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin 2>/dev/null); do
  case "$ref" in origin/HEAD|origin) continue ;; esac
  ts="$(git log -1 --format=%ct "$ref" -- "$MEM" 2>/dev/null)"
  [ -n "$ts" ] || continue
  if [ "$ts" -gt "$newest_ts" ] || { [ "$ts" -eq "$newest_ts" ] && [ "$ref" = "origin/main" ]; }; then
    newest_ts="$ts"; newest_ref="$ref"
  fi
done
local_ts="$(git log -1 --format=%ct HEAD -- "$MEM" 2>/dev/null)"
mem_dirty=""
git status --porcelain -- "$MEM" 2>/dev/null | grep -q . && mem_dirty=" (with uncommitted edits)"

if [ -z "$newest_ref" ] && [ -z "$local_ts" ]; then
  echo "Memory: no $MEM found on any branch. Is this the right repo?"
elif [ -z "$newest_ref" ] || [ "${local_ts:-0}" -ge "$newest_ts" ]; then
  echo "Memory: your checkout has the newest $MEM$mem_dirty. It is already loaded via CLAUDE.md."
else
  when="$(git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M' "$newest_ref" -- "$MEM" 2>/dev/null)"
  echo "IMPORTANT: a NEWER $MEM exists on $newest_ref (updated $when). The copy loaded from your checkout is OUT OF DATE."
  echo "Continue from $newest_ref (see the start-session skill). Its NOW.md:"
  echo "----- begin $newest_ref:$MEM -----"
  git show "$newest_ref:$MEM" 2>/dev/null
  echo "----- end $newest_ref:$MEM -----"
fi

if [ "$reason" = "compact" ]; then
  echo "Context was just compacted: re-read $MEM and the active milestone file, and trust the files over the summary."
fi
echo "Next: follow the start-session skill (.claude/skills/start-session/SKILL.md)."
exit 0
