# M05a — Pack SDK, SnapPool pack, settings

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-10-06 |
| **Finished** | — |
| **PRs** | — |

## Goal
The first real pack loads through the registry, SnapPool's outcomes flow in, and settings are one validated document.

## Needs
- [ ] A read-only SnapPool connection string (T6a): **not set up yet**. Under D-074 it waits for the end of Phase 0. The adapter is built and tested against a local Postgres fixture with SnapPool's real table shapes (read from the SnapPool repo, `origin/main` `34d3473`, 2026-10-06).
- [x] The SnapPool facts: `SNAPPOOL-TRACKING.md` §1–2, re-checked against SnapPool's repo on 2026-10-06 (below).
- [x] **SnapPool's tracking change (T6b) is live on production since 2026-09-25 17:01 UTC** (SnapPool Session 41, its PR #108; SnapPool's `memory/MEMORY.md`, 0e). `pool_requests` has `attribution` (jsonb), `user_agent` and `page_url` (SnapPool migration `0032`). Still owed on SnapPool's side: one real `/start` on production that shows all three columns filled (Marcus), and T14 (the ad URL settings), without which only Meta's `fbclid` arrives.
- [x] M04: merged (PR #8). Its "Leave behind": add `outcome_source_fresh` to `trustStage` as a pure check with table tests.
- [x] M01b: merged (PR #5). Its "Leave behind": add the pack's guard overrides as a layer in `checkGuardOverridesTightenOnly`; `facts_put` is listed for M05a in `NOT_AVAILABLE_UNTIL`.

## Read first
- BLUEPRINT §3.3–3.5 (settings, packs, outcomes), §5.4 (one validator), §5.8 (`outcome_source_fresh`), §5.16 (alerts go through `notifications`), §5.18 (personal data).
- `docs/plan/SNAPPOOL-TRACKING.md` §1, §2 and §4; PROPOSAL §4 and §8; DECISIONS D-012, D-013, D-059, D-060, D-064.
- SnapPool's repo (`origin/main` `34d3473`): `lib/db/schema.ts` (`hosts`, `events`, `pool_requests`), `lib/pool-start-attribution.ts` (the stored `attribution` shape), `lib/ad-click.ts`, `lib/pool-policy.ts` (`POOL_REQUEST_TTL_DAYS = 30`, statuses `pending`/`claimed`), `memory/MEMORY.md`.
- External facts checked 2026-10-06 (GOTCHAS): Meta CAPI `em` = SHA-256 of the trimmed, lower-cased email; Google Data Manager also removes all whitespace and, for `gmail.com`/`googlemail.com`, the dots before the `@`; zod 4.6.5 `z.toJSONSchema` (draft 2020-12).

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order, each step green, committed and pushed:
  1. Contracts: `FeedbackRoute.destinationId` may be `null` until the destination is set up (T4/T11); `HashedContact.emailSha256Google`; the read configs skip routes without a destination. (D-076)
  2. `pack-sdk`: `definePack`, the registry, the threshold engine, the manifest document (fact schema as JSON Schema). Tests: looser guard and unknown finding type rejected, monotonic thresholds (property test), JSON Schema vs zod samples (ajv).
  3. `packs/saas-snappool`: the manifest (defaults, phases, facts, thresholds, `analystContext`) and the runtime (`detectPhase`, the SnapPool adapter on `pg`). Fixture tests on a local Postgres copy of SnapPool's tables, `healthcheck`, the raw-email scan, `isTest`.
  4. Database: migration `0003` (`outcomes.web`, `products.outcome_source`); outcomes upsert (new rows inserted, `is_test` refreshed), counts by stage; a typed error for invalid stored settings.
  5. Core: `core/settings` (pack defaults, pack-aware validation, `settings_patch` with the pack layer, `facts_put`, seeding), `core/outcomes` (the outcome read inside the sync stage, its state stored), `outcome_source_fresh`, and a bad stored settings value stopping the cycle with an alert.
  6. Worker: the pack registry, `ads settings get|set|history`, `ads outcomes`, `ads seed` (replaces `db:seed`), manifests published at startup.
  7. Plan updates (D-076, BLUEPRINT, live steps), preflight, code review, close.
- Cut first, if behind at ~300k: the manifest publisher (moves to M05b, as BLUEPRINT says); then `facts_put` (moves to M05b).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented (~250k with the session's fixed context: reading the settings, request, cycle and trust code, and SnapPool's repo)
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. `pack-sdk`:
  - `definePack()` validates the manifest and rejects looser guard overrides and unknown finding types;
  - a registry;
  - the threshold engine, working on computed evidence;
  - the manifest publisher (`pack_manifests`, facts as JSON Schema via zod's JSON-Schema export).
  - notes:
- [ ] 2. `packs/saas-snappool`:
  - defaults (`SNAPPOOL-TRACKING.md` §2): `pool_request` = soft, `signup` = success (the KPI), `activated` = success, `paid` = hard (no source until SnapPool has a checkout); feedback routes `pool_request → Meta Lead`, `signup → Meta CompleteRegistration` and `signup → Google`;
  - phases: beta → promo → standard, following SnapPool's own pricing phases (beta signup window to 2026-11-30), plus notes on seasonal peaks;
  - fact schema: features, plans, pricing, event types;
  - thresholds: low click floors, high day floors;
  - `analystContext`;
  - runtime: the SnapPool adapter. It uses the read-only DB URL and reads `pool_requests` (plus `events.first_upload_at` for activation). Only claimed `/start` requests count as signups. It hashes emails inside the adapter, sets `isTest` from `settings.testTraffic.emailDomains` plus the superadmin, and takes ids and `web` from `pool_requests.attribution`, `user_agent` and `page_url` once SnapPool's tracking change (T6b) has shipped. Before that they're empty. SnapPool deletes pending requests after 30 days, so the adapter reads at least daily and keeps what it has read: a pending row that disappears is not a deleted outcome (D-064).
  - notes:
- [ ] 3. `core/settings`:
  - settings are validated on **every read**, so a bad stored value stops the cycle with an alert instead of being used;
  - `settings_patch` handling, building on M01b's processor;
  - seeding from pack defaults;
  - version history;
  - `ads settings get|set`.
  - notes:
- [ ] 4. `ads outcomes --product X` shows outcomes by stage. The attribution rate is added in M05b.
  - notes:
- [ ] 5. The trust check `outcome_source_fresh` is switched on.
  - notes:

## Tests
- [ ] The SnapPool pack passes `definePack`. A looser guard override fails. Thresholds are monotonic: more evidence never fails where less passed.
- [ ] The adapter passes its fixture tests and `healthcheck`. A raw email never appears outside the adapter (the test scans all outputs). `isTest` outcomes are excluded.
- [ ] Settings: an unknown KPI stage is rejected; a stale `baseVersion` is refused; a bad stored value is detected on read.
- [ ] The manifest's JSON Schema accepts and rejects the same samples as the zod schema.

## Done when (cloud)
- [ ] All tests are green.
  - evidence:

## Done when (live, run by Marcus)
- [ ] `ads outcomes --product snappool` prints 30 days of outcomes by stage.
  - result: —
- [ ] Marcus's starting settings are entered with `ads settings set`: the test-signup email domains (D-059), a monthly ceiling of S$500 (D-063), and a daily ceiling of his choice.
  - result: —
- [ ] Changing the KPI from `signup` to `paid` with `ads settings set` changes the output, with no code change.
  - result: —

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **The SnapPool SQL used:** _written at close._

## Skills to create
- None listed.

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
- 2026-10-06: **SnapPool's tracking change is already live** (since 2026-09-25 17:01 UTC), although this repo's NOW.md still said "not built yet". SnapPool's own memory asks for the go-live instant to be recorded here; done in NOW.md ("Deployed"). Attribution data exists from that instant, so the adapter maps the real `attribution` keys now (not "empty until T6b").
- 2026-10-06: **The pack's default feedback routes can't know the destination ids** (the Meta dataset id and the Google conversion action id come from setup tasks T4 and T11). So `FeedbackRoute.destinationId` may be `null` until then: nothing is uploaded on such a route, but the route still says the KPI stage reaches that platform through uploads, which keeps `tracking_active` at `no_signal` instead of `fail` before Phase 2 (D-075). (D-076)
- 2026-10-06: **One email hash can't serve both platforms**: Meta normalises by trimming and lower-casing; Google also removes inner whitespace and the dots of a Gmail address. The adapter computes both, so the raw email never leaves it (`HashedContact.emailSha256Google`, D-076).
