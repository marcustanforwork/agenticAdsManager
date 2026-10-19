# F3 — Pre-live rehearsal

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | built; awaiting Marcus's merge (no live steps of its own) |
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
  - [x] ~300k built, typecheck green (build 1 at ~370k: the rehearsal needed more runs than planned)
  - [x] ~450k tests green, self-review done (at ~410k)
  - [x] ~550k committed, pushed, handed off (closed at ~440k)

## Builds
- [x] 1. **A rehearsal test** that runs in CI (fixtures only, no secrets), on a fresh database:
  - migrate and seed;
  - link the fixture Meta and Google accounts with test credentials (cassette replay);
  - run the worker service (its schedule off) with a fake Telegram API: a daily cycle puts a digest in the outbox; a weekly cycle at phase 0 makes a brief and no proposals;
  - `ads phase set 1`, then a weekly cycle: proposals and their cards; approve one by callback, reject one, edit one;
  - the dashboard's Overview and Proposals pages render them from the same database;
  - `ads eval replay` scores the decisions;
  - a restart in the middle of a cycle resumes it.
  - done: `packages/rehearsal/test/rehearsal.test.ts`, nine stretches in the live steps' order, on an empty database (≈15 s):
    1. M01a: `pnpm --filter @ads/db db:migrate` (the real script, twice), `ads seed` (twice), the products and flags as the Neon editor shows them, `ads phase` = 0.
    2. M02, M03: `ads accounts link` (Meta; Google with its manager), `ads credentials put` (an access token; a service-account key), `ads sync --dry` on both (Google's first read: 90 days of click ids, under 200 requests).
    3. M05a, M05b: `ads outcomes` from a fake SnapPool database (its tables, the pack's fixture rows), the starting settings, the KPI switched to `paid` and back, `ads docs list`. All of this on Sunday afternoon.
    4. M07, Monday 08:30: the worker starts (schedule off: its catch-up queues the day's runs); the digest and the weekly brief reach the fake Telegram, in either order; phase 0: the analyst runs, nothing is drafted; the test-email domain set after the first read marks that signup as test; heartbeats pinged; 👍 and 💡 pressed, `ads brief` shows them and `writer: model`; M09b's `/status` and `/ceiling snappool daily 20`.
    5. M04, Tuesday: the worker is stopped while its daily cycle's sync is in flight (the job is released, the cycle unfinished); the next start resumes it (`cyclesResumed: 1`), the recovery note and the digest arrive.
    6. M07 step 6: two weeks unattended (7–18 October): a digest each morning (12), Monday's brief, nothing for property-sg, no proposal; 👍 on the second brief.
    7. M08, M09a: `ads phase set 1 --note …`; the feedback routes' destinations set (standing in for T4 and T11); Monday 19 October: three proposals and their cards (pause the Meta campaign, pause the Google campaign, a negative "free event photo pool"), each card saying "0 signups"; approve by button, reject with a reason, edit to `match phrase` (v2); `ads proposals list --all` agrees.
    8. M10b: Overview and Proposals rendered under the dashboard's role from the same database; the agree rate (2 of 3); a brief feedback recorded as the dashboard records it, processed by the running worker.
    9. M08 step 5: `ads eval replay` scores the three decisions.

    Fakes (`test/support/`), and nothing else: the platforms (the connectors' cassettes, with the dates in the queries and in the responses moved to the run's day; a click-id day the fixture lacks answers no rows), Google's token endpoint, SnapPool's database and its daily traffic (signups carrying click ids), the AI (a mock that confirms each candidate, writes the drafter's words and the brief), Telegram (presses and replies go to the bot's own handlers), the healthchecks pings, the clock.
- [x] 2. **Every live-step command checked** against the CLI: each command in `NOW.md` and the milestone files exists, with the flags and order written. Fix the docs or the CLI.
  - done: `packages/rehearsal/test/liveSteps.test.ts` reads the "Live steps for Marcus" sections of NOW.md and every milestone file, and the whole runbook (673 shell commands, 74 of them `ads …`), and checks each `ads …` against the CLI's own command tree (subcommands, flags, choices, mandatory options, `--product`), each `pnpm --filter <package> <script>` against the workspace and the flags its script declares, and each Telegram command typed against the bot's table. Every command passed: no doc or CLI fix was needed. It stays in CI, so a doc edit that breaks a command fails there.
- [x] 3. **Fix what items 1 and 2 find**, each with a test. Anything too big for the session becomes a note for Marcus in the PR.
  - fixed: **a finding's evidence names the KPI stage at 0** for a campaign, an account or the product (`computeEvidence` takes the KPI stage): pause cards, the dashboard's proposals and the analyst's data said nothing where they should say "0 signups". Below a campaign (an ad set, an ad group), where only the platform's own ids credit an outcome (T14), a stage without outcomes stays absent rather than a made-up 0 (from the code review). Test: `core/test/evidence.test.ts`; the property replay case regenerated from its recorded answer (two candidates now show `form_fill: 0`).
  - fixed (testability, as the rehearsal needs): the worker gives its clock to the Telegram bot (expiries and conversations used the real clock while the cycles used the worker's), and takes a `model`; the CLI takes a `tokenFetch` for Google's sign-in.
  - checked, not bugs: a signup read before the test-email domain is set is re-marked as test by the next read (`upsertOutcomes`); the agree rate counts proposals by the database's own time (the real time on the SER9).
  - for Marcus (no code change; the plan already says what to do): **SnapPool's Phase 1 will be slow to reach "≥ 15 agent proposals in 3 weeks"**. A negative keyword needs Google's `tracking_active` to pass, and Google learns of SnapPool's conversions only through the agent's uploads (Phase 2, T11): no negatives in Phase 1. A pause needs recent signups that carry that platform's click ids (Meta's `fbclid` arrives; Google's `gclid` needs T14) and goes on active campaigns only (two today), so about two a week at most. PROPOSAL §12 already says "Too few proposals? Raise the campaign ceiling or extend the window. Never lower the bar." Doing T14 before phase 1 helps.
  - cosmetic, left: counts above 999 print without a thousands separator ("21340 impressions", "Impressions 14030").
- [x] 4. Update the Phase 0 checklist artifact if a step changed.
  - no step changed (every command passed as written), so the artifact stays as it is.

## Tests
- [x] The rehearsal itself, green in CI (green locally; CI runs on the PR).

## Done when (cloud)
- [x] The rehearsal is green in CI, and every live-step command is checked.
  - evidence: `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check` → exit 0 (see Evidence); the rehearsal's 9 stretches in ≈15 s and the live-step check's 5 tests among them. CI on the PR runs the same.

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
- **Keep the rehearsal running through later milestones.** M11a onwards add stretches to `packages/rehearsal/test/rehearsal.test.ts` (the gateway applying an approved pause, its undo) rather than a second end-to-end test. A milestone that adds a live step writes its command in its milestone file's "Live steps for Marcus": `liveSteps.test.ts` then checks it.
- The fakes are in `packages/rehearsal/test/support/`: `platforms.ts` (the cassettes, any day), `model.ts` (one mock for the analyst, drafter and brief), `telegram.ts` (Marcus's chat, presses and replies), `cli.ts` (`ads` in-process). The fake SnapPool database is the pack's `./testing` export; its daily signups are written by the rehearsal (`traffic`).
- Timestamps the database sets itself (`created_at`) are the real time, not the rehearsal's clock: read a window over them (the agree rate) at the database's `now()`.
- SnapPool's Phase 1 (for Marcus, before phase 1): no negatives until Google sees conversions (Phase 2's uploads, T11); pauses need click ids on signups (T14 for Google); the 1 → 2 gate will likely need PROPOSAL §12's longer window.

## Skills to create
- None.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | no write path touched |
| 2 | No product logic in shared code | yes | shared code names no product (the preflight grep is clean) |
| 3 | AI calls through core/model | yes | the rehearsal's mock goes through core's model layer |
| 4 | The AI never supplies decision numbers | yes | evidence still from SQL; the KPI 0 is core's |
| 5 | Untrusted text is data | yes | platform text stays inside the DATA blocks (unchanged) |
| 6 | Money is bigint micros / decimal strings | yes | no money arithmetic added |
| 7 | Every write action has an undo and a test | n/a | no write action or guard touched |
| 8 | Every guard has a property test; copy rules have pass/fail examples | n/a | no write action or guard touched |
| 9 | Surfaces only record intent | yes | the rehearsal decides only through requests (Telegram, CLI, the dashboard's role) |
| 10 | apps/web depends only on contracts + db | yes | apps/web's tree unchanged (check-boundaries); only an `exports` field added |
| 11 | product_id + an index on product-scoped tables | yes | no table added |
| 12 | No state outside Postgres | yes | no state outside Postgres |
| 13 | No secrets or personal data | yes | test keys made at run time; fixture emails made up (example.com) |
| 14 | No production write capability outside the gateway | yes | no write credentials anywhere |
| 15 | Cut items moved at most once | yes | nothing cut |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-095), BLUEPRINT v3.33 updated |

## Evidence
```
$ pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check
 Test Files  92 passed | 1 skipped (93)
      Tests  1104 passed | 3 skipped (1107)
All matched files use Prettier code style!
exit 0
```
(Re-run after the review fixes: the same counts, exit 0.)

**Code review (high, D-067), 9 findings:** 6 fixed, 1 simplified, 2 not:
1. The KPI 0 below a campaign was a made-up zero (no platform ids until T14): fixed, the 0 only for a campaign, an account or the product; test in `evidence.test.ts`.
2. The fake platforms re-serve a request repeated in one cycle, and their `calls` list could misattribute under concurrency: `calls` removed (unused); the limit is written in the code (core's cycle tests catch a repeated request).
3. `2>&1` swallowed the next token: fixed, test.
4. A `#` inside quotes cut a fenced line: fixed (`withoutComment`), test.
5. A flag inside another's name passed the script check (`ager` in `manager`): fixed, test.
6. Flags after `…` were not checked: fixed (only what's missing is excused), test.
7. The property case's note claimed its prompt was unchanged: the note now says what changed since.
8. Copies of the HTML-to-text helper and of a fake Telegram API: not changed; each test package keeps its own small helper, as `apps/web` and `apps/worker` do.
9. NOW.md behind the milestone file: updated at the session's end.

## Notes and surprises
- 2026-10-19: started from `main` at `ab3e2a7` (F2 merged).
