# Sessions and the memory system

How any Claude session, **in the cloud (Claude Code on the web) or on Marcus's own machine**, picks up exactly where the previous one stopped.

---

## 1. Why this exists

- A Claude session forgets everything when it ends. Long sessions also get *compacted*: older context is summarised and detail is lost.
- Cloud containers are wiped after a session. A local session sees only that one machine.
- So **the repository is the memory.** Everything a future session needs is written to files in this repo and **pushed to GitHub**. A session that doesn't push has, as far as the next session is concerned, not happened.

---

## 2. The memory files

| File | Answers | Written by | When | Size rule |
|---|---|---|---|---|
| `CLAUDE.md` | "What are the rules here?" Auto-loaded by Claude Code. | Claude, via `update-plan` | Rarely | ≤ ~120 lines |
| `docs/memory/NOW.md` | "Where are we, and what exactly is next?" **Auto-loaded** (imported by `CLAUDE.md`). | Claude, at every session end and checkpoint | Overwritten each time | ≤ ~90 lines |
| `docs/memory/LOG.md` | "What happened in each session?" | Claude, at session end | New entry on **top** | ≤ 12 lines per entry |
| `docs/memory/DECISIONS.md` | "What did we decide, why, and what else was considered?" | Claude (records Marcus's decisions, and its own fixes) | When a decision is made | Append-only; supersede, never edit |
| `docs/memory/GOTCHAS.md` | "What surprised us: API quirks, tooling traps, verified external facts?" | Claude | When learned | Deduplicated; each entry dated with a source |
| `docs/memory/QUESTIONS.md` | "What does Claude need from Marcus?" | Claude asks; Marcus answers in the file or in chat | Any time | Answered ones move to *Answered* |
| `docs/milestones/M<NN>-<slug>.md` | "What's the detailed state of this milestone?" Checklist, cuts, verify commands, notes for later milestones. | Claude | Created at milestone start; ticked at every checkpoint | As needed |
| `docs/plan/*` | "What are we building and how?" | via `update-plan` only | When the plan changes | — |

**Read order at session start:** `CLAUDE.md` + `NOW.md` (automatic) → the active milestone file → only the BLUEPRINT sections that the milestone's *Read first* lists. **Don't read everything.**

---

## 3. Starting a session

### For Marcus

| Where | How |
|---|---|
| **Cloud** (claude.ai/code, app, mobile) | Start a session on this repo and say **"continue"**, or give a specific task. |
| **Local** (SER9 or laptop) | `cd agenticAdsManager && git fetch && claude`, then say **"continue"**. You don't need to pull first; the start-session skill handles branches. |

If you've answered questions or run live steps since the last session, tell the new session (or write the answer into `QUESTIONS.md` / the PR).

### For Claude: the `start-session` skill, in short

1. The **SessionStart hook** has already printed the checkout, uncommitted leftovers, the unmerged work branches, and **where the newest `NOW.md` is**. If the newest is on another branch, the hook prints it in full.
2. Get onto the right branch (`GIT-WORKFLOW.md` §3–4).
3. Read the active milestone file. Check `QUESTIONS.md` and the last PR for Marcus's answers and live-step results.
4. State the plan for this session in 3–8 lines (1–3 Build items, what "done" means for each), then start.

---

## 4. During a session: checkpoints

A **checkpoint** happens after each completed Build item, before anything risky or long, and whenever the context feels large.

1. The tests for that item pass.
2. Tick the item in the milestone file, and add notes: what's half-done, what's next, any surprise.
3. Commit, **and push**.
4. If more than ~45 minutes of work isn't yet reflected in `NOW.md`, update its **Next action** too. The Stop hook reminds you.

**Rule of thumb:** if the session vanished right now, could the next one continue in under 5 minutes of reading? If not, checkpoint.

**Questions for Marcus.** Put them in `QUESTIONS.md` (with the options and your recommendation) *and* ask in chat. Don't block: carry on with work that doesn't depend on the answer.

---

## 5. Ending a session: the `end-session` skill, in short

1. Run `preflight` (the checks plus an invariants review). Record failures honestly.
2. Milestone file: tick items, record cuts and moves, list the verify commands.
3. **Rewrite `NOW.md`** from its template:
   - status;
   - the **exact next action** (file, function, test);
   - in-flight branch and PR;
   - blockers;
   - live steps for Marcus;
   - tracker updates.
4. **Add a `LOG.md` entry on top.**
5. Add any `DECISIONS` / `GOTCHAS` / `QUESTIONS` entries.
6. Commit (`docs(memory): session handoff — …`) and **push**.
7. Open or update the PR (draft if the work is unfinished), using the template.
8. Tell Marcus, in plain words: what shipped, what's next, what he needs to do.

**Also run `end-session`** when the context is getting full, before a long wait, or when Marcus says "wrap up", "stop" or "pause".

---

## 6. Cloud sessions vs local sessions

| | Cloud session | Local session (SER9 / laptop) |
|---|---|---|
| Branch | Assigned by the harness (`claude/…`); push only there | Choose `m<NN>/<slug>`, or continue a work branch |
| GitHub | GitHub MCP tools (no `gh`) | `gh` if installed, or the GitHub web UI |
| Secrets | **None.** No platform tokens, no Doppler. | The Doppler `dev` config at most, only if Marcus provides it. **Never** the `worker` or `gateway` production configs. |
| Database | Local Postgres 16 in the container (`pg_ctlcluster 16 main start`) for tests | Local Postgres or Docker; the Neon `dev` branch with Marcus's OK |
| Docker | Client only, **no daemon**: images are built in CI | Available |
| Live platform APIs | No | Only with Marcus's explicit go-ahead: **read-only** credentials to record fixtures; test accounts for smoke tests |
| Good for | All code, tests, fixtures, docs, plan changes | The same, plus recording fixtures, live smoke tests, deploy help (M07+) |
| Ends with | The harness's own Stop hook enforces commit + push | This repo's Stop hook reminds you to update memory and push |

**Switching between them is safe** as long as every session ends with a push. The next session, wherever it runs, finds the newest memory through the SessionStart hook, even on an unmerged branch and even if the local clone is stale.

---

## 7. The live-steps handshake

Some acceptance steps need real accounts or the SER9 ("Done when (live)" in each milestone):

1. **Claude writes** the exact steps: commands, what to look for, what to paste back. They go in the milestone file, under **Live steps for Marcus** in `NOW.md`, and in the PR body.
2. **Marcus runs them** whenever he likes, and reports the results in the PR, in `QUESTIONS.md`, or at the start of the next session ("live steps for M02 done, output: …").
3. **The next session records the results** in the milestone file. A milestone is `done` only when its live steps are confirmed. Until then its status is `awaiting live acceptance`, and the next milestone may start only if it doesn't depend on those results.

---

## 8. How to write memory

- **Facts, not stories.** "Build 3 done: `listEntities` for Meta; tests in `connector-meta/test/list.test.ts`" rather than "I worked hard on…".
- **Absolute dates** (`2026-09-25`), never "yesterday" or "last week".
- **Link things:** commit SHAs, PR links, file paths with line numbers.
- **Next actions must be executable:** "Implement `getMetricsDaily` paging in `packages/connector-meta/src/insights.ts`; failing test `insights.test.ts › paginates`" rather than "continue Meta work".
- **Record uncertainty:** "not verified", "guess", "Marcus to confirm".
- **Decisions are never edited.** Write a new one that supersedes the old one.
- **Keep `NOW.md` short.** History belongs in `LOG.md`, and detail in the milestone file.

---

## 9. Hooks (what runs automatically)

Configured in `.claude/settings.json`; both work on Linux, macOS and Windows (Git Bash).

| Hook | Script | What it does |
|---|---|---|
| SessionStart | `.claude/hooks/session-start.sh` | 1. Fetches from GitHub, with a timeout; never changes files. 2. Prints: the checkout; uncommitted leftovers; whether you're behind `origin/main`; unmerged work branches; **where the newest `NOW.md` is**, printed in full if it isn't the one in your checkout. From M00 it also installs dependencies in cloud sessions. |
| Stop | `.claude/hooks/stop-memory-check.sh` | Blocks stopping **once** in two cases: work committed on this branch more than 45 minutes ago still isn't reflected in `NOW.md`; or, in a local session, commits more than 45 minutes old haven't been pushed. Stopping again goes through. |

To switch a hook off temporarily, comment it out in `.claude/settings.local.json` (git-ignored). Don't change `.claude/settings.json` unless the change is for everyone.

---

## 10. When things go wrong

| Situation | What to do |
|---|---|
| The context was compacted mid-session | Re-read `NOW.md` and the milestone file (the hook re-prints the context on `compact`). Trust the files over your summary. |
| A cloud container vanished mid-work | The next session finds the last pushed state. Anything unpushed is lost, which is why we push at every checkpoint. |
| A local session forgot to push | The next session, wherever it runs, sees an older memory. When you're back on that machine, push, then the next session reconciles (continue the newest branch; merge if needed). |
| Two branches both have "newest" work | Don't guess. Show Marcus both `NOW.md` versions and ask which to continue; merge the other or close it. |
| `NOW.md` merge conflict | Keep the newer session's version, re-add anything the other version knew that's still true, and re-check "Next action". |
| Memory and code disagree | **The code and git history win.** Fix the memory, and note it in `LOG.md`. |
| The plan is wrong or out of date | The `update-plan` skill. Don't let the docs drift. |
