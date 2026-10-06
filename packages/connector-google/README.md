# `@ads/connector-google`

**Job:** The Google Ads READ client (implements `PlatformReadClient`). Built in M03.

**May depend on:** `@ads/contracts`; `@ads/connector-testing` as a devDependency.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).

## What's here

| File | What |
|---|---|
| `src/version.ts` | `GOOGLE_ADS_API_VERSION` (`v25`): the single pin; the scope, token endpoint and Explorer quota |
| `src/transport.ts` | `GoogleAdsClient`: REST `googleAds:searchStream` on `fetch`, `login-customer-id`, retries, the quota meter hook; no developer token (D-070, D-072) |
| `src/tokens.ts` | `AccessTokenProvider`: a service account's key file (signed JWT) or a login's refresh token; outside the recorded `fetch` |
| `src/credential.ts` | the vault credential shapes (`service_account` key file, `authorized_user`) |
| `src/gaql.ts` | the GAQL builder: allowlisted resources and fields, checked literals; no free-form GAQL |
| `src/client.ts` | `GoogleReadClient`: account info, entities, metrics, search terms, click ids, snapshots, trust signals, manager → client resolution; `snapshotOf` |
| `src/status.ts` | `status` + `primary_status` → normalised status (BLUEPRINT §5.7) |
| `src/money.ts` | micros strings, and conversion-value doubles → micros |
| `src/quota.ts` | `quotaDay` (UTC) and the sync's soft cap; the meter itself is in `@ads/core` (it needs the database) |
| `fixtures/google/` | hand-written cassettes; `recorded/` for real ones |
| `scripts/record.ts` | `RECORD=1 GOOGLE_CREDENTIAL=… pnpm --filter @ads/connector-google record --account … [--manager …]` |
| `test/live.test.ts` | a smoke test against the real API, skipped unless `LIVE=1` |

Keywords are `<adGroupId>~<criterionId>`. Choices and their reasons: D-073. Fixture workflow: the `record-fixture` skill.
