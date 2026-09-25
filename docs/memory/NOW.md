# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-09-25 · cloud session · branch `claude/gifted-franklin-hk0fku` · PR: being opened (link below once it exists)

## Where we are
- **Phase:** planning (before Phase 0).
- **Active milestone:** none. M00 is next.
- **Status:** plan v3.1 is written. That's `docs/plan/PROPOSAL.md`, `BLUEPRINT.md` and `CHANGES-v3.md` (the review, with §H for Marcus's first answers). The git workflow, memory system, skills and hooks are set up. Waiting for Marcus's review and answers.
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens. That's 25 sessions (BLUEPRINT §9).

## Next action
1. **Marcus:** review the PR. Start with `docs/plan/CHANGES-v3.md` (~10 min), then `docs/plan/PROPOSAL.md` §0 (the one-page summary).
2. **Marcus:** answer `docs/memory/QUESTIONS.md`: Q1–Q5 and Q8–Q10. Q1, the recommendations needing your OK, matters most. Q6 and Q7 are already answered.
3. **Marcus:** merge the PR, then do setup task **T1** (GitHub repo settings: `docs/process/GIT-WORKFLOW.md` §9).
4. **Marcus:** start the setup tasks that take days: **T5** (Google manager account and developer token), **T4** (Meta app and system users), **T6** (SnapPool schema and tracking info). The full list is in `PROPOSAL.md` §16.
5. **Claude (next session, clean context):** run `start-milestone` for **M00**. It needs nothing from Marcus, apart from T1 before its PR is merged.

## In flight
- `claude/gifted-franklin-hk0fku`: plan v3.1, process docs and the memory system. The PR is being opened.

## Blocked on Marcus
- Q1–Q5 and Q8–Q10 in `QUESTIONS.md`. None of them block M00; each question lists what it blocks.
- Setup tasks T1–T13 (`PROPOSAL.md` §16).

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
| M04 | Sync, drift, trust checks | 0 | not started | — | |
| M05a | Pack SDK, SnapPool pack, settings | 0 | not started | — | T6; Q3, Q5 |
| M05b | Property pack (G8), attribution, product docs | 0 | not started | — | Q4, Q9 |
| M06a | AI layer, finding registry, detectors | 0 | not started | — | T9 |
| M06b | Analyst input, look-ups, analyse stage | 0 | not started | — | |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | not started | — | T7, T8; Q2 |
| M08 | Draft stage, proposals, replay v0 | 1 | not started | — | Phase 0 gate |
| M09a | Telegram bot core and proposal cards | 1 | not started | — | |
| M09b | Telegram operator commands | 1 | not started | — | |
| M10a | Dashboard: app, sign-in, settings | 1 | not started | — | T10 (Vercel Pro, Cloudflare) |
| M10b | Dashboard: review views | 1 | not started | — | |
| M11a | Gateway rules: allowlist, guards, fingerprint | 2 | not started | — | Phase 1 gate |
| M11b | Gateway pipeline, recovery, undo, service | 2 | not started | — | |
| M12 | Meta writes + CAPI | 2 | not started | — | T4 (write side); Q8 |
| M13 | Google writes + Data Manager (Phase 2 exit) | 2 | not started | — | T5, T11 |
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
