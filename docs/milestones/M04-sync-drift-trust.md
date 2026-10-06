# M04 — Sync stage, drift, trust checks

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-06 |
| **Finished** | 2026-10-06 (cloud part) |
| **PRs** | see NOW.md (opened at the end of this session) |

## Goal
The first two cycle steps, end to end, for both platforms and both products.

## Needs
- [x] M02: merged (PR #6). Start from `dryRunSync` (`core/src/sync/dryRun.ts`), M02 "Leave behind".
- [x] M03: merged (PR #7). Start from `dryRunGoogle` (`core/src/sync/dryRunGoogle.ts`), M03 "Leave behind". Search terms were **not** cut from M03; M04 stores them.
- [ ] M00 / M01a / M02 / M03 live steps: not done yet (Marcus). Under D-074 they wait for the end of Phase 0 and don't block M04's cloud work, which builds on the hand-written fixtures.
- No setup task (T-number) is needed for M04's cloud part.

## Read first
- PROPOSAL §5.2 and §7; BLUEPRINT §5.6–5.8 (and §4 for `cycles`, `trust_checks`, `drift_events`, `ad_entity_snapshots`).
- M02 and M03 "Leave behind" (both above).
- External facts: none new. M04 uses the M02/M03 connectors, whose facts were checked on 2026-10-02/06 (GOTCHAS rows, re-check dates 2026-11-02/05, not reached). One new detail, checked 2026-10-06: Meta answers a by-id read of an object that doesn't exist with error 100/33 (GOTCHAS).

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order, each step green, committed and pushed:
  1. Schema: migration `0002` adds `accounts.trust_signals`, `accounts.last_sync_error`, `accounts.clicks_synced_through`; repo functions (sync result, snapshot with its previous one, changes since, the cycle lock).
  2. One sync stage for both platforms (`core/src/sync/`): shared client opening (the dry run uses it too), entities + snapshots on change + drift in one transaction, metrics, Google search terms and click ids, trust signals stored on the account. Drift tests with fixture pairs.
  3. Trust checks: pure check functions with table tests, then the trust stage (database only, no API calls).
  4. `runCycle`: stages as functions, `stage_reached` after each, the per-cycle lock, `until`, a trust `fail` stops the cycle; resume of unfinished cycles in `recoverWorker`. Tests: uniqueness, resume, crash-resume with a killed child process.
  5. `ads cycle --product X --kind daily --until trust_checked` (JSON summary) and its test.
  6. Plan updates (BLUEPRINT §4/§5.7/§5.8, D-075), preflight, code review, close.
- Cut first, if behind at ~300k: **nothing moves out of this milestone** (BLUEPRINT). If behind, the session stops with `WIP:` and the next session continues M04.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented (took ~210k with the session's fixed context: reading M02/M03's code and the schema)
  - [x] ~300k built, typecheck green (~400k incl. the session's fixed context; nothing cut)
  - [x] ~450k tests green, self-review done (code review at high effort: 10 findings, 9 fixed, 1 recorded below)
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. `core/cycle/runCycle(productId, kind)`: the stages are functions, `stage_reached` advances after each one, and the whole cycle is resumable.
  - notes: `core/src/cycle/runCycle.ts` (`STAGES`, `runCycle`, `resumeCycle`); a named advisory lock per cycle on its own connection (`db/queue/locks.ts`); `until` leaves it resumable; a failed trust check skips all but `reported`. Commit c06f970.
- [x] 2. Sync stage: for each active account, read into the repositories. Snapshots are stored only on change. Also sync search terms and click ids (Google).
  - notes: `core/src/sync/stage.ts` + `clients.ts` (shared with the dry run, now one loop). Trust signals stored in `accounts.trust_signals`; click ids from `accounts.clicks_synced_through` (re-read that day) to yesterday, at most 90 days back; known entities missing from a listing read by id (`EntityNotFoundError` → removed). Commits e057d08, cda92e1.
- [x] 3. Drift detection (§5.7). The platform is the truth; drift is surfaced, never overwritten.
  - notes: `core/src/sync/drift.ts`: status (Meta configured / Google `status`), daily budget, bid strategy, name; explained only by our change-log action setting that value (a Google budget and its campaigns count as one); stored with the snapshot in one transaction. Commit cda92e1.
- [x] 4. Trust checks (§5.8), including the `no_signal` result and `spend_cap_headroom` (from the account info synced in M02, D-063). A `fail` stops the cycle after the diagnostic report.
  - notes: `core/src/cycle/trust.ts`: database only (no API call on resume); `tracking_active` rule fixed for upload-only products (D-075). The diagnostic report itself is M07's `reported` stage. Commit ec031a7.
- [x] 5. `ads cycle --product X --kind daily --until trust_checked` prints a summary.
  - notes: `apps/worker/src/cli.ts` (JSON summary, counts only; exit 1 on an account error or a trust fail).
- [x] 6. Recovery: unfinished cycles resume from `stage_reached`.
  - notes: `resumeUnfinishedCycles` (closes cycles unfinished for over 24 h as abandoned; skips ones another process holds), called by `recoverWorker` when given the cycle deps. Commit c06f970.

## Tests
- [x] Drift, using pairs of fixtures. (`core/test/syncStage.test.ts`: v1 then an edited v2 of both platforms' listings, with two of our own changes in the change log.)
- [x] Trust-check tables, including low volume (`no_signal`, not `fail`). (`core/test/trust.test.ts`)
- [x] A timezone mismatch is a `fail`. (table and stage tests)
- [x] **Crash-resume:** kill the process after sync; the rerun resumes at the trust check and creates no duplicate snapshots. (`core/test/cycle.test.ts`, a SIGKILLed child process: `test/support/cycleChild.ts`)
- [x] Uniqueness of scheduled cycles. (two racing runs → one cycle; a rerun the same day is `already_finished`)

## Done when (cloud)
- [x] Tests are green, including crash-resume with a killed child process.
  - evidence: `pnpm vitest run packages/core/test/cycle.test.ts` → `crash-resume > a child process killed after the sync: the rerun resumes at the trust check, with no duplicate snapshots` ✓; full preflight below.

## Done when (live, run by Marcus)
- [ ] The daily cycle for `snappool` completes sync and trust check on two consecutive days on the SER9. A manual trigger is fine; scheduling arrives in M07.
  - result: —
- [ ] `docker compose restart` in the middle of a sync resumes the cycle.
  - result: —

### Live steps for Marcus
_After the M01a, M02 and M03 live steps (D-074: at the end of Phase 0). Doppler `dev`, Neon dev branch, read credentials only._
1. `git pull` on `main`, `pnpm install`, then `doppler run --config dev -- pnpm --filter @ads/db db:migrate`
   - expect: `migrations and roles.sql applied` (adds the accounts' sync columns, migration 0002).
2. Day 1: `time doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads cycle --product snappool --kind daily --until trust_checked`
   - expect: `"outcome": "finished"`, `"stageReached": "done"`, each account `"outcome": "synced"`, `"trustResult"` `ok` or `degraded`. `degraded` is expected while the Meta spending limit is unset or 80%+ used (`spend_cap_headroom` warns). `tracking_active` says `no_signal` until conversion uploads start in Phase 2 (D-075).
   - report back: the JSON (counts only, no names) and the time.
3. Day 2: the same command.
   - expect: a new cycle for the new date; `"snapshots"` small (only what changed), `"drift": 0` unless something was changed by hand. Optional: rename or pause a test campaign in Ads Manager between the two days, and see `"drift": 1` or more.
   - report back: the JSON.
4. Restart check, on the SER9 with the dev stack (`docker compose -p ads-agent-dev up -d --build`, with the dev worker's Doppler token): in one terminal `docker compose -p ads-agent-dev exec worker ads-entrypoint ads cycle --product snappool --kind daily`; while it syncs, in another `docker compose -p ads-agent-dev restart worker`.
   - expect: the worker's log shows `"msg":"unfinished cycles checked"` with the cycle `"outcome": "finished"`; then the command from step 2 prints `"outcome": "already_finished"`.
   - report back: those two lines.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **The cycle:** `core/src/cycle/runCycle.ts`. Add a stage by appending `{ stage, kinds, run }` to `STAGES` in order: `detected` (M06a), `analysed` and `drafted` (M06b/M08, weekly), `reported` (M07: the digest, the brief, and the **diagnostic brief**, the only stage that runs after a trust `fail`). A stage must be idempotent; `summary` carries what the CLI prints. `deps.stages` lets tests add stages.
- **For M07 (worker service):** schedule with `runCycle(deps, { productId, kind })` (unique per day; a rerun is `already_finished`). Fold `apps/worker/src/startup.ts` into `recoverWorker(db, ctx, { cycles })`, which already resumes cycles; pass the direct connection string as `lockUrl`. The `docker compose restart` live check (step 4) then still applies.
- **For M05a/M05b:** add `outcome_source_fresh`, `attribution_gap` and `id_capture` to `trustStage` (`core/src/cycle/trust.ts`) as pure check functions with table tests, like the others. `tracking_active` already counts uploads (`countFedBackSince`, D-075).
- **For M06a:** `search_terms.conversions` is 0: add the per-term KPI conversions (a `search_term_view` query segmented by `segments.conversion_action`, as `getMetricsDaily` does) before the `wasteful_search_term` detector. Drift events are in `drift_events` (`{"value": …}`), unacknowledged ones via `listUnacknowledgedDrift`.
- **For M11b (gateway):** drift detection reads `change_log` (`action.target`, `applied_at`): keep `applied_at` on the database clock. If the gateway stores snapshots from its read-backs, date them when read; an older read never replaces a newer snapshot.
- **Performance (code review, not fixed):** each entity costs several sequential queries (upsert with the account check, snapshot transaction). Fine for SnapPool's few dozen entities; batch the writes if an account passes ~500 entities or a sync nears a minute.

## Skills to create
- None listed.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Reads only; no package depends on a write connector (preflight grep empty). |
| 2 | No product logic in shared code | yes | Upload-only is read from the feedback routes, not a product name; the one product name in a core comment was removed. |
| 3 | AI calls through core/model | yes | No AI in M04. |
| 4 | The AI never supplies decision numbers | yes | Trust checks are deterministic code over SQL-stored data. |
| 5 | Untrusted text is data | yes | Names and search terms are stored as data and never printed in summaries (tested). |
| 6 | Money is bigint micros / decimal strings | yes | bigint in code, decimal strings in jsonb (`trust_signals`, drift values); the spending-limit percentage is computed in bigint. |
| 7 | Every write action has an undo and a test | yes | No write action added. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No guard or copy rule added. |
| 9 | Surfaces only record intent | yes | `ads cycle` runs the read-only cycle (like `ads sync --dry`); it changes no ad account and records no approval. |
| 10 | apps/web depends only on contracts + db | yes | Untouched. |
| 11 | product_id + an index on product-scoped tables | yes | No new table; `accounts` already has both. |
| 12 | No state outside Postgres | yes | Cycle state, locks (advisory) and sync state live in Postgres. |
| 13 | No secrets or personal data | yes | Keys made at run time in tests; no tokens in fixtures or output (preflight grep). |
| 14 | No production write capability outside the gateway | yes | The worker uses the read key only. |
| 15 | Cut items moved at most once | yes | Nothing cut. |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-075), GOTCHAS updated at close. |

## Evidence
- `pnpm vitest run packages/core/test/{cycle,syncStage,trust}.test.ts` → `Tests 26 passed (26)`, including `crash-resume > a child process killed after the sync: the rerun resumes at the trust check, with no duplicate snapshots`, `runCycle > scheduled cycles are unique per product, kind and day, even when two runs race`, `syncStage > records drift for changes made outside the system, but not for our own changes (fixture pairs)`, `trust-check tables > tracking_active: low volume is no_signal, not fail …`, `trust-check tables > timezone_match: a mismatch is a fail`.
- Full preflight after the review fixes: `pnpm typecheck` OK · `pnpm lint` OK · `pnpm check:boundaries` OK (no violations) · `pnpm test` → `Test Files 49 passed | 1 skipped`, `Tests 602 passed | 3 skipped` · `pnpm build` OK · `pnpm format:check` OK.
- The built worker with no secrets: `"msg":"ready"`, `"no DATABASE_URL or VAULT_READ_KEY: unfinished cycles are not resumed"`, SIGTERM → `"msg":"stopped"`.

## Notes and surprises
- 2026-10-06: **`tracking_active` as written would fail every SnapPool cycle until Phase 2.** SnapPool has no pixel or tag (D-060): its conversions reach Meta and Google only through the agent's uploads (M12/M13). Until then the platforms record zero conversions, so "clicks ≥ `minClicksToJudgeTracking` and zero conversions → `fail`" would stop every cycle with a diagnostic brief and block the Phase 0 gate. Fix (D-075, BLUEPRINT §5.8): when the KPI stage reaches a platform through a feedback route and the agent uploaded nothing to that platform in the 7 days, zero platform conversions say nothing about tracking, so the result is `no_signal`.
- 2026-10-06: the trust stage must work after a crash without calling the platforms again, so the sync stores what the checks need: the account's trust signals (`accounts.trust_signals`, with the Meta spending limit) and the last sync error (`accounts.last_sync_error`). Google click ids need a "synced through" day (`accounts.clicks_synced_through`), because a day without clicks leaves no row. Migration `0002` (D-075).
- 2026-10-06: **Code review (high, D-067): 10 findings.** Fixed: snapshots dated when read, so our change applied during a sync isn't drift; `--until` ignored on a rerun; manual cycles couldn't be continued and recovery would have run them on unasked; clock mix-up between `last_synced_at` and `cycles.started_at`; the uploads window not matching the signals' window; error classification by name (and a refused Meta token now stops the sync); a lost request count when Google's manager lookup fails; duplicated snapshot→entity mapping; `resumeCycle` abandoning without the lock. Not fixed: per-entity query count (performance only, fine at SnapPool's size; in Leave behind).
- 2026-10-06: the `docker compose restart` live check needs the worker to resume cycles when it starts, so `apps/worker/src/startup.ts` does that now (skipped without secrets); M07 folds it into `recoverWorker`.
