# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-09-25 · cloud session · branch `claude/gifted-franklin-hk0fku` · PR: none yet (Marcus to decide)

## Where we are
- **Phase:** planning (before Phase 0).
- **Active milestone:** none. M00 is next.
- **Status:** plan v3 is written: `docs/plan/PROPOSAL.md`, `BLUEPRINT.md` and `CHANGES-v3.md` (the review). The git workflow, memory system, skills and hooks are set up. Waiting for Marcus's review and answers.

## Next action
1. **Marcus:** read `docs/plan/CHANGES-v3.md`, which covers what the review found and changed (~10 min). Then read `docs/plan/PROPOSAL.md` §0, the one-page summary.
2. **Marcus:** answer `docs/memory/QUESTIONS.md`. Q1 (the recommendations needing your OK) matters most.
3. **Marcus:** merge this branch (open a PR, or ask Claude to), then do setup task **T1** (GitHub repo settings: `docs/process/GIT-WORKFLOW.md` §9).
4. **Marcus:** start the setup tasks that take days: **T5** (Google manager account and developer token), **T4** (Meta app and system users), **T6** (SnapPool schema and tracking info). The full list is in `PROPOSAL.md` §16.
5. **Claude (next session):** run `start-milestone` for **M00**. It needs nothing from Marcus, apart from T1 before its PR is merged.

## In flight
- `claude/gifted-franklin-hk0fku`: plan v3, process docs and the memory system. No PR opened yet.

## Blocked on Marcus
- Q1–Q10 in `QUESTIONS.md`. None of them block M00; each question lists what it blocks.
- Setup tasks T1–T13 (`PROPOSAL.md` §16).

## Live steps for Marcus
- None yet.

## Deployed
- Nothing deployed yet.

## Milestone tracker
| M | Title | Phase | Status | PRs | Notes |
|---|---|---|---|---|---|
| M00 | Scaffold, contracts, boundaries, CI | 0 | **next** | — | Needs nothing (T1 before merge) |
| M01 | Database, queue, vault, requests | 0 | not started | — | Live steps: T2, T3; Q7 |
| M02 | Meta read connector | 0 | not started | — | T4 (read side) |
| M03 | Google read connector | 0 | not started | — | T5 |
| M04 | Sync, drift, trust checks | 0 | not started | — | |
| M05 | Pack SDK, both packs, outcomes, settings | 0 | not started | — | T6; Q3–Q5, Q9 |
| M06 | Detectors, AI layer, analyse | 0 | not started | — | T9 |
| M07 | Digest, brief, services (Phase 0 exit) | 0 | not started | — | T7, T8; Q2 |
| M08 | Draft stage, proposals, replay v0 | 1 | not started | — | Phase 0 gate |
| M09 | Telegram control surface | 1 | not started | — | |
| M10 | Dashboard and settings | 1 | not started | — | T10; Q6 |
| M11 | Gateway core | 2 | not started | — | Phase 1 gate |
| M12 | Meta writes + CAPI | 2 | not started | — | T4 (write side); Q8 |
| M13 | Google writes + Data Manager (Phase 2 exit) | 2 | not started | — | T5, T11 |
| M14 | Budgets, creates, pacing | 3 | not started | — | Phase 2 gate |
| M15 | Copy variants + checks | 4 | not started | — | Phase 3 gate; T13 |
| M16 | Evals, model-swap gate, hardening | 5 | not started | — | |

## Phase gates (PROPOSAL §12)
| Gate | Condition, in short | Status |
|---|---|---|
| 0 → 1 | Brief useful and new in 2 of the first 4 weeks; property pack added with zero core changes | not started |
| 1 → 2 | ≥ 70% agree over 3 weeks, with ≥ 15 agent proposals | not started |
| 2 → 3 | ≥ 20 live changes, 0 wrong, 0 unexplained verify failures, 1 undo drill | not started |
| 3 → 4 | 4 weeks: no guard bypass, no wrong budget change, no ceiling breach caused by the agent | not started |
| 4 → 5 | Variants pass the checks; a dropped required string is always blocked | not started |
