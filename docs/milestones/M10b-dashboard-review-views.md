# M10b — Dashboard: review views

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 1 (built before the Phase 0 gate, D-090) |
| **Started** | 2026-10-19 |
| **Finished** | — |
| **PRs** | — |

## Goal
Review everything the agent has done, and act on proposals, from a screen.

## Needs
- [x] M10a (the app, sign-in, the request round trip): merged in PR #18. Its live steps (T10) wait; M10b's build doesn't need them.
- [x] Marcus's go-ahead to build before the Phase 0 gate: **D-090** (2026-10-19). Its live steps wait for M07's deploy and the gate.
- [x] The request handlers the views record: `approve`, `reject`, `edit_approve` (M08/M09a), `undo` (M09b), `brief_feedback` (M07), `product_doc_put` (M05b). No new request kind is needed.

## Read first
- M10a's milestone file; PROPOSAL §12 (how the gates are measured).

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- No new external API or library: Next.js 16 and React 19 were verified in M10a (GOTCHAS); nothing else is touched.
- Build order:
  1. DB: the `dashboard_outcomes` view in the drizzle schema (it already exists in `roles.sql`), and `repos/dashboard.ts`: the reads the views need that no repository has yet, all allowed to the dashboard's role (outcomes only through the view). Tested under `agent_dashboard`.
  2. `apps/web/src/lib`: pure computations (month projection, the 28-day KPI trend by week and day, the attribution rate, describing a proposal or change in words) and one loader per view.
  3. Pages, per product: **Overview** (spend vs ceilings with the projection, the KPI trend, outcomes by stage and attribution, accounts and last sync), **Proposals** (open ones with Approve / Reject / Edit; recently decided), **Changes** (the change log with "request undo"), **Checks** (trust-check history per cycle, drift, AI cost per cycle), **Briefs** (with 👍 / 💡), **Docs** (STRATEGY, PLAYBOOK, LEARNINGS editors with history). Each form records one request and goes to `/requests/<id>`, which then links back to the screen it came from.
  4. Tests: each view rendered from a fixture database (loader under the dashboard's role → component → HTML); the forms' requests; the processor round trip for each new kind from the web channel.
- Cut first, if behind at ~300k: the briefs view; the AI cost panel; Playwright.
- Playwright: there is no Playwright in the repo, and "`/status` shows it" is the Telegram bot. Planned instead: a browser run against the built app (as in M10a), and the `/status` check stays in the live steps.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. Views per product:
  - [ ] spend (yesterday and month-to-date) vs the ceilings, with a projection;
  - [ ] the 28-day KPI trend;
  - [ ] outcomes by stage, and the attribution rate;
  - [ ] trust-check history;
  - [ ] open proposals, which can be approved, rejected or edited (as requests);
  - [ ] the change log, with "request undo";
  - [ ] drift;
  - [ ] briefs, with the feedback buttons;
  - [ ] AI cost;
  - [ ] STRATEGY, PLAYBOOK and LEARNINGS editors, with history;
  - [ ] a read-only list of accounts, with their last sync.

## Tests
- [ ] Each view renders from a fixture database.
- [ ] Proposal actions and undo requests create the right operator requests.
- [ ] Playwright smoke test: change a ceiling, and `/status` shows it.

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] Marcus reviews a week of proposals and the change log on the dashboard.
  - result: —

The **Phase 1 gate** is then evaluated (PROPOSAL §12). Its 3-week window can overlap the M09 and M10 build time.

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- …

## Skills to create
- none listed for M10b.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | | |
| 2 | No product logic in shared code | | |
| 3 | AI calls through core/model | | |
| 4 | The AI never supplies decision numbers | | |
| 5 | Untrusted text is data | | |
| 6 | Money is bigint micros / decimal strings | | |
| 7 | Every write action has an undo and a test | | |
| 8 | Every guard has a property test; copy rules have pass/fail examples | | |
| 9 | Surfaces only record intent | | |
| 10 | apps/web depends only on contracts + db | | |
| 11 | product_id + an index on product-scoped tables | | |
| 12 | No state outside Postgres | | |
| 13 | No secrets or personal data | | |
| 14 | No production write capability outside the gateway | | |
| 15 | Cut items moved at most once | | |
| 16 | Memory is current | | |

## Evidence
<!-- command output that proves "Done when (cloud)" -->

## Notes and surprises
- 2026-10-19: started. The dashboard role can't read `outcomes` (hashed contact details), only the `dashboard_outcomes` view, so the outcome counts the digest uses (`countOutcomesByScope`) can't be reused as they are; the dashboard gets its own counts over the view.
