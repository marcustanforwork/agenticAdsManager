# M02 — Meta read connector

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-10-02 |
| **Finished** | — |
| **PRs** | — |

## Goal
Typed, deterministic Meta reads for everything the cycle needs.

## Needs
- [ ] T4 read side (Meta app, system-user read token, the dataset): **not done yet.** Needed only for live recording and acceptance. The cloud work builds against Meta's documented response shapes with hand-written fixtures (BLUEPRINT "How the work runs").
- [x] M01b: merged (PR #5). The vault's `get` returns unvalidated JSON; this connector validates it.
- [ ] M01a / M00 live steps: not done yet (Marcus). They don't block M02's cloud work.

## Read first
- BLUEPRINT §3.5–3.6 and §5.7; §3.1 (money); M01b "Leave behind" (vault).
- External: Graph version, insights fields, rate-limit headers, access tier (checked 2026-10-02, GOTCHAS).

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 3 money (already in contracts; add the Meta-specific helpers and property tests) → 4 `connector-testing` (replayer first, then recorder and redaction) → 1 Graph client → 2 read methods → 5 `ads sync --dry`. Each step leaves the tree green and is committed and pushed.
- Cut first, if behind at ~300k: ad-level snapshots (keep campaign and ad set).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. Graph client: typed fetch, pagination, `appsecret_proof`, and back-off driven by the rate-limit headers. The API version is pinned in one constant.
- [ ] 2. Read methods:
  - `getAccountInfo` (timezone, currency, spending limit and the amount spent against it: `spend_cap` / `amount_spent`, verify the field names);
  - `listEntities` for campaigns, ad sets and ads, with status normalisation;
  - `getMetricsDaily` at campaign, ad set and ad level, recording the attribution settings;
  - `snapshot`;
  - `trustSignals` (dataset events received in the last 7 days).
- [ ] 3. Exact money conversion (§3.1).
- [ ] 4. `packages/connector-testing`:
  - `RECORD=1` writes responses to `fixtures/meta/*.json`;
  - redaction removes tokens, `appsecret_proof`, and any names or emails;
  - a replayer serves the fixtures in tests.
- [ ] 5. `ads sync --product snappool --platform meta --dry` prints what would be stored.

## Tests
- [ ] Replay tests for every method.
- [ ] Pagination.
- [ ] Rate-limit back-off.
- [ ] Restatement: a later fixture changes an earlier day.
- [ ] Money-conversion property tests.
- [ ] **Redaction:** no token pattern appears in any fixture file.

## Done when (cloud)
- [ ] All replay tests are green.

## Done when (live, run by Marcus)
- [ ] Real fixtures are recorded and committed.
- [ ] `ads sync --dry` against SnapPool's Meta account finishes in under 60 s.
- [ ] A linked property Meta account either syncs or is marked `paused`.

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- The Graph API version and its upgrade date; the ad set ↔ `ad_group` mapping; the confirmed status table.

## Skills to create
- `record-fixture`.

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

## Notes and surprises
- 2026-10-02: Marcus confirmed M01b is complete; the M00 and M01a live-step checklists stay unticked (he hasn't run them).
- 2026-10-02: Graph API **v26.0** is current (released 2026-07-29). Its breaking changes apply to **every** version from 2026-10-27: a request carrying `date_format` errors, and root `GET /?ids=` errors. The client never sends either. Details in GOTCHAS.
