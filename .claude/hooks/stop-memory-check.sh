#!/usr/bin/env bash
# Stop hook: keeps the repo memory fresh so the next session (cloud or local) can continue.
# It blocks stopping ONCE (exit 2, message shown to Claude) when:
#   1. this branch has commits from over 45 minutes ago that docs/memory/NOW.md doesn't reflect yet, or
#   2. (local sessions only) commits older than 45 minutes haven't been pushed.
# Stopping again goes through (stop_hook_active). Cloud sessions already have the harness's own
# commit-and-push check, so check 2 is skipped there. Docs: docs/process/SESSIONS.md §9.
#
# Portable on purpose (Linux, macOS, Windows Git Bash): bash + git + awk only; no jq.

set -u
input=""
if [ ! -t 0 ]; then input="$(cat 2>/dev/null || true)"; fi
case "$(printf '%s' "$input" | tr -d ' \n')" in *'"stop_hook_active":true'*) exit 0 ;; esac

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branch="$(git branch --show-current 2>/dev/null)"
[ -n "$branch" ] || exit 0
git rev-parse -q --verify origin/main >/dev/null 2>&1 || exit 0

MEM="docs/memory/NOW.md"
LIMIT=2700   # 45 minutes, in seconds
now="$(date +%s)"

# Oldest (smallest) commit timestamp in a range. Computed explicitly, because git's output
# order doesn't have to follow commit dates (rebases, cherry-picks, clock differences between machines).
oldest_in() { git log --format=%ct "$@" 2>/dev/null | awk 'NR == 1 || $1 < min { min = $1 } END { if (NR > 0) print min }'; }

# 1) Memory freshness: commits made AFTER the branch's last NOW.md update (by ancestry, not by date)
#    that touch something other than docs/memory/.
last_mem_sha="$(git log -1 --format=%H origin/main..HEAD -- "$MEM" 2>/dev/null)"
range="origin/main..HEAD"
[ -n "$last_mem_sha" ] && range="$last_mem_sha..HEAD"
oldest_unrecorded="$(oldest_in "$range" -- . ':(exclude)docs/memory')"
if [ -n "$oldest_unrecorded" ] && [ $(( now - oldest_unrecorded )) -gt "$LIMIT" ]; then
  echo "Memory check: branch '$branch' has work committed over 45 minutes ago that docs/memory/NOW.md does not reflect yet. Before stopping, run the end-session skill (at minimum: update NOW.md's 'Next action', add a LOG.md entry, commit, push) so the next session, cloud or local, can continue. If nothing here is worth recording, simply stop again." >&2
  exit 2
fi

# 2) Local sessions only: unpushed commits older than 45 minutes.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  if git rev-parse -q --verify "origin/$branch" >/dev/null 2>&1; then
    oldest_unpushed="$(oldest_in "origin/$branch..HEAD")"
  else
    oldest_unpushed="$(oldest_in origin/main..HEAD)"
  fi
  if [ -n "$oldest_unpushed" ] && [ $(( now - oldest_unpushed )) -gt "$LIMIT" ]; then
    echo "Push check: branch '$branch' has commits older than 45 minutes that are not on GitHub. Push them (git push -u origin $branch) so a session on another machine or in the cloud can continue. If you mean to keep them local for now, simply stop again." >&2
    exit 2
  fi
fi
exit 0
