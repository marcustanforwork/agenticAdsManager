# F3 — Pre-live rehearsal

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | fix (runs before the Phase 0 gate, D-092) |
| **Started** | 2026-10-19 |
| **Finished** | — |
| **PRs** | — |

## Goal
The whole system runs once, end to end, the way the first live weekend will, on the fixture accounts and a local database; what breaks is fixed before Marcus's setup.

## Needs
- [x] F2 merged: PR [#23](https://github.com/marcustanforwork/agenticAdsManager/pull/23), merged 2026-10-19 (squash `ab3e2a7`).
- External facts: F3 adds no new API, library or service; no GOTCHAS entry is past its re-check date (earliest 2026-11-02).

## Read first
- `docs/runbook.md`; `NOW.md` "Live steps for Marcus"; the live steps in the M00–M10b milestone files; the Phase 0 checklist artifact.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Where it lives: a new test-only workspace package, **`packages/rehearsal`** (`@ads/rehearsal`, private, no `src`, nothing imports it). It is the one place allowed to use the worker, the dashboard and the evals together, as devDependencies (its own boundary rule). `apps/web`'s own tree is unchanged (invariant 10). `@ads/app-worker` and `@ads/app-web` get source-only `exports` subpaths for it.
- What it fakes, and nothing else: the ad platforms (the connectors' cassettes, dates moved to the run's windows, as core's cycle tests do), Google's token endpoint, SnapPool's database (a throwaway Postgres database with SnapPool's tables, as the pack's adapter test makes), the AI model (a mock that confirms every detector candidate, writes the drafter's words and the brief's prose), Telegram (a fake API; presses and messages go to the bot's own handlers, as grammY would deliver them), the healthchecks pings, and the clock.
- Build order (each leaves the tree green; commit and push after each):
  1. The package scaffold (boundary rule, README, exports) and the rehearsal's first part: migrate (twice) and `ads seed`; link the fixture accounts and put their credentials (`ads accounts link`, `ads credentials put`); `ads settings set`; `ads outcomes`; the dry syncs.
  2. The worker part: the worker service (schedule off) with the fake Telegram on Monday morning: the catch-up's daily cycle sends a digest; the weekly cycle at phase 0 sends a brief and makes no proposal; 👍 / 💡 by button; a few M09b commands.
  3. The restart part: the next day, the worker is stopped while its daily cycle is syncing; the next start resumes it (`cyclesResumed: 1`).
  4. Phase 1: `ads phase set 1`, then a weekly cycle: proposals and their cards; approve one by button, reject one with a reason, edit one (`match phrase`); `ads proposals list`; the dashboard's Overview and Proposals render from the same database, and a decision made on the dashboard (its role, `recordWebRequest`) is processed by the worker; `ads eval replay` scores the decisions.
  5. Every live-step command checked: a test that reads `NOW.md` and the milestone files and checks every `ads …` command (subcommands and flags against the CLI) and every `pnpm --filter … <script>` (the package and script exist). Fix the docs or the CLI.
  6. Fix what 1–5 find, each with a test; update the Phase 0 checklist artifact if a step changed.
- Then: `preflight`, `code-review` at high effort, fixes, `close-milestone`, `end-session`, one PR.
- Cut first, if behind at ~300k: the restart part (3); rendering the dashboard pages (keep the web request round trip).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. **A rehearsal test** that runs in CI (fixtures only, no secrets), on a fresh database:
  - migrate and seed;
  - link the fixture Meta and Google accounts with test credentials (cassette replay);
  - run the worker service (its schedule off) with a fake Telegram API: a daily cycle puts a digest in the outbox; a weekly cycle at phase 0 makes a brief and no proposals;
  - `ads phase set 1`, then a weekly cycle: proposals and their cards; approve one by callback, reject one, edit one;
  - the dashboard's Overview and Proposals pages render them from the same database;
  - `ads eval replay` scores the decisions;
  - a restart in the middle of a cycle resumes it.
- [ ] 2. **Every live-step command checked** against the CLI: each command in `NOW.md` and the milestone files exists, with the flags and order written. Fix the docs or the CLI.
- [ ] 3. **Fix what items 1 and 2 find**, each with a test. Anything too big for the session becomes a note for Marcus in the PR.
- [ ] 4. Update the Phase 0 checklist artifact if a step changed.

## Tests
- [ ] The rehearsal itself, green in CI.

## Done when (cloud)
- [ ] The rehearsal is green in CI, and every live-step command is checked.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] Marcus's first live weekend follows the checked steps.
  - result: —

### Live steps for Marcus
None of its own: the first live weekend follows the (checked) live steps of M00–M10b.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- …

## Skills to create
- None.

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
- 2026-10-19: started from `main` at `ab3e2a7` (F2 merged).
