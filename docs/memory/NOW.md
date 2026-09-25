# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-09-25 · cloud session · plan v3.3, merged into `main` through PR [#1](https://github.com/marcustanforwork/agenticAdsManager/pull/1) on Marcus's instruction, after CI passed (D-057)

## Where we are
- **Phase:** planning is done. Phase 0 starts with M00.
- **Active milestone:** none. **M00 is next.**
- **Status:** plan v3.3 is on `main`. All of Marcus's answers so far are recorded (D-039–D-053 adopted; D-054–D-063). The budget is S$500 a month; Marcus resets and adjusts the Meta spending limit by hand, and the agent reads it live (D-063). SnapPool has no tracking today: the fix is a small change built in the **snappool** repo (`docs/plan/SNAPPOOL-TRACKING.md`), waiting for his OK (Q11).
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens: 25 sessions (BLUEPRINT §9). Local sessions will later run on the SER9 (D-058).

## Next action
1. **Claude (next session: clean context, Opus 5.5, medium effort):** run `start-milestone` for **M00**. It needs nothing from Marcus, except T1 before its PR is merged. Cloud: if your assigned branch's PR is already merged, reset the branch to `origin/main` first (`start-session` §2).
2. **Marcus:** setup task **T1** (GitHub repo settings: `docs/process/GIT-WORKFLOW.md` §9), before M00's PR is merged.
3. **Marcus:** answer **Q11**: OK the SnapPool tracking change and the privacy wording. Then a session in the **snappool** repo builds it from `SNAPPOOL-TRACKING.md` §3. **Do it early:** ads can only be credited for visitors who arrive after it ships.
4. **Marcus:** the setup tasks that take days: **T5** (Google), **T4** (Meta, including a spending limit of about S$500 that you reset by hand), **T6a** (a read-only SnapPool DB connection string); and **T14** (ad URL settings) when the ads are created. The full list is in `PROPOSAL.md` §16.

## In flight
- Nothing. PR #1 (plan v3.3, process docs, the memory system, the skills and the SnapPool tracking spec) was squash-merged into `main` on 2026-09-25.

## Blocked on Marcus
- Q11 in `QUESTIONS.md`. It doesn't block M00–M05a.
- Setup tasks T1–T14 (`PROPOSAL.md` §16).

## Live steps for Marcus
- None yet.

## Deployed
- Nothing deployed yet.

## Milestone tracker (one row = one session)
| M | Title | Ph | Status | PR | Notes |
|---|---|---|---|---|---|
| M00 | Scaffold, contracts, boundaries, CI | 0 | **next** | — | Needs nothing (T1 before merge) |
| M01a | Database schema and repositories | 0 | not started | — | Live steps: T2, T3 |
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
