# M02 — Meta read connector

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-02 |
| **Finished** | 2026-10-02 (cloud part) |
| **PRs** | [#6](https://github.com/marcustanforwork/agenticAdsManager/pull/6) |

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
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. Graph client: typed fetch, pagination, `appsecret_proof`, and back-off driven by the rate-limit headers. The API version is pinned in one constant.
  - done: `packages/connector-meta/src/graph.ts` (`GraphClient`, `parseUsage`), `src/version.ts` (`GRAPH_API_VERSION = 'v26.0'`). Cursor paging; a next page without a cursor is refused (never a silent partial list). Throttling waits for Meta's estimate or an exponential back-off, at most 60 s, else `MetaRateLimitError`; 10 s pause at 90% usage; only network failures, timeouts (60 s per request), 5xx and transient codes are retried. Tests: `test/graph.test.ts` (20).
- [x] 2. Read methods:
  - `getAccountInfo` (timezone, currency, spending limit and the amount spent against it: `spend_cap` / `amount_spent`, verify the field names);
  - `listEntities` for campaigns, ad sets and ads, with status normalisation;
  - `getMetricsDaily` at campaign, ad set and ad level, recording the attribution settings;
  - `snapshot`;
  - `trustSignals` (dataset events received in the last 7 days).
  - done: `src/client.ts` (`MetaReadClient`, `snapshotOf`), `src/status.ts`, `src/events.ts`, `src/credential.ts`. Field names checked against the docs via search (GOTCHAS): `spend_cap` "0" = no limit; both in minor units. Clicks = `inline_link_clicks`. Conversions = the KPI stage's Meta event action types. Each metric row records `attribution_setting`. The dataset signal uses `/{dataset}/stats` (7 days) and `last_fired_time`. Tests: `test/client.test.ts` (18), `test/status-events.test.ts` (4).
- [x] 3. Exact money conversion (§3.1).
  - done: `src/money.ts` on top of the contracts' `decimalToMicros` / `metaMinorToMicros`; only confirmed currency offsets (SGD and other 100-offset currencies). Property tests: `test/money.test.ts` (6).
- [x] 4. `packages/connector-testing`:
  - `RECORD=1` writes responses to `fixtures/meta/*.json`;
  - redaction removes tokens, `appsecret_proof`, and any names or emails;
  - a replayer serves the fixtures in tests.
  - done: `packages/connector-testing/src/{cassette,redact,replay,record}.ts` (tests `test/testing.test.ts`, 7). The recording command is `RECORD=1 META_CREDENTIAL=<token file> pnpm --filter @ads/connector-meta record --account act_…` (`scripts/record.ts`, logic in `scripts/recordFixtures.ts`), writing `fixtures/meta/recorded/` plus a manifest; `test/recorded.test.ts` replays them automatically once they exist, and a round-trip test records from the hand-written fixtures and replays the result.
- [x] 5. `ads sync --product snappool --platform meta --dry` prints what would be stored.
  - done: `dryRunSync` in `packages/core/src/sync/dryRun.ts`; the CLI in `apps/worker/src/cli.ts`. Prints a JSON report (counts, totals, trust signals; no names); exit code 1 if any account fails. Also added `ads accounts link | list | set-status` (`apps/worker/src/accounts.ts`), so an account can be linked for the live steps, and a `pnpm --filter @ads/app-worker ads …` script to run the CLI from the repo. Tests: `packages/core/test/dryRun.test.ts` (6), `apps/worker/test/sync.test.ts` (3), `apps/worker/test/accounts.test.ts` (2).

## Tests
- [x] Replay tests for every method. (`client.test.ts`; `recorded.test.ts` for the real fixtures)
- [x] Pagination. (`graph.test.ts`; `entities.json` spans two pages)
- [x] Rate-limit back-off. (`graph.test.ts`: exponential, Meta's estimate, give-up, 429, slow-down)
- [x] Restatement: a later fixture changes an earlier day. (`metrics-campaign-v1.json` → `-v2.json`)
- [x] Money-conversion property tests. (`money.test.ts`)
- [x] **Redaction:** no token pattern appears in any fixture file. (`fixtures.test.ts` scans every file; `testing.test.ts`)

## Done when (cloud)
- [x] All replay tests are green.
  - evidence: `pnpm test` → `Test Files 36 passed (36)`, `Tests 466 passed | 1 skipped` (the skipped one waits for the recorded fixtures).

## Done when (live, run by Marcus)
- [ ] Real fixtures are recorded and committed.
- [ ] `ads sync --dry` against SnapPool's Meta account finishes in under 60 s.
- [ ] A linked property Meta account either syncs or is marked `paused`.

### Live steps for Marcus
**Before you start:** setup task **T4** (read side: a system-user token with `ads_read`, the app secret, the dataset id) and the **M01a live steps 1–4** (the Neon dev branch migrated and seeded). These steps use Doppler's `dev` config and the Neon **dev** branch; production isn't touched. Use read credentials only.

1. On the SER9 (or any machine with the repo): `git pull` on `main`, then `pnpm install`.
2. Make a read key for dev: `echo "read-v1:$(openssl rand -base64 32)"`, and paste the output into the Doppler dashboard as `VAULT_READ_KEY` in the `dev` config. (Never into the repo or a chat.)
3. Make a token file **outside the repo**, e.g. `~/meta-read.json`, containing `{ "accessToken": "<system-user token>", "appSecret": "<app secret>" }`, then `chmod 600 ~/meta-read.json`.
4. Link SnapPool's ad account: `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads accounts link --product snappool --platform meta --account act_<id>`
   - expect: `linked meta:act_<id> to snappool`
5. Store the token: `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads credentials put --account meta:act_<id> --role read < ~/meta-read.json`
   - expect: `stored the read credential for meta:act_<id> (sealed with read-v1)`
6. Dry sync, timed: `time doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads sync --product snappool --platform meta --dry`
   - expect: a JSON report with `"outcome": "read"`, `"timezoneMatchesProduct": true`, and `real` under 1 minute. A warning about "no Meta route for the KPI stage" is expected until M05a sets the conversion routes.
   - report back: paste the JSON and the `real` time. It has counts only, no names or tokens.
7. Record real fixtures: `RECORD=1 META_CREDENTIAL=~/meta-read.json pnpm --filter @ads/connector-meta record --account act_<id> --dataset <dataset id> --events CompleteRegistration`
   - expect: a summary ending with `"wrote": ".../fixtures/meta/recorded"`. Then `pnpm test` must stay green.
   - then: `git switch -c m02/recorded-fixtures && git add packages/connector-meta/fixtures/meta/recorded && git commit -m "test(m02): recorded Meta fixtures" && git push -u origin m02/recorded-fixtures`, and tell Claude. The files are redacted and scanned; Claude checks them again before merging.
8. Property account: if property-sg has a Meta ad account, link it and mark it paused:
   `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads accounts link --product property-sg --platform meta --account act_<id>`, then `… ads accounts set-status --product property-sg --platform meta --account act_<id> --status paused`, then `… ads sync --product property-sg --platform meta --dry`
   - expect: that account shows `"outcome": "skipped"`, `"detail": "account is paused"`. No property account: just say so.
9. Delete the token file: `rm ~/meta-read.json`.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- **Graph API version:** `v26.0` (released 2026-07-29), pinned in `packages/connector-meta/src/version.ts`. v26's breaking changes apply to every version from **2026-10-27**; the client already avoids them (`date_format`, root `?ids=`). Plan the next upgrade when Meta announces v26's end date or ships v27 (GOTCHAS row, re-check 2026-11-02). Upgrading = change the constant, re-record, fix differences (`record-fixture` skill).
- **Ad set ↔ `ad_group`:** a Meta ad set is `ad_group` everywhere (entity type, metric level `adset`, parent of an ad). Meta has no keywords or budget objects: `listEntities`/`getMetricsDaily` return nothing for them.
- **Status table:** `META_STATUS_TABLE` in `src/status.ts` equals BLUEPRINT §5.7; anything else is `unknown`. Checked against the docs; the recorded fixtures confirm it.
- **For M04 (sync stage):** start from `dryRunSync` (`core/src/sync/dryRun.ts`): it already resolves accounts, opens the credential, computes the windows in the account timezone and reads every level. Store snapshots with `snapshotOf(record)` (no extra API call; the same hash as `snapshot(ref)`). **Entities missing from a full listing:** Meta's edges may leave out archived and deleted objects (UNVERIFIED, GOTCHAS), while insights still report their spend; treat a known entity missing from a listing as possibly removed and confirm with `snapshot(ref)` (fetch by id), and create metric rows only for entities you know (or fetch unknown ids first). `trustSignals` re-reads the account (one extra call per account; kept, so the method stands alone). The spending-limit check (D-063) uses `spendCapMicros` / `amountSpentMicros`.
- **For M05a (SnapPool pack):** platform conversions come from the Meta feedback routes of the **primary KPI stage** (`metaReadConfig`); without one, the sync warns and reads 0. SnapPool's defaults are `signup → CompleteRegistration` (SNAPPOOL-TRACKING).
- **For M03 (Google read):** reuse `@ads/connector-testing` (cassettes, replayer, recorder, redactor) and copy the layout: `fixtures/google/`, a `record` script, `test/recorded.test.ts`, `test/fixtures.test.ts`.

## Skills to create
- [x] `record-fixture` (`.claude/skills/record-fixture/SKILL.md`), created from the real code.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Read connector only; GET only; no write package touched |
| 2 | No product logic in shared code | yes | No product names in `connector-*`/`core` code (grep clean); conversions come from settings |
| 3 | AI calls through core/model | yes | No AI calls |
| 4 | The AI never supplies decision numbers | yes | All figures come from the platform via SQL-bound code |
| 5 | Untrusted text is data | yes | Names and statuses are stored and counted, never interpreted; unknown statuses → `unknown` |
| 6 | Money is bigint micros / decimal strings | yes | Exact conversions, property-tested; floats only for counts (never money) |
| 7 | Every write action has an undo and a test | yes | No write actions added |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No guards added |
| 9 | Surfaces only record intent | yes | `ads sync --dry` reads only; `ads accounts` is setup like `ads credentials` (D-069) |
| 10 | apps/web depends only on contracts + db | yes | Untouched |
| 11 | product_id + an index on product-scoped tables | yes | No schema change |
| 12 | No state outside Postgres | yes | Fixtures are test data; the client caches the currency per instance only |
| 13 | No secrets or personal data | yes | Redactor + scanner on every fixture; token grep clean; errors scrubbed, name fields only |
| 14 | No production write capability outside the gateway | yes | Read token only (`ads_read`) |
| 15 | Cut items moved at most once | yes | Nothing cut |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-069), GOTCHAS updated |

## Evidence
- `pnpm typecheck` → `Tasks: 17 successful, 17 total`
- `pnpm lint` → clean; `pnpm check:boundaries` → `check-boundaries: OK (17 packages)`, `no dependency violations found`
- `pnpm format:check` → `All matched files use Prettier code style!`
- `pnpm test` → `Test Files 36 passed (36)`, `Tests 466 passed | 1 skipped (467)`
- `pnpm build` → `Tasks: 17 successful, 17 total`
- Preflight greps: no write-connector dependency, no product names in shared code, no token pattern, no email in fixtures.

## Notes and surprises
- 2026-10-02: Marcus confirmed M01b is complete; the M00 and M01a live-step checklists stay unticked (he hasn't run them).
- 2026-10-02: code review (high) over the milestone diff found 9 items. Fixed 7: a next page without a cursor now throws instead of returning a partial list; a failure while the body downloads is retried; conversions count only the primary KPI stage (no double counting across funnel stages); a Meta route without `eventName` now warns; replay clients never sleep for real; no hashing just to count; the date helpers moved to contracts (`localDate`, `minusDays`). Not fixed: archived/deleted listing (needs the live recording; left for M04, see Leave behind); `trustSignals` re-reading the account (one call, kept for a self-contained method).
- 2026-10-02: a **second code review (high)** covered the code added after the first one (`c258803..HEAD`: the review fixes, `ads accounts`, the record argv handling). 9 candidates. Fixed 7:
  - the trust check falls back to any Meta dataset when the KPI stage isn't routed to Meta (the first fix had dropped it);
  - `minusDays` refuses impossible days such as 2026-02-30;
  - `ads … -- …` through pnpm works;
  - `ads accounts` checks its arguments before opening the database;
  - the worker CLI reuses `withDatabase` from `@ads/vault`;
  - the account-id formats live once, in contracts (`ACCOUNT_ID_PATTERNS`);
  - `listAccounts` has a stable order.

  Not changed:
  - a next page without a cursor still fails the account read, on purpose: a silently truncated list is worse, and the live recording shows whether Meta ever does this;
  - two `ads accounts link` runs racing each other is unrealistic for a hand-run setup command.
- 2026-10-02: there was no way to link an ad account to a product, so the live steps couldn't work. Added `ads accounts link | list | set-status` (setup, D-069).
- 2026-10-02: Graph API **v26.0** is current (released 2026-07-29). Its breaking changes apply to **every** version from 2026-10-27: a request carrying `date_format` errors, and root `GET /?ids=` errors. The client never sends either. Details in GOTCHAS.
