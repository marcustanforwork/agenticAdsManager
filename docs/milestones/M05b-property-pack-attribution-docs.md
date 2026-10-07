# M05b — Property pack (the G8 test), attribution, product docs

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-10-07 |
| **Finished** | — |
| **PRs** | — |

## Goal
The second pack is added with zero changes to the core, outcomes are attributed to campaigns, and the product documents live in the database.

## Needs
- [x] M05a: merged (PR #9, 2026-10-07). Its "Leave behind" covers the property pack wiring (`INSTALLED_PACKS`, `products/seed.json`), `facts_put` and the attribution ids.
- [x] **For real attribution data, SnapPool's tracking change (T6b) must have shipped:** it is live since 2026-09-25 17:01 UTC. Attribution is built and proven on fixtures here; the real rate is a live step (it also needs T6a, and T14 for the platform ids).
- [ ] **The existing Airtable base (Tally → Airtable, paused)**: not reachable from the cloud, and the property product is dormant. The adapter is built against a **hand-written fixture in Airtable's documented response shape**, with the field mapping in one constant. Recording the real base and fixing the mapping is part of the live Airtable wiring, which the plan cuts first ("keep the fixture and the interface") and which waits until property resumes (setup task T12).

## Read first
- BLUEPRINT §3.4 (packs) and §5.12 (attribution); §5.8 (`attribution_gap`, `id_capture`); §3.8 (`facts_put`, `product_doc_put`); §4 (`product_docs`, `offerings`, `outcomes`, `google_clicks`).
- `docs/plan/SNAPPOOL-TRACKING.md` §3–4; PROPOSAL §4 and §8; M05a's milestone file ("Leave behind").
- External facts (GOTCHAS, checked 2026-10-07): the Airtable Web API (list records, paging, rate and monthly limits). `airtable.com`, `support.airtable.com` and `tally.so` are blocked by the cloud proxy, so these come from search summaries.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order, each step green, committed and pushed:
  1. **`packs/property-sg`, its own commit, first (G8):** the manifest (pure), the runtime (`detectPhase`, the Airtable adapter on `fetch`), the tests (definePack, JSON Schema vs zod, monotonic thresholds, the adapter on the fixture, `healthcheck`, the raw-email scan, `isTest`), plus `INSTALLED_PACKS` and `products/seed.json` (stub settings dropped). Then `git show --stat` must list nothing under `packages/core`, `packages/gateway` or `packages/connector-*`.
  2. **`facts_put` and product docs (Builds 5 and 3):** both handlers in the one processor; `product_docs` seeded from `products/<slug>/*.md` by `ads seed`; `ads docs get|set`.
  3. **`core/attribution` (Build 2):** the four methods in order; recent `none` outcomes retried (a same-day click's id only arrives with the next day's click sync); run in the cycle's sync stage and by `ads outcomes`, which gains the attribution rate.
  4. **Trust checks (Build 4):** `attribution_gap` (per account) and `id_capture` (product), table-driven tests including low volume.
  5. Plan updates (D-077), the `add-product-pack` skill, preflight, code review, close.
- Cut first, if behind at ~300k: the utm fallback; live Airtable wiring (keep the fixture and the interface).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented (~230k with the session's fixed context and the code M05b changes)
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [x] 1. `packs/property-sg`, as **its own commit, made first. This is the G8 test.**
  - defaults: form_fill = success, qualified_viewing = hard, booked = hard; KPI = form_fill;
  - phases: teaser / vvip / booking / clearing, with `detectPhase` reading `offerings.facts.launchDates`;
  - fact schema: district, mrt, psfBand, unitMix, developer, top, launchDates;
  - thresholds;
  - `platformPolicy.meta.specialAdCategories = ['HOUSING']` (confirmed by Marcus, D-062);
  - copy tier `fragments`, with placeholder required strings;
  - runtime: an Airtable adapter built against a recorded fixture of the existing base.
  - notes: commit c1d9798. `src/manifest.ts` (pure), `src/runtime.ts` (`detectPhase`: the last phase whose `launchDates` day has started, 00:00 Singapore time; teaser before any), `src/airtable.ts` (list records over `fetch`, read only; `LEAD_FIELDS` is the field mapping; env `PROPERTY_AIRTABLE_TOKEN`, `PROPERTY_AIRTABLE_BASE_ID`, `PROPERTY_AIRTABLE_TABLE`). The fixture is **hand-made** in Airtable's documented shape (the base isn't reachable; `test/fixtures/README.md`). Default feedback routes `form_fill → Meta Lead` and `form_fill → Google`, destinations unset (like SnapPool's, D-076). Installed in `INSTALLED_PACKS`; `products/seed.json` lost the stub settings.
- [ ] 2. `core/attribution` (§5.12). `ads outcomes` gains the attribution rate.
  - notes: —
- [ ] 3. Product docs:
  - seed `product_docs` from `products/<slug>/*.md`;
  - handle `product_doc_put` requests, plus `ads docs set --product X --doc strategy --file <path>`;
  - the analyst reads the latest version (M06b).
  - notes: —
- [ ] 4. The trust checks `attribution_gap` and `id_capture` are switched on.
  - notes: —
- [ ] 5. `facts_put` (moved from M05a): validate an offering's facts against its pack's fact schema in the request processor (`HandlerContext.packs`), then `putOfferingFacts`.
  - notes: —

## Tests
- [x] The property pack passes `definePack`, and its fixture adapter passes its tests and `healthcheck`. (`packs/property-sg/test/pack.test.ts`, `adapter.test.ts`: 27 tests)
- [ ] `facts_put`: facts the pack's schema rejects are refused; unknown keys are refused by name.
- [ ] Attribution: platform ids, gclid lookup, utm, none.
- [ ] Product docs: versions increase; a stale `baseVersion` is refused.
- [ ] The new trust checks, table-driven, including low volume.

## Done when (cloud)
- [ ] All tests are green.
  - evidence: —
- [x] **G8 check:** `git show --stat <property-pack commit>` lists no files under `packages/core`, `packages/gateway` or `packages/connector-*`.
  - evidence: `git show --stat --format= c1d9798 | grep -E "packages/(core|gateway|connector-)"` → nothing. The commit's 16 files: `packages/packs/property-sg/**`, `apps/worker/src/packs.ts`, `apps/worker/test/settings.test.ts`, `products/seed.json`, `pnpm-lock.yaml`.

## Done when (live, run by Marcus)
- [ ] `ads outcomes --product snappool` shows the attribution rate on real outcomes.
  - result: —

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->
<!-- `facts_put` was moved INTO this milestone (from M05a), so it can't be cut again. -->

## Leave behind (for later milestones)
- The stage ↔ Airtable field mapping; the attribution rate observed. _(Written at close.)_

## Skills to create
- `add-product-pack`.

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
- 2026-10-07: `airtable.com`, `support.airtable.com`, `tally.so` and `tallyso.notion.site` are blocked by the cloud proxy (EGRESS_BLOCKED). The Airtable facts come from search summaries (GOTCHAS); how Tally's Airtable integration names its columns is unknown, so the field mapping is a guess to confirm against the real base.
