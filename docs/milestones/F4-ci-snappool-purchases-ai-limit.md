# F4 — CI, the SnapPool connection, purchases, an AI cost limit

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | fix (runs before M01a's live steps, D-097) |
| **Started** | 2026-11-03 |
| **Finished** | — |
| **PRs** | [#25](https://github.com/marcustanforwork/agenticAdsManager/pull/25) (continued: its plan changes are F4's inputs, and it can't merge until F4 makes CI green) |

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
  - [ ] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. **Tests that don't depend on today's date.** Since about 2026-10-24 every branch fails: fixtures with fixed October dates meet the real clock (`RefusedError: proposal … has expired` in `apps/web/test/support/world.ts`, which fails all of `views.test.ts`; three tests in `packages/rehearsal`). Find every place a test mixes a fixed date with the real clock (including the database's `now()`) and fix the test, or the code if the code mixes clocks.
- [ ] 2. **SnapPool's connection:** `net.setDefaultAutoSelectFamilyAttemptTimeout` raised (e.g. 2 s) at the start of the worker and the CLI, with a test, and a GOTCHAS entry (SnapPool's Neon is in us-east-1, the SER9 has no IPv6, and Node's 250 ms per-address attempt cuts the IPv4 try short; SnapPool's own repo hit the same).
- [ ] 3. **SnapPool purchases** (D-096):
  - the adapter reads `card_saved`, `paid` (a host's first paid, live order, with its value and currency) and `refunded`, and takes the click from the order, else the `/start` request its onboarding charge or subscription points to, else the host's latest attributed `/start`; test emails and the superadmin are test traffic, as now;
  - the manifest: the two new stages, `paid`'s label and the analyst context and phase intents brought up to date (no more "no checkout"); `primaryKpiStage` stays `signup`;
  - the column-level `grant` Marcus runs on SnapPool's database (live step), and the adapter's fixture database gains the tables, columns only;
  - the brief and the dashboard's Overview show paying customers, revenue and cost per paying customer beside the KPI (for a pack whose stages include one marked as the paying stage; no product name in core);
  - `SNAPPOOL-TRACKING.md` §2.1 checked against what was built.
- [ ] 4. **AI cost soft limit** (cut first; moves to a later fix session): a setting with a default of US$20 a month; before each AI stage, the month's `cycles.model_cost_micros` is summed; at the limit the stage is skipped, one alert goes to Marcus, and the brief and digest say "AI paused: monthly limit".
- [ ] 5. `"engines": {"node": "24.x"}` in `apps/web/package.json` (Vercel reads the root directory's manifest; its first build ran on Node 26).

## Tests
- [ ] CI green with the clock moved a year ahead.
- [ ] The adapter on the fixture database: each payment path credited to the right click, the first order only, renewals and free grants left out, test mode left out, a refund as its own outcome.
- [ ] The brief's new figures checked like its others.
- [ ] The cost limit at, below and above.

## Done when (cloud)
- [ ] CI green on the PR; the adapter tests and the rehearsal green.

## Done when (live, run by Marcus)
- [ ] After Marcus's grant, `ads outcomes --product snappool` reads `card_saved` and `paid` without error (counts may be 0 until 2027-01-01); M04's and M05a's SnapPool reads succeed every time.

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
- 2026-11-03: reproduced on the SER9 with a throwaway `postgres:16`: 3 failed tests in `packages/rehearsal` and `apps/web/test/views.test.ts` (the whole file), as in CI.
- 2026-11-03, SnapPool's schema (`origin/main` `2e0c8a2`): `orders` (`kind` one of `event_plan`, `event_extend`, `event_reactivate`, `event_keepsake`, `subscription_term`, `subscription_renewal`, `subscription_change`; `status` one of `pending`, `paid`, `fulfilled`, `expired`, `failed`, `canceled`, `needs_attention`, `refunded`; `paid_at` set when the money arrives; a comp is written `fulfilled` with no `paid_at` and amount 0); `refunds.status` is the provider's, and SnapPool counts every refund whose status isn't `failed`, `canceled` or `cancelled`; `deferred_event_charges.saved_at` is set when the card is saved (status `scheduled`); `billing_subscriptions` has **no** saved time: an onboarding subscription (`pool_request_id` set) goes from `awaiting_card` to `scheduled` when its card is saved, and `started_at` is set only at its first charge, so `card_saved` uses its `created_at` (the plan chosen at `/start`, minutes before the save) for a row whose card was saved (status not `awaiting_card` or `abandoned`).
