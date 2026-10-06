# M05a — Pack SDK, SnapPool pack, settings

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-06 |
| **Finished** | 2026-10-06 (cloud part) |
| **PRs** | [#9](https://github.com/marcustanforwork/agenticAdsManager/pull/9) |

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
  - [x] ~300k built, typecheck green (~410k with the fixed context; `facts_put` cut to M05b at ~335k, the publisher kept)
  - [x] ~450k tests green, self-review done (code review at high effort: 10 findings, all confirmed and fixed)
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. `pack-sdk`:
  - `definePack()` validates the manifest and rejects looser guard overrides and unknown finding types;
  - a registry;
  - the threshold engine, working on computed evidence;
  - the manifest publisher (`pack_manifests`, facts as JSON Schema via zod's JSON-Schema export).
  - notes: `packages/pack-sdk/src/{definePack,registry,thresholds,manifestDocument}.ts`; `core/src/packs.ts` (`publishPackManifests`), called by the worker at startup. A defined pack is frozen and defining it again returns it unchanged. Commits a16fd01, f11b891, 25437d1.
- [x] 2. `packs/saas-snappool`:
  - defaults (`SNAPPOOL-TRACKING.md` §2): `pool_request` = soft, `signup` = success (the KPI), `activated` = success, `paid` = hard (no source until SnapPool has a checkout); feedback routes `pool_request → Meta Lead`, `signup → Meta CompleteRegistration` and `signup → Google`;
  - phases: beta → promo → standard, following SnapPool's own pricing phases (beta signup window to 2026-11-30), plus notes on seasonal peaks;
  - fact schema: features, plans, pricing, event types;
  - thresholds: low click floors, high day floors;
  - `analystContext`;
  - runtime: the SnapPool adapter. It uses the read-only DB URL and reads `pool_requests` (plus `events.first_upload_at` for activation). Only claimed `/start` requests count as signups. It hashes emails inside the adapter, sets `isTest` from `settings.testTraffic.emailDomains` plus the superadmin, and takes ids and `web` from `pool_requests.attribution`, `user_agent` and `page_url` once SnapPool's tracking change (T6b) has shipped. Before that they're empty. SnapPool deletes pending requests after 30 days, so the adapter reads at least daily and keeps what it has read: a pending row that disappears is not a deleted outcome (D-064).
  - notes: `src/manifest.ts` (pure), `src/adapter.ts` (`pg`, read-only transaction, `SNAPPOOL_DATABASE_URL`), `src/runtime.ts` (`detectPhase`), `src/index.ts` (`definePack`). Routes ship with `destinationId: null` until T4/T11 (D-076). T6b is already live, so ids and `web` come from the stored attribution now. "Keeps what it has read": core reads 35 days back every cycle and never deletes outcomes. Commit a002f40.
- [x] 3. `core/settings`:
  - settings are validated on **every read**, so a bad stored value stops the cycle with an alert instead of being used;
  - `settings_patch` handling, building on M01b's processor;
  - seeding from pack defaults;
  - version history;
  - `ads settings get|set`.
  - notes: `core/src/settings/settings.ts`; `InvalidSettingsError` (db) on every read; the cycle returns `blocked` and queues one `alert`; a patch merges onto the raw stored document, so it can repair one. Seeding is `ads seed` (`db:seed` removed). `ads settings get|set|history` in `apps/worker/src/settings.ts`; `set` is a `settings_patch` as `cli:<ADS_OPERATOR or login>`. Commits 3222d54, f11b891, 25437d1.
- [x] 4. `ads outcomes --product X` shows outcomes by stage. The attribution rate is added in M05b.
  - notes: `apps/worker/src/outcomes.ts`: reads the source (or `--no-read`), then 30 days (`--days`) by stage from the settings, test traffic apart, the KPI stage marked; counts only. Exit 1 when the source can't be read.
- [x] 5. The trust check `outcome_source_fresh` is switched on.
  - notes: `core/src/outcomes/sync.ts` (the read, inside the `synced` stage, state in `products.outcome_source`, migration `0003`) and `outcomeSourceFresh` in `core/src/cycle/trust.ts` (product level).

## Tests
- [x] The SnapPool pack passes `definePack`. A looser guard override fails. Thresholds are monotonic: more evidence never fails where less passed. (`packs/saas-snappool/test/pack.test.ts`; `pack-sdk/test/{definePack,thresholds}.test.ts`, property tests)
- [x] The adapter passes its fixture tests and `healthcheck`. A raw email never appears outside the adapter (the test scans all outputs). `isTest` outcomes are excluded. (`packs/saas-snappool/test/adapter.test.ts` on a fixture copy of SnapPool's tables; exclusion from counts: `apps/worker/test/settings.test.ts`, `db/test/outcomes.test.ts`)
- [x] Settings: an unknown KPI stage is rejected; a stale `baseVersion` is refused; a bad stored value is detected on read. (`core/test/settings.test.ts`, `db/test/products.test.ts`)
- [x] The manifest's JSON Schema accepts and rejects the same samples as the zod schema. (`pack-sdk/test/manifestDocument.test.ts` and the SnapPool pack's, with ajv and generated samples)

## Done when (cloud)
- [x] All tests are green.
  - evidence: full preflight below (`Tests 679 passed | 3 skipped`).

## Done when (live, run by Marcus)
- [ ] `ads outcomes --product snappool` prints 30 days of outcomes by stage.
  - result: —
- [ ] Marcus's starting settings are entered with `ads settings set`: the test-signup email domains (D-059), a monthly ceiling of S$500 (D-063), and a daily ceiling of his choice.
  - result: —
- [ ] Changing the KPI from `signup` to `paid` with `ads settings set` changes the output, with no code change.
  - result: —

### Live steps for Marcus
_At the end of Phase 0 (D-074), after the M01a–M04 steps. Doppler `dev`, the Neon dev branch of the agent's database._
1. `git pull` on `main`, `pnpm install`, then `doppler run --config dev -- pnpm --filter @ads/db db:migrate`
   - expect: `migrations and roles.sql applied` (migration `0003`: `products.outcome_source`, `outcomes.web`).
2. **T6a, a read-only login to SnapPool's database.** In SnapPool's Neon project (production branch): create a role `ads_agent_ro` (Console → Roles), then in the SQL editor: `grant usage on schema public to ads_agent_ro; grant select on pool_requests, hosts, events to ads_agent_ro; alter role ads_agent_ro set default_transaction_read_only = on;`. Put its connection string in Doppler `dev` as `SNAPPOOL_DATABASE_URL`.
   - expect: nothing to see yet. The adapter also reads in a read-only transaction.
3. In Doppler `dev`, add `cli:<your login name>` to `OPERATOR_ACTORS` (comma-separated), or set `ADS_OPERATOR` to a name you list there.
4. `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads outcomes --product snappool`
   - expect: `"read": {"outcome": "read", …}`, then 30 days of `pool_request`, `signup`, `activated` (and `paid` at 0), with `"kpiStage": "signup"`.
   - report back: the JSON (it holds counts only).
5. Your starting settings (D-059, D-063). Replace `<your-domain>` with the domains you sign up with when testing, and pick the daily ceiling in micros (S$1 = `1000000`; S$25 = `25000000`):
   `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads settings set --product snappool --patch '{"testTraffic":{"emailDomains":["<your-domain>"]},"spend":{"monthlyCeilingMicros":"500000000","dailyCeilingMicros":"25000000"}}'`
   - expect: `"status": "done"`, `"version": 2`. Run step 4 again: your own signups now count under `test`.
6. The KPI switch: `… ads settings set --product snappool --patch '{"outcomes":{"primaryKpiStage":"paid"}}'`, then `… ads outcomes --product snappool --no-read`
   - expect: `"kpiStage": "paid"`, and the `kpi` mark on `paid`. Switch back with `--patch '{"outcomes":{"primaryKpiStage":"signup"}}'`.
   - report back: "KPI switch OK".
7. Optional: `… ads settings history --product snappool` lists the versions and what each changed.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| `facts_put` (the handler; listed for M05a in M01b's `NOT_AVAILABLE_UNTIL`, not in BLUEPRINT's M05a Builds) | M05b (Build 5) | cut first in the session plan, at the ~300k checkpoint | 2026-10-06 |

<!-- An item may move only once. An item moved INTO this milestone can't be cut again. -->

## Leave behind (for later milestones)
- **The SnapPool SQL used** (`packages/packs/saas-snappool/src/adapter.ts`), run in `begin read only` with `statement_timeout` 30 s, `$1` = since, `$2` = limit (5,000):
  ```sql
  -- is_superadmin: coalesce((select bool_or(h.is_superadmin) from hosts h where lower(h.email) = lower(pr.email)), false)
  select 'pool_request' as stage, pr.id::text as source_id, pr.created_at as occurred_at,
         pr.email, <is_superadmin>, pr.attribution, pr.user_agent, pr.page_url
    from pool_requests pr where pr.created_at >= $1
  union all
  select 'signup', pr.id::text, pr.claimed_at, pr.email, <is_superadmin>, pr.attribution, pr.user_agent, pr.page_url
    from pool_requests pr where pr.status = 'claimed' and pr.claimed_at >= $1
  union all
  select 'activated', e.id::text, e.first_upload_at, pr.email, <is_superadmin>, pr.attribution, pr.user_agent, pr.page_url
    from events e join pool_requests pr on pr.event_id = e.id and pr.status = 'claimed'
   where e.first_upload_at >= $1
  order by occurred_at, stage, source_id limit $2;
  -- healthcheck:
  select greatest(max(created_at), max(claimed_at)) as latest from pool_requests;
  ```
- **For M05b (property pack, G8):** build it with `definePack` like `packs/saas-snappool`, add it to `INSTALLED_PACKS` (`apps/worker/src/packs.ts`) and drop `property-sg`'s stub `settings` from `products/seed.json` (then `ads seed` takes the pack's defaults). Neither file is under `packages/core`, so the G8 check holds. **`facts_put`** (moved here): a handler using `HandlerContext.packs` → `manifest.facts.schema`, refusing unknown keys by name like `settings_patch` does, then `putOfferingFacts`; remove it from `NOT_AVAILABLE_UNTIL`. **Attribution:** `outcomes.ids` carries `googleCampaignId`/`metaCampaignId` (digits only) plus `gclid`/`fbclid`/`utm_*`; `ids` is empty for organic visits.
- **For M06a (detectors):** `meetsThreshold(manifest, findingType, evidence)` from `@ads/pack-sdk`; evidence is computed from SQL; no threshold means "not met" (fail closed). SnapPool has a threshold for every finding type.
- **For M07 (worker service):** pass `packs: INSTALLED_PACKS` and `env: process.env` into `runCycle` and every `RequestContext` (`packs` is required). Invalid stored settings queue a `notifications` row `kind: 'alert'`, `payload.alert: 'invalid_settings'` (one unsent per product), for the bot (M09a) or the digest. `publishManifestsAtStartup` already runs in `main.ts`.
- **For M12/M13 (uploads):** skip a feedback route whose `destinationId` is `null`; Meta uses `hashedContact.emailSha256`, Google `emailSha256Google`; `outcomes.web` holds `userAgent`/`pageUrl` for Meta website events; never upload `is_test` outcomes (`is_test` can change on a re-read, so check it when uploading).
- **For M10a (dashboard):** pack manifests are in `pack_manifests` (`manifest.facts.jsonSchema` for forms); `dashboard_outcomes` leaves out `hashed_contact` and `web`.

## Skills to create
- None listed.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Reads only; no package depends on a `*-write` connector (preflight grep empty). The SnapPool adapter reads in a read-only transaction. |
| 2 | No product logic in shared code | yes | Product names only in `packages/packs/saas-snappool`, `apps/worker` and `products/`; the preflight grep on contracts, pack-sdk, core, db, vault, connectors and web is empty (a core comment naming SnapPool was fixed in review). |
| 3 | AI calls through core/model | yes | No AI in M05a. |
| 4 | The AI never supplies decision numbers | yes | Thresholds come from the pack, evidence from SQL; outcomes and counts from the database. |
| 5 | Untrusted text is data | yes | SnapPool's attribution (from visitors' cookies) is copied into fixed fields after type and length checks, never interpreted; patches can't add unknown keys. |
| 6 | Money is bigint micros / decimal strings | yes | Ceilings and threshold spend are MicrosJson strings; the evidence engine compares bigints; the manifest's money helper is bigint (a float was fixed in review). |
| 7 | Every write action has an undo and a test | yes | No write action added. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | Thresholds: monotonic property tests (pack-sdk and the SnapPool pack); guard layering reuses the property-tested `mergeGuardsTightenOnly`, with example tests for the pack layer. |
| 9 | Surfaces only record intent | yes | `ads settings set` records a `settings_patch` for the one processor; `ads seed` is setup; `ads outcomes` reads. |
| 10 | apps/web depends only on contracts + db | yes | Untouched. |
| 11 | product_id + an index on product-scoped tables | yes | No new table; new columns on `products` and `outcomes`. |
| 12 | No state outside Postgres | yes | The outcome source's state is `products.outcome_source`; outcomes, settings versions and manifests are rows. |
| 13 | No secrets or personal data | yes | Fixture emails are made up (`example.*`, a reserved `staff.example`); raw emails never leave the adapter (scanned in a test); no URLs or tokens in outputs or errors (scrubbed). |
| 14 | No production write capability outside the gateway | yes | The worker gains no write key. |
| 15 | Cut items moved at most once | yes | `facts_put` moved once (M05a → M05b). |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-076), GOTCHAS updated at close. |

## Evidence
- Full preflight after the review fixes (2026-10-06): `pnpm typecheck` → `Tasks: 17 successful` · `pnpm lint` OK · `pnpm check:boundaries` → `check-boundaries: OK (17 packages)`, `no dependency violations found (240 modules, 681 dependencies cruised)` · `pnpm test` → `Test Files 59 passed | 1 skipped (60)`, `Tests 679 passed | 3 skipped (682)` · `pnpm build` OK · `pnpm format:check` OK · `db:generate` → `No schema changes`.
- Named tests: `pack.test.ts > the SnapPool pack > passes definePack and loads through a registry`, `> fails definePack with a looser guard override`, `> has a threshold for every finding type, and they are monotonic (property)`, `> publishes a fact JSON Schema that accepts and rejects the same samples as the zod schema`; `adapter.test.ts > never lets a raw email out: every output is scanned`, `> marks test traffic: listed domains (and their subdomains) and the superadmin`, `> healthcheck: healthy with the latest activity; unreachable or unconfigured is not ok`; `settings.test.ts > applies a valid patch as a new version; an unknown KPI stage is rejected`, `> refuses a stale baseVersion and changes nothing`, `> a bad stored value is detected on read: nothing runs, an alert is queued`; `apps/worker settings.test.ts > changing the KPI to paid with ads settings set changes the output, with no code change`.

## Notes and surprises
- 2026-10-06: **SnapPool's tracking change is already live** (since 2026-09-25 17:01 UTC), although this repo's NOW.md still said "not built yet". SnapPool's own memory asks for the go-live instant to be recorded here; done in NOW.md ("Deployed"). Attribution data exists from that instant, so the adapter maps the real `attribution` keys now (not "empty until T6b").
- 2026-10-06: **The pack's default feedback routes can't know the destination ids** (the Meta dataset id and the Google conversion action id come from setup tasks T4 and T11). So `FeedbackRoute.destinationId` may be `null` until then: nothing is uploaded on such a route, but the route still says the KPI stage reaches that platform through uploads, which keeps `tracking_active` at `no_signal` instead of `fail` before Phase 2 (D-075). (D-076)
- 2026-10-06: **Code review (high effort, D-067): 10 findings, all confirmed and fixed** (commit 441521b): a Meta dataset on another route went unwatched while the KPI route's was unset; `RequestContext.packs` was optional (a settings change could skip the pack's guard layer); a stuck outcome page stopped silently as a success; a bad activity time from an adapter could crash the sync; repeated alerts for one product, and alerts for products that aren't active; the SnapPool SQL scanned the whole history; a float in the manifest's money helper; a product name in a core comment; a needless product re-read; one duplicated guard loop.
- 2026-10-06: **One email hash can't serve both platforms**: Meta normalises by trimming and lower-casing; Google also removes inner whitespace and the dots of a Gmail address. The adapter computes both, so the raw email never leaves it (`HashedContact.emailSha256Google`, D-076).
