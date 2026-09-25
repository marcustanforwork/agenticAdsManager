# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-09-25 · cloud session · M01a started.

## Where we are
- **Phase:** 0.
- **Active milestone:** **M01a: in progress** (`docs/milestones/M01a-database-schema-repositories.md`). M00 is merged and awaiting its live acceptance (the SER9 Docker check, below).
- **Status:** plan v3.4. No open questions. D-065 records M00's build choices: Node 24.21.0, TypeScript 6 (not 7), source-condition resolution, and one Doppler token per service.
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens (BLUEPRINT §9).

## Next action
1. **Claude (this session):** M01a Build 1: the Drizzle schema, migration, scripts and test-database helper.
2. **Marcus, when at the SER9:** the M00 live steps (below). They don't block M01a.
3. **Marcus, optional part of T1:** in the `main` ruleset, turn on "Require status checks to pass" with `memory-check`, `ci` and `secret-scan`. The rest of T1 is done (squash only, auto-delete branches, Actions read-only).
4. **Marcus:** the SnapPool tracking change (T6b), early: paste the prompt from `SNAPPOOL-TRACKING.md` §7 into a SnapPool session. Then the setup tasks that take days: **T2 and T3** (needed for M01a's live steps), T4, T5, T6a (`PROPOSAL.md` §16).

## In flight
- Nothing. PR #3 (M00) was squash-merged into `main` on 2026-09-25.

## Blocked on Marcus
- No open questions.
- The M00 live steps (SER9); T1's required status checks (optional); the SnapPool tracking change (T6b); setup tasks T2–T14.

## Live steps for Marcus
M00 on the SER9 (Linux, Docker). These use **no secrets**:
1. `git clone https://github.com/marcustanforwork/agenticAdsManager && cd agenticAdsManager` (or `git pull` on `main` after the merge).
2. `docker compose -p ads-agent-dev up --build`. Expect two log lines containing `"msg":"ready"`, one from `worker` and one from `gateway`.
3. In another terminal: `docker compose -p ads-agent-dev ps`. Both should say `healthy` after about 30 s.
4. `docker compose -p ads-agent-dev stop`. Expect `"msg":"stopped"` from both, and exit code 0 (`docker compose -p ads-agent-dev ps -a`).
5. Clean up: `docker compose -p ads-agent-dev down`.
6. Report: "ready, healthy, stopped", or paste the output.

The `-p ads-agent-dev` keeps this away from the production project name (D-058). Production runs as `docker compose up -d` from M07.

## Deployed
- Ads Agent: nothing yet.
- SnapPool tracking (T6b): not built yet. Record its go-live date here; attribution data starts then.

## Milestone tracker (one row = one session)
| M | Title | Ph | Status | PR | Notes |
|---|---|---|---|---|---|
| M00 | Scaffold, contracts, boundaries, CI | 0 | **awaiting live acceptance** | [#3](https://github.com/marcustanforwork/agenticAdsManager/pull/3) (merged) | Live: compose up/stop on the SER9 (to do) |
| M01a | Database schema and repositories | 0 | **in progress** | — | Live steps: T2, T3 |
| M01b | Queue, leader lock, vault, request processor | 0 | not started | — | |
| M02 | Meta read connector | 0 | not started | — | T4 (read side) |
| M03 | Google read connector | 0 | not started | — | T5 |
| M04 | Sync, drift, trust checks | 0 | not started | — | Includes the Meta spending-limit check (D-063) |
| M05a | Pack SDK, SnapPool pack, settings | 0 | not started | — | T6a (read-only DB URL); SnapPool facts in SNAPPOOL-TRACKING |
| M05b | Property pack (G8), attribution, product docs | 0 | not started | — | Real attribution needs T6b shipped |
| M06a | AI layer, finding registry, detectors | 0 | not started | — | T9 |
| M06b | Analyst input, look-ups, analyse stage | 0 | not started | — | |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | not started | — | T7, T8 |
| M08 | Draft stage, proposals, replay v0 | 1 | not started | — | Phase 0 gate |
| M09a | Telegram bot core and proposal cards | 1 | not started | — | |
| M09b | Telegram operator commands | 1 | not started | — | |
| M10a | Dashboard: app, sign-in, settings | 1 | not started | — | T10 (Vercel Pro, Cloudflare) |
| M10b | Dashboard: review views | 1 | not started | — | |
| M11a | Gateway rules: allowlist, guards, fingerprint | 2 | not started | — | Phase 1 gate |
| M11b | Gateway pipeline, recovery, undo, service | 2 | not started | — | |
| M12 | Meta writes + CAPI | 2 | not started | — | T4 (write side); T6b |
| M13 | Google writes + Data Manager (Phase 2 exit) | 2 | not started | — | T5, T11; T6b |
| M14 | Budgets, creates, pacing | 3 | not started | — | Phase 2 gate |
| M15a | Source copy and claim checks | 4 | not started | — | Phase 3 gate; T13 |
| M15b | Format checks, variants, proposals | 4 | not started | — | |
| M16a | Evals and the model-swap gate | 5 | not started | — | |
| M16b | Ops hardening: runbook, backups, doctor | 5 | not started | — | |

## Phase gates (PROPOSAL §12)
| Gate | Condition, in short | Status |
|---|---|---|
| 0 → 1 | Brief useful and new in 2 of the first 4 weeks; property pack added with zero core changes | not started |
| 1 → 2 | ≥ 70% agree over 3 weeks, with ≥ 15 agent proposals | not started |
| 2 → 3 | ≥ 20 live changes, 0 wrong, 0 unexplained verify failures, 1 undo drill | not started |
| 3 → 4 | 4 weeks: no guard bypass, no wrong budget change, no ceiling breach caused by the agent | not started |
| 4 → 5 | Variants pass the checks; a dropped required string is always blocked | not started |
