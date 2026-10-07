# M05b — Property pack (the G8 test), attribution, product docs

<!-- Created by the start-milestone skill from docs/plan/BLUEPRINT.md §7.
     Copy the requirements; don't paraphrase them. Tick items at every checkpoint.
     Keep "Notes" factual and dated. -->

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-07 |
| **Finished** | 2026-10-07 (cloud part) |
| **PRs** | [#10](https://github.com/marcustanforwork/agenticAdsManager/pull/10) |

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
  - [x] ~300k built, typecheck green (all five Builds done at ~390k with the session's fixed context; no cut needed: both "Cut first" items were already built)
  - [x] ~450k tests green, self-review done (code review at high effort: 10 findings, all confirmed and fixed, commit 47dad1c)
  - [x] ~550k committed, pushed, handed off

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
- [x] 2. `core/attribution` (§5.12). `ads outcomes` gains the attribution rate.
  - notes: commit 659c1d7. `core/src/attribution/attribute.ts`: `attributionFor` (pure; the four methods in order; platform ids try the campaign id first, then an ad group / ad set or ad id walked up to its campaign; the gclid window is 90 days with a day of slack; utm restricted to the `utm_source`'s platform when it names one; a name two campaigns share matches nothing) and `attributeOutcomes` (new outcomes plus `none` ones from the last `ATTRIBUTION_RETRY_DAYS` = 7, since a same-day click arrives with the next day's click sync; one update per method and campaign). It runs in the cycle's `synced` stage after both reads (`CycleSummary.attribution`) and in `ads outcomes` (not with `--no-read`). The report gains `attribution` (the KPI stage: outcomes, attributed, `ratePct`, `byMethod` incl. `pending`, and this run's counts) and `stages[].attributed`. Test outcomes are attributed too but never counted. The utm fallback was built (not cut).
- [x] 3. Product docs:
  - seed `product_docs` from `products/<slug>/*.md`;
  - handle `product_doc_put` requests, plus `ads docs set --product X --doc strategy --file <path>`;
  - the analyst reads the latest version (M06b).
  - notes: commit ff5b088. `product_doc_put` in `core/src/requests/handlers.ts` (stale base refused; at most `PRODUCT_DOC_MAX_CHARS` = 20,000 characters, since the analyst reads every document in full). `ads seed` creates version 1 of each document from `products/<slug>/{STRATEGY,PLAYBOOK,LEARNINGS}.md` (`apps/worker/src/seedDocs.ts`; `SeedSpec.products[].docs`, `SeedReport.docsCreated`; a document with a version is never replaced). `ads docs get` prints the latest Markdown; `ads docs set --doc <d> --file <path> [--base-version n]` records a `product_doc_put` (`apps/worker/src/docs.ts`). M06b reads the latest with `getProductDoc`.
- [x] 4. The trust checks `attribution_gap` and `id_capture` are switched on.
  - notes: commit cf03a20. `attributionGap` and `idCapture` in `core/src/cycle/trust.ts`, wired into `trustStage` (a cycle now stores 11 checks for a product with one Meta and one Google account). `attribution_gap` is per account: the platform's KPI conversions (`trust_signals.platformConversions`) against our non-test KPI outcomes attributed to that account's campaigns, both over the 7 days before the signals were read; gap = difference ÷ the larger count; no_signal below `minOutcomesForGap` on both sides, or for an upload-only route before any upload (as `tracking_active`, D-075). `id_capture` is product level: the share of the last 7 days' non-test KPI outcomes carrying a click or platform id (`CAPTURED_ID_KEYS`; utm values alone don't count); no outcomes is no_signal, and low volume is still judged, as the BLUEPRINT table says.
- [x] 5. `facts_put` (moved from M05a): validate an offering's facts against its pack's fact schema in the request processor (`HandlerContext.packs`), then `putOfferingFacts`.
  - notes: commit ff5b088. `core/src/requests/facts.ts` (`validateFacts`, `FactsError`, a refusal) and the handler in `handlers.ts`; removed from `NOT_AVAILABLE_UNTIL`. A product whose pack isn't installed is refused. `unknownPaths` now also compares objects inside lists (`unitMix.0.size`), for `settings_patch` too. No CLI: the dashboard's fact form (M10a) is the surface.

## Tests
- [x] The property pack passes `definePack`, and its fixture adapter passes its tests and `healthcheck`. (`packs/property-sg/test/pack.test.ts`, `adapter.test.ts`: 27 tests)
- [x] `facts_put`: facts the pack's schema rejects are refused; unknown keys are refused by name. (`core/test/requests.test.ts > facts_put`)
- [x] Attribution: platform ids, gclid lookup, utm, none. (`core/test/attribution.test.ts`: every method, the order, the 90-day window, retries, other products; `apps/worker/test/settings.test.ts > credits outcomes to campaigns and prints the KPI stage's attribution rate`)
- [x] Product docs: versions increase; a stale `baseVersion` is refused. (`core/test/requests.test.ts > product_doc_put`; `db/test/seed.test.ts`; `apps/worker/test/settings.test.ts > ads docs`)
- [x] The new trust checks, table-driven, including low volume. (`core/test/trust.test.ts`: the `attribution_gap` and `id_capture` tables, and `trustStage > attribution_gap compares the platform with outcomes attributed to that account; id_capture counts ids`)

## Done when (cloud)
- [x] All tests are green.
  - evidence: full preflight below (`Tests 741 passed | 3 skipped`).
- [x] **G8 check:** `git show --stat <property-pack commit>` lists no files under `packages/core`, `packages/gateway` or `packages/connector-*`.
  - evidence: `git show --stat --format= c1d9798 | grep -E "packages/(core|gateway|connector-)"` → nothing. The commit's 16 files: `packages/packs/property-sg/**`, `apps/worker/src/packs.ts`, `apps/worker/test/settings.test.ts`, `products/seed.json`, `pnpm-lock.yaml`.

## Done when (live, run by Marcus)
- [ ] `ads outcomes --product snappool` shows the attribution rate on real outcomes.
  - result: —

### Live steps for Marcus
_At the end of Phase 0 (D-074), after the M01a–M05a steps (the ad accounts synced, T6a set). Doppler `dev`, the Neon dev branch. No migration in M05b._
1. `git pull` on `main`, `pnpm install`, then `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads seed`
   - expect: `"docsCreated"` 6 the first time the documents are seeded (or 0 if M01a's seed step already ran on this code), nothing else created.
2. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads docs list --product snappool`
   - expect: `strategy`, `playbook` and `learnings` at `"version": 1`. To edit one: `… ads docs get --product snappool --doc strategy > strategy.md`, edit, then `… ads docs set --product snappool --doc strategy --file strategy.md --base-version 1` → `"status": "done"`, `"version": 2`.
3. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads cycle --product snappool --kind manual --until trust_checked`
   - expect: `"attribution": {"checked": …}` in the output, and among the checks `attribution_gap` per account (`no_signal` while nothing is uploaded) and `id_capture` (`pass` or `warn`).
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads outcomes --product snappool`
   - expect: `"attribution": {"stage": "signup", "outcomes": …, "attributed": …, "ratePct": …, "byMethod": {…}}`. Until the ad URL settings (T14) are in place, most signups show as `none`: Meta can't say which campaign an `fbclid` came from.
   - report back: the `attribution` block (counts only). It becomes the "attribution rate observed" below.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| — | — | Nothing cut. Both "Cut first" items (the utm fallback, the live Airtable wiring) were built; recording the real Airtable base waits until property resumes (it isn't a cut: the adapter, the fixture and the interface are done). | 2026-10-07 |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->
<!-- `facts_put` was moved INTO this milestone (from M05a), so it can't be cut again. -->

## Leave behind (for later milestones)
- **The stage ↔ Airtable field mapping** (`LEAD_FIELDS`, `packages/packs/property-sg/src/airtable.ts`; written against the hand-made fixture, **confirm against the real base when property resumes**):

  | Stage / value | Airtable | Notes |
  |---|---|---|
  | `form_fill` | the record's `createdTime` | one record per Tally submission; source id = the record id |
  | `qualified_viewing` | `Qualified viewing on` (date, or date and time) | counted once its day has come (00:00 Singapore time) |
  | `booked` | `Booked on` (date, or date and time) | the same |
  | hashed email | `Email` | name and phone are never read |
  | click ids | `gclid`, `gbraid`, `wbraid`, `fbclid` (text) | Tally hidden fields (T12); `fbc` rebuilt from `fbclid` at the form fill |
  | utm and platform ids | `utm_source`, `utm_medium`, `utm_campaign`, `sp_agid`, `sp_adid` (text, never number fields) | `utm_campaign` = the platform's campaign id (ad URL settings) |
  | connection | env `PROPERTY_AIRTABLE_TOKEN` (`data.records:read`, this base only), `PROPERTY_AIRTABLE_BASE_ID`, `PROPERTY_AIRTABLE_TABLE` | Doppler, when property resumes |

  **UNVERIFIED** (Airtable docs blocked): the filter formula and the 422 for an unknown field name (GOTCHAS).
- **The attribution rate observed:** — (from live step 4).
- **For M06a/M06b:** outcomes per campaign come from `outcomes.attributed_entity_id` (campaign level; test outcomes excluded by `is_test`); the analyst's trusted context reads the latest product documents with `getProductDoc` (at most 20,000 characters each) and offering facts from `offerings.facts`; the phase from the pack's `detectPhase` with an offering's facts.
- **For M10a (dashboard):** a fact form posts `facts_put` (the whole facts object; unknown keys refused by name); a document editor posts `product_doc_put` with the version it loaded as `baseVersion`.
- **For M12 (Meta uploads) and property:** property outcomes carry no `web` context (Tally gives no user agent or page URL); Meta website events need both, so property uploads need a hidden page-URL field or another `action_source` (decide in M12). Skip routes whose `destinationId` is null.
- **When property resumes:** T12 (hidden fields), the three env vars, record a page of the real table (made-up values), fix `LEAD_FIELDS`, confirm the formula; `products/seed.json` keeps it `dormant` until then.

## Skills to create
- `add-product-pack`.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Reads only; no package depends on a `*-write` connector (preflight grep empty). The Airtable adapter only lists records. |
| 2 | No product logic in shared code | yes | The G8 commit touches no core, gateway or connector file; the product-name grep over contracts, pack-sdk, core, db, vault, connectors and web is empty. The utm mapping in contracts names platforms, not products. |
| 3 | AI calls through core/model | yes | No AI in M05b. |
| 4 | The AI never supplies decision numbers | yes | Attribution, the attribution rate and both checks are SQL counts and pure functions. |
| 5 | Untrusted text is data | yes | Airtable values and visitors' ids are type- and length-checked and only compared with stored ids; product docs are Marcus's trusted text, capped at 20,000 characters. |
| 6 | Money is bigint micros / decimal strings | yes | The property facts' PSF band is `MicrosJson`; thresholds' spend is bigint (`money()`); no float near money (preflight grep: only M02/M03's existing hits). |
| 7 | Every write action has an undo and a test | yes | No write action added. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | The property thresholds have the monotonic property test; no guard or copy rule added (the pack's required strings are placeholders for M15a). |
| 9 | Surfaces only record intent | yes | `ads docs set` records a `product_doc_put`; `facts_put` goes through the one processor; `ads seed` is setup; `ads outcomes` and the cycle attribute from the database only. |
| 10 | apps/web depends only on contracts + db | yes | Untouched. |
| 11 | product_id + an index on product-scoped tables | yes | No new table or migration (`db:generate` → no schema changes). |
| 12 | No state outside Postgres | yes | Attribution state is `outcomes.attribution_method`; documents, facts and requests are rows. |
| 13 | No secrets or personal data | yes | Fixture emails are made up on reserved domains (`example.com`, `example.net`, `staff.example`); the raw-email scan covers every adapter output; Airtable errors never carry the token (tested). |
| 14 | No production write capability outside the gateway | yes | The Airtable token is read-only (`data.records:read`); the worker gains no write key. |
| 15 | Cut items moved at most once | yes | `facts_put` (moved in from M05a) was done; nothing cut. |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-077), GOTCHAS (Airtable) updated at close. |

## Evidence
- Full preflight after the review fixes (2026-10-07): `pnpm typecheck` → `Tasks: 17 successful` · `pnpm lint` OK · `pnpm check:boundaries` → `check-boundaries: OK (17 packages)`, `no dependency violations found (255 modules, 737 dependencies cruised)` · `pnpm test` → `Test Files 62 passed | 1 skipped (63)`, `Tests 741 passed | 3 skipped (744)` · `pnpm build` OK · `pnpm format:check` OK · `db:generate` → `No schema changes`.
- G8: see "Done when (cloud)" above (commit c1d9798).
- Named tests: `property-sg pack.test.ts > passes definePack and loads through a registry`, `> has a threshold for every finding type, and they are monotonic (property)`, `> publishes a fact JSON Schema that accepts and rejects the same samples as the zod schema`, `> detectPhase …`; `adapter.test.ts > emits one outcome per stage, oldest first, from the requested time`, `> hashes emails inside the adapter … and never lets a raw email out`, `> healthcheck …`; `core requests.test.ts > facts_put …`, `> product_doc_put …`; `core attribution.test.ts > tries platform ids, then the gclid, then utm_campaign; otherwise none, kept and reported`, `> retries recent unattributable outcomes once their click arrives …`; `core trust.test.ts > attribution_gap: …` and `id_capture: …` tables, `> attribution_gap compares the platform with outcomes attributed to that account; id_capture counts ids`; `db outcomes.test.ts > attribution and trust-check counts (M05b)`; `apps/worker settings.test.ts > ads docs …`, `> credits outcomes to campaigns and prints the KPI stage's attribution rate`.

## Notes and surprises
- 2026-10-07: **Code review (high effort, D-067): 10 findings, all confirmed and fixed** (commit 47dad1c): `utm_campaign` matched for non-ad sources (a newsletter); `ads docs set` could overwrite a newer version unseen (now `--base-version` is required once a document has one, and `ads docs list` shows versions); Airtable pages fired back to back (now paced under 5 a second) and the health check read 35 days (now 14, one call); the gap check compared a rolling UTC window with the platform's account days; retries could crowd new outcomes out of a batch; `fbp` counted as a click id; the utm lookup scanned every entity per outcome; three entity queries where one does; the utm-source mapping was copied in each pack (now `platformOfUtmSource` in contracts).
- 2026-10-07: **No cut needed.** Both "Cut first" items were cheap once the pack existed, so they were built; only the live recording of the Airtable base waits for property to resume.
- 2026-10-07: `airtable.com`, `support.airtable.com`, `tally.so` and `tallyso.notion.site` are blocked by the cloud proxy (EGRESS_BLOCKED). The Airtable facts come from search summaries (GOTCHAS); how Tally's Airtable integration names its columns is unknown, so the field mapping is a guess to confirm against the real base.
