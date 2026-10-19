# F2 — Request processor and shared formatting

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
A request that keeps failing stops and tells Marcus, and money, dates and times look the same on every surface.

## Needs
- [x] F1 merged: PR [#22](https://github.com/marcustanforwork/agenticAdsManager/pull/22), merged 2026-10-19 on Marcus's word (CI green).

## Read first
- M10a's and M10b's milestone files ("Leave behind").
- BLUEPRINT §5.4 (operator requests).
- `packages/core/src/requests/processor.ts`; `packages/core/src/report/format.ts`, the worker's `telegram/cards.ts`, `apps/web/src/lib/review.ts`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order (each leaves the tree green; commit and push after each):
  1. Migration `0008`: `operator_requests.attempts` (int, default 0; the dashboard can't insert it) and, in the same file, the deferred `request_queued` trigger (item 3). One migration for the session.
  2. The processor counts faults: a fault (not a refusal) on a queued row adds 1 to `attempts` in its own transaction; at 5 the request is refused with its last error (cut to 500 characters) and a `request_failed` alert is queued (once per request). Both the drain and `processRequest` count. `submitRequest` (Telegram, CLIs) records and processes in one transaction, so a fault there rolls the row back and the caller sees the error, as now.
  3. The deferred trigger: a constraint trigger, `DEFERRABLE INITIALLY DEFERRED`, that at commit notifies only if the row is still `queued`.
  4. Formatters in `@ads/contracts` (`format.ts`): `formatMoney` by the currency's minor unit (a table of ISO 4217 exceptions; 2 otherwise), `formatUsdExact` for the AI cost, `localTime`, `stageWord` / `countOf`, `percentOf`, `costPer`. Core's `report/format.ts`, the detectors' money, the cards' `localTime` and the dashboard's `review.ts` use them; the copies go.
- Then: `preflight`, `code-review` at high effort, fixes, `close-milestone`, `end-session`, one PR.
- Cut first, if behind at ~300k: item 3 (the deferred trigger).
- Size ~300k: no checkpoint pressure expected.
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [x] 1. **A faulting request stops after 5 tries** (M10a review): `operator_requests.attempts` (migration); each fault (not a refusal) counts; at 5 the request is refused with its last error, and an alert goes to Marcus. Refusals stay final, as now.
  - done: migration `0008` (`attempts int not null default 0`; the dashboard's column grant leaves it out). `addRequestAttempt` (db); `recordRequestFault` + `MAX_REQUEST_ATTEMPTS = 5` (core processor): in its own transaction, +1 while queued; at 5, refused with "failed 5 times on our side; the last error: …" (500 characters, one line) and `attempts`, a `request_failed` alert (once per request, `raiseRequestFailedAlert` in `alerts.ts`), NOTIFY `request_done`. The drain and `processRequest` both count; `submitRequest` still rolls the row back on a fault. The bot's alert says "Nothing was changed…". Tests: `core/test/requests.test.ts` (5 faults by drain, by `processRequest`; a refusal costs no attempt), `apps/worker/test/cards.test.ts` (the alert's text), `db/test/roles.test.ts` (the dashboard can't set `attempts`).
- [ ] 2. **One set of display formatters in `@ads/contracts`** (M10b review): money in any currency by its minor unit (SGD cents, JPY whole yen), dates and local times, used by core's reports, the Telegram cards and the dashboard. The three copies go. (M14's budget unit for zero-decimal currencies can reuse the minor-unit table.)
- [x] 3. **The `request_queued` wake-up fires only for rows still queued at commit** (M10a review): a deferred trigger checks the status before notifying.
  - done: in migration `0008`: `operator_requests_queued` is now a constraint trigger, `DEFERRABLE INITIALLY DEFERRED`; its function notifies only if the row is still `queued`. Test: `db/test/web.test.ts` (recorded and processed in one transaction, and a rolled-back insert: no wake-up; a dashboard insert: one).

## Tests
- [x] A handler that throws 5 times: refused with its reason, an alert queued, never retried after; a refusal is still not retried.
- [ ] Formatter golden tests in SGD, JPY and USD; the three surfaces print the same text.
- [x] A request processed in the same transaction it was recorded in sends no wake-up (if item 3 is built).

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] Migration `0008` runs with the others; nothing else is visible.
  - result: —

### Live steps for Marcus
None of its own (D-092). Migration `0008` runs with the others (M10a's step 1 and M07's step 3 migrate dev and prod).

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
- 2026-10-19: PR #22 (F1) merged on Marcus's word at the start of this session; the branch was reset onto the new `main`.
