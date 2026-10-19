# F2 — Request processor and shared formatting

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | built; awaiting Marcus's merge (no live steps of its own) |
| **Phase** | fix (runs before the Phase 0 gate, D-092) |
| **Started** | 2026-10-19 |
| **Finished** | — |
| **PRs** | [#23](https://github.com/marcustanforwork/agenticAdsManager/pull/23) |

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
  - [x] ~300k built, typecheck green (at ~170k)
  - [x] ~450k tests green, self-review done (at ~230k)
  - [x] ~550k committed, pushed, handed off (closed at ~250k)

## Builds
- [x] 1. **A faulting request stops after 5 tries** (M10a review): `operator_requests.attempts` (migration); each fault (not a refusal) counts; at 5 the request is refused with its last error, and an alert goes to Marcus. Refusals stay final, as now.
  - done: migration `0008` (`attempts int not null default 0`, `retry_after timestamptz`; the dashboard's column grant leaves both out). `addRequestAttempt` (db): +1 while queued, and holds the request back 1 min × 2^(n−1) after the n-th fault (as the job queue does), so a short outage doesn't use up its tries; the drain skips it until then. `recordRequestFault` + `MAX_REQUEST_ATTEMPTS = 5` (core processor): in its own transaction; at 5, refused with "failed 5 times on our side; the last error: …" (the innermost cause's message, 300 characters, one line: drizzle's own message is the query and its parameters, never stored) and `attempts`, a `request_failed` alert (once per request, `raiseRequestFailedAlert` in `alerts.ts`), NOTIFY `request_done`. Only the drain counts (`processRequest` throws a fault uncounted); `submitRequest` still rolls the row back on a fault. About 15 minutes pass between the first fault and the refusal. The bot's alert says "Nothing was changed…". Tests: `core/test/requests.test.ts` (5 faults with their backoff; a database error stored as Postgres's words; `processRequest` doesn't count; a refusal costs no attempt), `apps/worker/test/cards.test.ts` (the alert's text), `db/test/roles.test.ts` (the dashboard can't set `attempts`).
- [x] 2. **One set of display formatters in `@ads/contracts`** (M10b review): money in any currency by its minor unit (SGD cents, JPY whole yen), dates and local times, used by core's reports, the Telegram cards and the dashboard. The three copies go. (M14's budget unit for zero-decimal currencies can reuse the minor-unit table.)
  - done: `contracts/src/format.ts`: `minorDigits` / `microsPerMinorUnit` (an explicit ISO 4217 table; 2 otherwise), `moneyPrefix`, `formatMoney` (half away from zero to the minor unit; "S$1,234.57", "JPY 1,235", "USD 12.30"; a negative starts with "-", so "-MYR 12.50", where the dashboard printed "MYR -12.50"), `formatSgd` (moved from `money.ts`, now `formatMoney` in SGD), `formatUsdExact` (the AI cost), `percentOf`, `costPer`, `stageWord`, `countOf`; `localTime` in `dates.ts`. Users: core's digest, brief and template words, the detectors (their own `money` and `plural` helpers went; "Cost per <stage>" uses `stageWord`, so a `paid` KPI reads "Cost per paid outcome"), the Telegram cards, views and commands, and the dashboard (Overview, Proposals, Changes, Checks, Briefs, Docs; history and facts now show local times and dates; the request page shows its product's timezone (UTC for a global request), named; the settings form's currency label is `moneyPrefix`). Copies removed: core `report/format.ts` (keeps `plainText`), the cards' `localTime`, the dashboard's `formatMoney` / `formatUsd` / `microsDecimal` / `percentOf` / `costPer` / `countOf` / `localTime`. Tests: `contracts/test/format.test.ts` (golden SGD, JPY, USD, KWD; a property test), and the same JPY text on each surface: `report.test.ts` (template words), `cards.test.ts` (a JPY budget card), `apps/web/test/review.test.ts` (`describeAction` in JPY).
- [x] 3. **The `request_queued` wake-up fires only for rows still queued at commit** (M10a review): a deferred trigger checks the status before notifying.
  - done: in migration `0008`: `operator_requests_queued` is now a constraint trigger, `DEFERRABLE INITIALLY DEFERRED`; its function notifies only if the row is still `queued`. Test: `db/test/web.test.ts` (recorded and processed in one transaction, and a rolled-back insert: no wake-up; a dashboard insert: one).

## Tests
- [x] A handler that throws 5 times: refused with its reason, an alert queued, never retried after; a refusal is still not retried.
- [x] Formatter golden tests in SGD, JPY and USD; the three surfaces print the same text.
- [x] A request processed in the same transaction it was recorded in sends no wake-up (if item 3 is built).

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check` → exit 0; 1,089 tests passed (3 skipped, as before F2). See Evidence.

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
- **Money for the AI is still cents:** `core/src/analyst/refs.ts` `microsToDecimal` gives the analyst and the drafter amounts with two decimals whatever the currency (both products are SGD). A JPY product would show the AI "1234.50" yen. Move it onto `microsPerMinorUnit` when a non-SGD product arrives (it needs the currency passed in; the number check would follow).
- **The brief's AI cost line** prints `US$` + the stored `modelCostUsd` (rounded to cents); the dashboard's Checks screen shows the exact cost (`formatUsdExact`). Both are right; they differ below a cent.
- **M14** can take its zero-decimal budget unit from `microsPerMinorUnit` (contracts), as the plan says.

## Skills to create
- None.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | no write connector touched |
| 2 | No product logic in shared code | yes | the format tables name currencies, not products; the preflight grep hits only older test fixtures |
| 3 | AI calls through core/model | yes | no AI call added |
| 4 | The AI never supplies decision numbers | yes | only display text changed; numbers still come from SQL |
| 5 | Untrusted text is data | yes | a fault's message reaches Telegram escaped (`genericLines`), as data |
| 6 | Money is bigint micros / decimal strings | yes | `formatMoney` works in bigint micros; display only |
| 7 | Every write action has an undo and a test | yes | no write action added |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | no guard changed; a property test covers `formatMoney` |
| 9 | Surfaces only record intent | yes | the dashboard still only inserts; `attempts` and `retry_after` aren't in its column grant (roles test) |
| 10 | apps/web depends only on contracts + db | yes | `pnpm check:boundaries` green; the web imports `@ads/contracts` only |
| 11 | product_id + an index on product-scoped tables | yes | no new table; `operator_requests` keeps its indexes |
| 12 | No state outside Postgres | yes | the per-timezone `Intl.DateTimeFormat` cache is a pure memo, not state |
| 13 | No secrets or personal data | yes | a stored fault is the innermost cause, never drizzle's query and parameters |
| 14 | No production write capability outside the gateway | yes | nothing near the gateway |
| 15 | Cut items moved at most once | yes | nothing cut |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-094), GOTCHAS and BLUEPRINT updated |

## Evidence
- 2026-10-19, after the review fixes (commit `687f3db`): `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check` → exit 0; `Test Files 90 passed | 1 skipped (91)`, `Tests 1089 passed | 3 skipped (1092)`. `pnpm --filter @ads/db db:generate` → "No schema changes".
- Preflight greps: invariant 1, 6 and 13 clean; invariant 2 hits only older test fixtures.

## Code review (high effort, 2026-10-19): 9 findings
- **Fixed (8):**
  - a fault's stored reason and alert used drizzle's message (the query and its parameters); now the innermost cause's;
  - every fault counted at once, so a short outage could use up the 5 tries in seconds; now a backoff (`retry_after`);
  - the Overview heading said "Cost per paid"; it uses `stageWord`;
  - hand-written plurals in the brief, digest, Telegram views and pause card, and the Checks screen now use `countOf`;
  - `processRequest` counted faults on a second path only tests used; only the drain counts now;
  - `localTime` built a new formatter on every call; one per timezone now;
  - the request page showed UTC; it shows the product's timezone;
  - `moneyPrefix` was case-sensitive; codes are upper-cased.
- **Not fixed (1):** the detectors' `kpiName` stays: it names the KPI as an adjective ("no paid conversions"), where `stageWord`'s noun rule would read "paid outcome conversions".

## Notes and surprises
- 2026-10-19: PR #22 (F1) merged on Marcus's word at the start of this session; the branch was reset onto the new `main`.
