# F4 — CI, the SnapPool connection, purchases, an AI cost limit

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance (merged 2026-11-03; live step: the purchases grant, then M01a on) |
| **Phase** | fix (runs before M01a's live steps, D-097) |
| **Started** | 2026-11-03 |
| **Finished** | 2026-11-03 (built; live step: the purchases grant) |
| **PRs** | [#25](https://github.com/marcustanforwork/agenticAdsManager/pull/25) (squash-merged on Marcus's word, 2026-11-03, CI green) |

## Goal
CI is green again; SnapPool's database can be read from the SER9 every time; SnapPool's purchases reach the agent as outcomes; the agent stops its own AI spending at a monthly limit.

## Needs
- [x] M00's live steps: passed 2026-11-03.
- [x] Runs before M01a's live steps (D-097): nothing seeded yet.
- [x] D-096 (purchases) and D-097 (this session) adopted by Marcus, 2026-11-03.
- External facts:
  - Node 24.21.0 (the repo's `.nvmrc`), checked at runtime on the SER9 2026-11-03: `net.getDefaultAutoSelectFamily()` is `true`, `net.getDefaultAutoSelectFamilyAttemptTimeout()` is `250`; `net.setDefaultAutoSelectFamilyAttemptTimeout(2000)` takes effect; a value under 10 is clamped to 10 (no error); `--network-family-autoselection-attempt-timeout=1000` sets it from the command line.
  - SnapPool's schema, read from SnapPool `origin/main` `2e0c8a2` (2026-11-03), `lib/db/schema.ts`: see Notes.

## Read first
- D-096, D-097; `SNAPPOOL-TRACKING.md` v1.3 §2–§2.1; the SnapPool pack (`packages/packs/saas-snappool`); `packages/core/src/outcomes/sync.ts`; `packages/core/src/report/brief.ts`; the failing CI run on PR #25.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Branch: continue `claude/elegant-goodall-ursfd8` (PR #25), as F1–F3 did; PR #25 is retitled for F4.
- Build order (each leaves the tree green; commit and push after each):
  1. Tests that don't depend on today's date (item 1), then item 5 (`engines`, one line).
  2. SnapPool's connection timeout (item 2).
  3. Purchases (item 3): the contract (a stage's `role`: `paying` or `refund`), the manifest, the adapter and its fixture database, the grant SQL; then the brief's figures; then the dashboard's Overview.
  4. The AI cost soft limit (item 4).
- Cut first, if behind at ~300k: item 4 (to a later fix session), then the dashboard figures (keep the brief's).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green (items 1, 2, 3, 5; item 4 cut here, as planned)
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. **Tests that don't depend on today's date.** Since about 2026-10-24 every branch fails: fixtures with fixed October dates meet the real clock (`RefusedError: proposal … has expired` in `apps/web/test/support/world.ts`, which fails all of `views.test.ts`; three tests in `packages/rehearsal`). Find every place a test mixes a fixed date with the real clock (including the database's `now()`) and fix the test, or the code if the code mixes clocks.
  - notes: commit `65a2447`. The cause was the code as much as the tests: proposals and decisions took the database's time while the cycle ran on its injected clock, the request handlers and the Telegram outbox checked expiry on the real clock, and drift was stamped by the database but compared with the cycle's start. Now each takes the caller's clock (Leave behind). `scripts/test-clock.ts` (+ its test) and a second CI test step a year ahead. Tests that compare with database-stamped times read `databaseNow()`; the draft tests lost their `keepOpen` workaround; the cards test runs the processor on the bot's clock. Checked locally at 0, +365 and −30 days: green at 0 and +365; −30 (the clock behind the database) still shows 3 test-only mixes, not a CI condition (Notes).
- [x] 2. **SnapPool's connection:** `net.setDefaultAutoSelectFamilyAttemptTimeout` raised (e.g. 2 s) at the start of the worker and the CLI, with a test, and a GOTCHAS entry (SnapPool's Neon is in us-east-1, the SER9 has no IPv6, and Node's 250 ms per-address attempt cuts the IPv4 try short; SnapPool's own repo hit the same).
  - notes: commit `7a89e99`. `apps/worker/src/network.ts` `raiseConnectAttemptTimeout()` (at least 2 s; a longer command-line value kept), called first in `main.ts` and the CLI; `apps/worker/test/network.test.ts`; GOTCHAS updated.
- [x] 3. **SnapPool purchases** (D-096):
  - the adapter reads `card_saved`, `paid` (a host's first paid, live order, with its value and currency) and `refunded`, and takes the click from the order, else the `/start` request its onboarding charge or subscription points to, else the host's latest attributed `/start`; test emails and the superadmin are test traffic, as now;
  - the manifest: the two new stages, `paid`'s label and the analyst context and phase intents brought up to date (no more "no checkout"); `primaryKpiStage` stays `signup`;
  - the column-level `grant` Marcus runs on SnapPool's database (live step), and the adapter's fixture database gains the tables, columns only;
  - the brief and the dashboard's Overview show paying customers, revenue and cost per paying customer beside the KPI (for a pack whose stages include one marked as the paying stage; no product name in core);
  - `SNAPPOOL-TRACKING.md` §2.1 checked against what was built.
  - notes: commits `06d4932` (contract `OutcomeStage.role`, manifest, adapter, `grant.ts`, fixture tables, settings form), `72fa50f` (`payingSummary`, `outcomeValueTotals`, the brief's Numbers lines, the Overview line), the docs commit (SNAPPOOL-TRACKING v1.4, BLUEPRINT §3). The adapter is one SQL statement: a `first_paid` CTE (`distinct on (host_id)` over all live paid orders with an amount), a `purchases` CTE (saved cards, first orders, counted refunds), then the click: the order's, else the linked `/start` request's, else the host's latest claimed one with a click before the purchase (a lateral join). Values are micros by the currency's minor unit. A missing grant fails the read with a hint.
- [ ] 4. **CUT → a later fix session (F5)**, as planned at the ~300k checkpoint. **AI cost soft limit** (cut first; moves to a later fix session): a setting with a default of US$20 a month; before each AI stage, the month's `cycles.model_cost_micros` is summed; at the limit the stage is skipped, one alert goes to Marcus, and the brief and digest say "AI paused: monthly limit".
- [x] 5. `"engines": {"node": "24.x"}` in `apps/web/package.json` (Vercel reads the root directory's manifest; its first build ran on Node 26).
  - notes: commit `65a2447`.

## Tests
- [x] CI green with the clock moved a year ahead (a second CI test step, `TEST_CLOCK_OFFSET_DAYS: '365'`).
- [x] The adapter on the fixture database: each payment path credited to the right click, the first order only, renewals and free grants left out, test mode left out, a refund as its own outcome (`packages/packs/saas-snappool/test/adapter.test.ts`, "purchases"; also run as a role with exactly the grant).
- [x] The brief's new figures checked like its others (`packages/core/test/report.test.ts`: the number check holds them; an invented sum is refused).
- [ ] The cost limit at, below and above: cut with item 4.

## Done when (cloud)
- [x] CI green on the PR; the adapter tests and the rehearsal green (evidence below).

## Done when (live, run by Marcus)
- [ ] After Marcus's grant, `ads outcomes --product snappool` reads `card_saved` and `paid` without error (counts may be 0 until 2027-01-01); M04's and M05a's SnapPool reads succeed every time.

### Live steps for Marcus
After this PR merges, **before M01a's live steps** (D-097):
1. `git pull` on `main`, then `pnpm install` (run `nvm use` in the repo folder first, GOTCHAS).
2. **The purchases grant** on SnapPool's **production** branch: Neon console → SnapPool's project → SQL editor, as the owner. Paste exactly:
   ```sql
   grant select (id, host_id, currency, amount_minor, livemode, paid_at, attribution, subscription_id, deferred_charge_id) on orders to ads_agent_ro;
   grant select (id, order_id, status, currency, amount_minor, created_at) on refunds to ads_agent_ro;
   grant select (id, host_id, pool_request_id, livemode, saved_at) on deferred_event_charges to ads_agent_ro;
   grant select (id, host_id, pool_request_id, livemode, status, created_at) on billing_subscriptions to ads_agent_ro;
   ```
   Then check it:
   ```sql
   select table_name, count(*) from information_schema.column_privileges
    where grantee = 'ads_agent_ro' and table_name in ('orders', 'refunds', 'deferred_event_charges', 'billing_subscriptions')
    group by table_name order by table_name;
   ```
   - expect: `billing_subscriptions 6`, `deferred_event_charges 5`, `orders 9`, `refunds 6`.
   - report back: "grant applied" and the four counts.
3. Then the live steps from M01a on, as listed in `NOW.md`. SnapPool reads no longer need the `NODE_OPTIONS=…` prefix. At M05a's step 4 (`ads outcomes --product snappool`):
   - expect: `"read": {"outcome": "read", …}`, and `card_saved`, `paid` and `refunded` among the stages (counts may be 0 until 2027-01-01). Without the grant the read fails with "permission denied … run the purchases grant".
   - report back: the JSON (counts only), as M05a asks.
4. M04's and M05a's SnapPool reads: each run reads without `ETIMEDOUT`. Report any timeout.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| 4. AI cost soft limit (and its test) | a later fix session (F5) | cut first at the ~300k checkpoint, as BLUEPRINT and D-097 planned: building it with the review and close would have run near the 600k hard stop. Marcus's Anthropic limit (US$100 a month) stays the hard stop; Phase 0 cycles on Opus 5.5 cost cents each. | 2026-11-03 |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **One clock per comparison.** Code takes the clock it is given (`deps.now`, `ctx.now`) for times it stamps and compares: proposals' `created_at` / `updated_at` (`createProposal({ now })`), decisions' `decided_at` (`recordDecision(…, now)`), drift's `detected_at` (the snapshot's time), the request handlers (`HandlerContext.now`, given by the worker and the CLI), the outbox's cards. Times the database stamps itself (`now()`: the queue's `run_at` check, the change log, snapshots) are compared only with database times. Tests that compare with a database-stamped time read `databaseNow()` (`@ads/db/testing`). CI runs the suite a year ahead too (`TEST_CLOCK_OFFSET_DAYS=365`, `scripts/test-clock.ts`); a test that fails only there mixes a fixed date with the real clock.
- **A stage's `role`** (`paying` / `refund`, at most one each; BLUEPRINT §3): the reports show paying customers, revenue per currency, the spend per paying customer and refunds for a pack that marks one (`payingSummary` in contracts, `outcomeValueTotals` in db). Revenue is never added across currencies. M12/M13 upload `paid` with its value (`Purchase` on Meta, D-096) once SnapPool's privacy page says so.
- **SnapPool's purchase columns are a contract** (`packages/packs/saas-snappool/src/grant.ts`): a new column in the adapter's SQL needs the grant changed and Marcus to run it again; the adapter's tests run as a role with exactly that grant, so they fail first.
- **`card_saved` for an onboarding subscription** uses its `created_at`: SnapPool keeps no time its card was saved. If SnapPool adds one, switch to it.
- **F5 (a later fix session):** the AI cost soft limit (item 4, as written above), and its test at, below and above the limit. Also: the Phase 0 checklist artifact's grant step (D-096).

## Skills to create
- None.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Nothing writes to an ad account; no `connector-*-write` import added. |
| 2 | No product logic in shared code | yes | Core, db and contracts know a stage only by its `role`; SnapPool's tables and rules live in its pack. |
| 3 | AI calls through core/model | yes | No AI call added. |
| 4 | The AI never supplies decision numbers | yes | The paying figures come from SQL (`outcomeValueTotals`) and pure arithmetic; the brief's number check holds them. |
| 5 | Untrusted text is data | yes | The order's `attribution` goes through `idsFromAttribution` like the requests'; nothing is interpreted. |
| 6 | Money is bigint micros / decimal strings | yes | `amount_minor` × the minor unit → micros (bigint) → a decimal string in JSON; revenue per currency, never added across. |
| 7 | Every write action has an undo and a test | yes | No write action added. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No guard or copy rule changed. |
| 9 | Surfaces only record intent | yes | The dashboard form records a settings patch; the processor validates the role (at most one each). |
| 10 | apps/web depends only on contracts + db | yes | `payingSummary` (contracts) and `outcomeValueTotals` (db, through the dashboard's view); `pnpm check:boundaries` green. |
| 11 | product_id + an index on product-scoped tables | yes | No table added. |
| 12 | No state outside Postgres | yes | The clock offset is a test-only environment variable. |
| 13 | No secrets or personal data | yes | Fixture emails are made up; the test role's password is random per run; raw emails never leave the adapter (scanned in the tests). |
| 14 | No production write capability outside the gateway | yes | The grant is select on columns only. |
| 15 | Cut items moved at most once | yes | Item 4 moves once, to F5. |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-099), GOTCHAS, this file. |

## Evidence
- CI on the branch, run [41578396623](https://github.com/marcustanforwork/agenticAdsManager/actions/runs/41578396623) (commit `7a89e99`, items 1, 2, 5): every step green, including `Test` and `Test, with the clock a year ahead`; the first green CI since 2026-10-20. The final run on the PR's last commit is linked in the PR.
- Local, on the SER9 with a throwaway `postgres:16` (2026-11-03, after the purchases commits):
  - `TEST_CLOCK_OFFSET_DAYS=0 pnpm test` → `Test Files 95 passed | 1 skipped (96)`, `Tests 1123 passed | 3 skipped (1126)`
  - `TEST_CLOCK_OFFSET_DAYS=365 pnpm test` → the same
  - `pnpm typecheck` (18 tasks), `pnpm lint`, `pnpm check:boundaries` (no violations), `pnpm format:check`: all green.
  - The adapter's tests (24) include the read as a role with exactly the purchases grant; the rehearsal (`packages/rehearsal`) is green with the new stages seeded.

## Notes and surprises
- 2026-11-03: reproduced on the SER9 with a throwaway `postgres:16`: 3 failed tests in `packages/rehearsal` and `apps/web/test/views.test.ts` (the whole file), as in CI.
- 2026-11-03, code review (D-067; a `code-reviewer` agent over the whole diff, not anchored on my reading): no confirmed bugs. Two notes, both kept as built and documented in SNAPPOOL-TRACKING §2.1: a checkout order's browser fields come from the host's latest claimed `/start` request with a click (same person, maybe another visit; Meta needs them for a website event); `card_saved` counts saved cards, not customers (SnapPool allows one saved choice per `/start` request). Its question on `expireDue`: both callers pass the injected clock.
- 2026-11-03: with the test clock 30 days **behind** the database's, 3 tests still fail (`dashboard.test.ts` AI cost since a time, `queue.test.ts` not-due jobs, `commands.test.ts` a confirmed pause after 30 minutes): each compares a database-stamped time with the test process's clock. A real clock is never far behind the database's, so CI runs only the year-ahead case.
- 2026-11-03, SnapPool's schema (`origin/main` `2e0c8a2`): `orders` (`kind` one of `event_plan`, `event_extend`, `event_reactivate`, `event_keepsake`, `subscription_term`, `subscription_renewal`, `subscription_change`; `status` one of `pending`, `paid`, `fulfilled`, `expired`, `failed`, `canceled`, `needs_attention`, `refunded`; `paid_at` set when the money arrives; a comp is written `fulfilled` with no `paid_at` and amount 0); `refunds.status` is the provider's, and SnapPool counts every refund whose status isn't `failed`, `canceled` or `cancelled`; `deferred_event_charges.saved_at` is set when the card is saved (status `scheduled`); `billing_subscriptions` has **no** saved time: an onboarding subscription (`pool_request_id` set) goes from `awaiting_card` to `scheduled` when its card is saved, and `started_at` is set only at its first charge, so `card_saved` uses its `created_at` (the plan chosen at `/start`, minutes before the save) for a row whose card was saved (status not `awaiting_card` or `abandoned`).
