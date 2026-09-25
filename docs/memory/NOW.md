# NOW: where the project stands

> This file is auto-loaded into every Claude session via `CLAUDE.md`. The `end-session` skill rewrites it at the end of every session. Keep it to about 90 lines: detail belongs in the milestone file, history in `LOG.md`.

**Last updated:** 2026-09-25 · cloud session · plan v3.4, merged into `main` through PR [#2](https://github.com/marcustanforwork/agenticAdsManager/pull/2) on Marcus's instruction, after CI passed (D-057). PR #1 (plan v3.3) was merged earlier the same day.

## Where we are
- **Phase:** planning is done. Phase 0 starts with M00.
- **Active milestone:** none. **M00 is next.**
- **Status:** plan v3.4. **Every question is answered** (D-039–D-064). The SnapPool tracking plan is approved (D-060). Its spec, `docs/plan/SNAPPOOL-TRACKING.md` v1.2, now has fixes from reading SnapPool's code (D-064), and in §7 **the prompt Marcus pastes into a SnapPool session** to build it. Budget: S$500 a month; Marcus resets the Meta limit by hand, and the agent reads it live (D-063).
- **Session model (D-056):** one clean-context session per milestone part, on Opus 5.5 at medium effort, each within 400–600k tokens: 25 sessions (BLUEPRINT §9). Local sessions will later run on the SER9 (D-058).

## Next action
1. **Marcus: the SnapPool tracking change (T6b), early.**
   - Paste the prompt from `SNAPPOOL-TRACKING.md` §7 into a Claude Code session in the **snappool** repo, on a machine where `gh` is signed in.
   - Apply its migration to production **before** deploying.
   - Approve the privacy wording in its PR.
   - When it's live, tell Claude the date, and record it under **Deployed** below. Attribution data starts that day.
2. **Claude (next session: clean context, Opus 5.5, medium effort):** run `start-milestone` for **M00**. It needs nothing from Marcus, except T1 before its PR is merged. Cloud: if your assigned branch's PR is already merged, reset the branch to `origin/main` first (`start-session` §2).
3. **Marcus:** setup task **T1** (GitHub repo settings: `docs/process/GIT-WORKFLOW.md` §9), before M00's PR is merged.
4. **Marcus:** the setup tasks that take days: **T5** (Google), **T4** (Meta: a dataset with a Conversions API token, no pixel code on the site, and a spending limit of about S$500 that you reset by hand), **T6a** (a read-only SnapPool DB connection string); and **T14** (ad URL settings) when the ads are created. The full list is in `PROPOSAL.md` §16.

## In flight
- Nothing. PR #2 (Q11 recorded, spec v1.2 with fixes and the SnapPool prompt) was squash-merged into `main` on 2026-09-25.

## Blocked on Marcus
- No open questions.
- The SnapPool tracking change (T6b), and setup tasks T1–T14 (`PROPOSAL.md` §16).

## Live steps for Marcus
- The SnapPool session (Next action 1).

## Deployed
- Ads Agent: nothing yet.
- SnapPool tracking (T6b): not built yet. Record its go-live date here; attribution data starts then.

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
