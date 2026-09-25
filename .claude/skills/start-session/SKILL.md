---
name: start-session
description: Orient at the start of a working session on the Ads Agent repo, in the cloud or on a local machine. Use when a session begins, when the user says "continue", "resume", "pick up where we left off" or "what's next", or gives no specific task, and after a context compaction. Finds the newest memory (even on an unmerged branch or in a stale local clone), gets onto the right branch, reads only what the active milestone needs, and states the session plan before any code is written.
---

# Start a session

Goal: know within a few minutes exactly where the project stands and what to do next, without reading everything.

## 1. Read what the SessionStart hook printed

`.claude/hooks/session-start.sh` printed a block that starts with `=== Ads Agent session context`. It tells you:
- the checkout branch, any uncommitted leftovers, and how far you are behind or ahead of `origin/main`;
- **where the newest `docs/memory/NOW.md` lives**, and its full text if it isn't the copy in your checkout;
- the unfinished work branches on GitHub.

No block, or it looks broken? Run `bash .claude/hooks/session-start.sh < /dev/null` yourself.

`CLAUDE.md` has already loaded the `NOW.md` from your checkout. **If the hook says a newer one exists on another branch, the newer one is the truth.**

## 2. Get onto the right branch (details: `docs/process/GIT-WORKFLOW.md` §3–4)

- **The newest memory is on `origin/main`:** build on `origin/main`.
  - Cloud: your assigned branch normally starts from `main`. If `git log --oneline HEAD..origin/main` shows commits and your branch has none of its own, run `git merge --ff-only origin/main`.
  - Local: `git switch -c m<NN>/<slug> origin/main`, or continue your existing local branch for the same work.
- **The newest memory is on a work branch** (an unmerged PR): continue it.
  - Local: `git switch <branch> && git pull --ff-only`.
  - Cloud: first confirm `git log --oneline origin/main..HEAD` is **empty** (your assigned branch has no work of its own), then run `git reset --hard origin/<branch>`. At the end you will supersede its PR.
- **Uncommitted leftovers in a local checkout:** ask Marcus before touching them. They may be his.
- **Several candidate branches:** list them for Marcus and ask. Don't guess.

## 3. Pick up what changed since the last session

- `docs/memory/QUESTIONS.md`: has Marcus answered anything? If so, record it with the `update-plan` skill.
- The last PR: review comments, CI status, and any "live steps done" notes. In cloud sessions use the GitHub MCP tools (`pull_request_read`, `list_pull_requests`); locally, `gh pr view` or the web UI.
- The user's first message may contain answers or live-step results. Record them in the milestone file.

## 4. Read the active milestone, and only what it needs

- `NOW.md` names the active milestone. Open `docs/milestones/M<NN>-*.md`.
- No milestone file yet? Run the `start-milestone` skill.
- Read only the `docs/plan/BLUEPRINT.md` sections listed under **Read first** for the next unticked items.
- From M00 on: if the hook didn't install dependencies, run `pnpm install`, then a quick `pnpm typecheck` to confirm the checkout is healthy.

## 5. State the plan, then start

Tell Marcus, in 8 lines or fewer and in plain words:
- where things stand (one line);
- what this session will do (1–3 items), and what "done" means for each;
- anything waiting on him (question ids, live steps, setup tasks).

Then start working. Wait for his go-ahead only if:
- he asked to confirm plans first; or
- the work depends on a decision marked **needs OK** that he hasn't answered.

## Don'ts

- Don't read all of `PROPOSAL.md` and `BLUEPRINT.md` at every start.
- Don't start the next milestone while the current one has unticked items, unless `NOW.md` says so.
- Don't start from `main` while a newer unmerged work branch exists.
- Don't touch uncommitted files you didn't create.
