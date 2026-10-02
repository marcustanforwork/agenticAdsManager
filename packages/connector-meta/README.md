# `@ads/connector-meta`

**Job:** The Meta Marketing API READ client (implements `PlatformReadClient`). Built in M02.

**May depend on:** `@ads/contracts`; `@ads/connector-testing` as a devDependency.

The rules are BLUEPRINT §2, enforced by `pnpm check:boundaries` (see `scripts/boundary-rules.mjs`).

## What's here

| File | What |
|---|---|
| `src/version.ts` | `GRAPH_API_VERSION` (`v26.0`): the single pin |
| `src/graph.ts` | `GraphClient`: GET, `appsecret_proof`, cursor pagination, rate-limit back-off (`parseUsage`) |
| `src/client.ts` | `MetaReadClient`: `getAccountInfo`, `listEntities`, `getMetricsDaily`, `snapshot`, `trustSignals`; `snapshotOf` |
| `src/money.ts` | exact minor-unit and decimal conversions; confirmed currency offsets only |
| `src/status.ts` | `effective_status` → normalised status (BLUEPRINT §5.7) |
| `src/events.ts` | Meta event names → insights action types |
| `src/credential.ts` | the vault credential shape: `{ accessToken, appSecret }` |
| `fixtures/meta/` | hand-written cassettes; `recorded/` for real ones |
| `scripts/record.ts` | `RECORD=1 META_CREDENTIAL=… pnpm --filter @ads/connector-meta record --account act_…` |

Ad set = `ad_group`. Choices and their reasons: D-069. Fixture workflow: the `record-fixture` skill.
