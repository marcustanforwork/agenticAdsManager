---
name: add-product-pack
description: Add a new product pack, or change an existing one (packages/packs/*): its manifest (outcome stages, feedback routes, phases, fact schema, thresholds, platform policy, copy defaults, analyst context) and its runtime (the outcome adapter, detectPhase). Use when a new product is onboarded, when a pack's defaults, thresholds or fact schema change, when an outcome source changes shape ("add a pack", "new product", "change the SnapPool stages", "the Airtable fields changed"), and to run the G8 check that a pack needs no core change.
---

# Add or change a product pack

A pack is everything product-specific; the core stays product-agnostic (BLUEPRINT §2, §3.4; hard rule 2). The two
real examples: `packages/packs/saas-snappool` (Postgres source) and `packages/packs/property-sg` (Airtable over
`fetch`). Copy the closer one.

## 1. The package

- Directory `packages/packs/<kind>-<product>/`, package name `@ads/pack-<dir>` (`scripts/boundary-rules.mjs`
  derives it; no entry to add). Dependencies: `@ads/contracts`, `@ads/pack-sdk`, `zod`, plus the adapter's own
  library (`pg`…). **Never** core, db, gateway or a connector. `README.md` says its job.
- `src/manifest.ts` is **pure**: only `zod`, `@ads/contracts`, `@ads/pack-sdk` and the pack's own pure files
  (dependency-cruiser rule `pack-manifest-is-pure`). No Node built-ins.
- `src/runtime.ts`: `detectPhase` (pure, from `LifecycleContext`) and `outcomeAdapter(env, settings)`.
- `src/index.ts`: `export const pack = definePack({ manifest, runtime }); export default pack;`

## 2. The manifest (BLUEPRINT §3.4)

- `defaults.outcomes`: stages (`id` lower_snake, tier `soft|success|hard`), `primaryKpiStage`, feedback routes.
  A route's `destinationId` is `null` until its setup task gives the Meta dataset / Google conversion action
  id (D-076): nothing is uploaded on it, but `tracking_active` and `attribution_gap` know conversions arrive
  only through uploads.
- `defaults.copy`: tier, required strings (compliance text: placeholders like `[agency name]` until Marcus enters
  them, so copy checks fail closed), banned phrases.
- `phases` with `budgetPosture`; `analystContext` (trusted text, a draft for Marcus to edit).
- `facts.schema`: a plain `z.object` (no `.refine`/`.transform`: the published JSON Schema drops them, GOTCHAS);
  money as `MicrosJson`; days as a plain regex, not `z.iso.date()`. `requiredForCopy` keys must exist.
- `thresholds` for **every** `FindingTypeId`, minimums only (monotonic). `guardOverrides` may only tighten.
- `platformPolicy.meta.specialAdCategories` when Meta requires one (property: `HOUSING`, D-062).
- Bump `version` (semver) whenever defaults or thresholds change: manifests are published per version.

## 3. The outcome adapter (BLUEPRINT §3.5, §5.18)

- Read-only access, from env vars named after the product (`SNAPPOOL_DATABASE_URL`, `PROPERTY_AIRTABLE_*`); a
  missing one is a clear error naming it, never a crash. Errors never carry URLs, tokens or record values.
- `fetchSince(since, limit)`: events oldest first (`occurredAt` from `toISOString()`), at most `limit`, every one
  `OutcomeEvent`-valid. Core reads 35 days back each cycle and pages by the last time seen.
- Personal data: read only what's needed; `hashEmail(raw)` inside the adapter; the raw value never leaves it.
- `isTest` from `settings.testTraffic.emailDomains` (and subdomains), plus any product-specific rule.
- Ids: click ids kept whole up to 512 characters (a longer one dropped, not cut); `utm_*` ≤ 255;
  `platformOfUtmSource` (contracts) decides whether `utm_campaign`/`sp_agid`/`sp_adid` are Google or Meta ids
  (digits only). Values from visitors are data: type- and length-checked, never interpreted.
- `healthcheck()`: `{ ok, latestActivityAt? , detail? }`, cheap (one query or call).
- Mind the source's limits (Airtable: 5 requests a second per base, 1,000 calls a month on Free; GOTCHAS).

## 4. Tests (copy `test/pack.test.ts` and `test/adapter.test.ts` of the closer pack)

- `definePack` passes and loads through `createRegistry`; a looser guard override fails.
- Thresholds: one per finding type, monotonic (fast-check property).
- The fact JSON Schema (`manifestDocument`) agrees with zod on samples and `fc.jsonValue()` (ajv `Ajv2020`).
- `detectPhase` as a table, including day boundaries in the product's time zone.
- The adapter on a fixture (a fixture database, or hand-made API pages in the documented shape with made-up
  values on reserved domains: `example.com`, `staff.example`): stages and times, ids, `isTest`, limit, paging,
  errors, `healthcheck`, and **a scan of every output for the raw emails**.

## 5. Install it

- `apps/worker/src/packs.ts`: add it to `INSTALLED_PACKS`; add the dependency to `apps/worker/package.json`.
- `products/seed.json`: the product with `packId`, `status` (`dormant` until it advertises) and offerings; leave
  `settings` out so `ads seed` takes the pack's defaults. `products/<slug>/{STRATEGY,PLAYBOOK,LEARNINGS}.md` seed
  the product documents (version 1).
- `pnpm install`, then the full preflight.

## 6. The G8 check (a new pack needs no core change)

Commit the pack (and its installation) **on its own**, then:

```bash
git show --stat --format= <commit> | grep -E "packages/(core|gateway|connector-)"   # must print nothing
pnpm check:boundaries                                                                 # the pack's edges
grep -rniE '<product>' packages/contracts packages/pack-sdk packages/core packages/db --include='*.ts'  # nothing
```

If the pack seems to need a core change, stop: it means a contract is missing. Raise it with `update-plan`
instead of special-casing the product in core.
