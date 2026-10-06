# M03 — Google read connector

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-10-06 |
| **Finished** | 2026-10-06 (cloud part) |
| **PRs** | [#7](https://github.com/marcustanforwork/agenticAdsManager/pull/7) (merged 2026-10-06) |

## Goal
Typed, deterministic, quota-aware Google Ads reads.

## Needs
- [ ] T5 (as rewritten for D-070): **not done yet.** Needed for the live steps only. Explorer access, which comes with enabling the Google Ads API in the Cloud project, is enough. The cloud work builds against Google's documented REST shapes with hand-written fixtures (D-072).
- [ ] Q13 (D-071, service accounts vs logins): **open.** It only changes the sign-in piece, so both token providers are built (service-account key file, or a login's refresh token) and the credential's `type` picks one.
- [x] M02: merged (PR #6). Reuse `@ads/connector-testing` and copy its fixture layout (M02 "Leave behind").
- [ ] M01a / M00 / M02 live steps: not done yet (Marcus). They don't block M03's cloud work.

## Read first
- M02's milestone file; BLUEPRINT §3.5–3.6, §5.7, §5.8; PROPOSAL §7; D-046, D-069–D-072; Q13 (open).
- External: Google Ads API version, REST `searchStream`, errors, `login-customer-id`, quotas (checked 2026-10-06, GOTCHAS).

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 5a `connector-testing` (POST bodies and the `login-customer-id` header in cassettes; PEM and `private_key` redaction) → 1+3 transport, token providers and the GAQL builder → 2 read methods with hand-written fixtures → 4 quota accounting (core, `api_usage`) and the `login_customer_id` column → 6 `ads sync --platform google --dry` → 5b the record script, recorded-replay test and the `LIVE=1` smoke test. Each step leaves the tree green and is committed and pushed.
- Cut first, if behind at ~300k: `getSearchTerms` (moves to M04, its one allowed move); keyword-level metrics (keep ad group level).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented (took ~200k: the fact checks and reading M02's code)
  - [x] ~300k built, typecheck green (~350k, nothing cut)
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. Transport and sign-in (D-070, D-071, D-072):
  - a small REST client on `fetch`, like M02's `GraphClient`: `googleAds:searchStream` for reads; the API version pinned in one constant; **no developer token**;
  - one token-provider interface; the credential comes from the vault (`read` role): the **Read only** service account's key file (D-071, if Q13 approves it), or the read-only Google login's refresh token plus the OAuth client from Doppler (D-046). The token exchange happens outside the recorded `fetch`;
  - the manager account's id in the `login-customer-id` header (decide where it's stored, e.g. a nullable `accounts` column via the `db-migration` skill);
  - resolution from manager account to client account.
  - done: `src/transport.ts` (`GoogleAdsClient`: `searchStream`, `listAccessibleCustomers`, retries for network errors, 5xx and short rate limits, never the daily quota; one 401 refresh; scrubbed errors), `src/version.ts` (`v25`), `src/tokens.ts` (service-account JWT, refresh token, static), `src/credential.ts` (the vault shapes; only Google's token endpoint). Manager: `accounts.login_customer_id` (migration `0001`), `ads accounts link --manager <id>` / `--no-manager`; `findManagerFor` and `listClientAccounts` resolve manager → client. Tests: `test/transport.test.ts`, `test/tokens.test.ts`.
- [x] 2. Read methods:
  - `getAccountInfo`;
  - `listEntities` for campaigns, ad groups, keywords and budgets (with `explicitly_shared`);
  - `getMetricsDaily` at campaign, ad group and keyword level, over 28 days;
  - `getSearchTerms`;
  - `getClickIds` (`click_view`, one day per query);
  - `snapshot`;
  - `trustSignals`: conversion actions exist, conversions were recorded in the last 7 days, and auto-tagging is on.
  - done: `src/client.ts` (`GoogleReadClient`, `snapshotOf`), `src/status.ts`, `src/money.ts`. Keywords are `<adGroupId>~<criterionId>`; campaigns carry their budget; KPI conversions by `segments.conversion_action`, kept by action id. Tests: `test/client.test.ts`.
- [x] 3. A GAQL builder with an allowlist of resources and fields. No free-form GAQL.
  - done: `src/gaql.ts` (`GAQL_ALLOWLIST`, `gaql`, `lit.*`; a literal not made by `lit` is refused). Tests: `test/gaql.test.ts`.
- [x] 4. Quota accounting in `api_usage`, with a soft cap (Explorer allows 2,880 operations a day **per Cloud project**, so the cap sums every Google account for the day).
  - done: the `QuotaMeter` hook in the transport (after sign-in, before every request, retries included); `apiUsageMeter` in `core/src/sync/quota.ts` (one transaction under an advisory lock; `sumApiUsage` over every Google account for the UTC day; soft cap `GOOGLE_SYNC_SOFT_CAP` = 2,000 of Explorer's 2,880). Tests: `core/test/dryRunGoogle.test.ts`, `db/test/plumbing.test.ts`.
- [x] 5. Fixtures in `fixtures/google/*.json`, recorded via `connector-testing`. Extend its redactor and scanner to PEM private keys and `private_key` fields (service-account key files).
  - done: 11 hand-written cassettes in `fixtures/google/`; `connector-testing` matches the POST body and `login-customer-id` (never `authorization`) and redacts PEM keys, `private_key`/`assertion`/`id_token`, JWTs, gclids and search terms, including inside resource names. Recorder: `scripts/record.ts` + `scripts/recordFixtures.ts`; `test/recorded.test.ts` (skipped until recorded) and a record → replay round trip; `test/fixtures.test.ts` scans every file.
- [x] 6. `ads sync --product snappool --platform google --dry`.
  - done: `core/src/sync/dryRunGoogle.ts` (entities, 28 days of metrics at 3 levels, search terms, yesterday's click ids, trust signals; counts only; finds the manager if none is stored). The report types moved to `core/src/sync/report.ts`. Tests: `core/test/dryRunGoogle.test.ts`, `apps/worker/test/sync.test.ts`.

## Tests
- [x] Replay tests for every method.
- [x] Micros property test.
- [x] The quota cap.
- [x] Restatement overwrites old values.
- [x] Shared budgets are flagged.
- [x] Redaction: no private key or access token in any fixture file.
- [x] A live smoke test, skipped unless `LIVE=1`.

## Done when (cloud)
- [x] All replay tests are green.
  - evidence: `pnpm test` → `Test Files 44 passed | 1 skipped (45)`, `Tests 563 passed | 3 skipped (566)` (skipped: the Meta and Google recorded fixtures, and the `LIVE=1` smoke test).

## Done when (live, run by Marcus)
- [ ] `ads sync --dry` against SnapPool's Google account (or the test account) prints entities, 28 days of metrics and search terms, in under 60 s and under 200 operations.

### Live steps for Marcus
**Before you start:** setup task **T5** (the Cloud project with the Google Ads API enabled; SnapPool's ad account under the manager account) and your answer to **Q13**. With A (recommended): the `ads-agent-read` service account added to the manager account with **Read only** access, and its key file downloaded. With B: a read-only Google login's `{ "type": "authorized_user", "client_id", "client_secret", "refresh_token" }`. You also need the **M01a live steps 1–4** and M02's step 2 (`VAULT_READ_KEY` in Doppler `dev`). These steps use Doppler's `dev` config and the Neon **dev** branch, with read credentials only.

1. `git pull` on `main`, then `pnpm install`.
2. Apply the new migration (it adds `accounts.login_customer_id`): `doppler run --config dev -- pnpm --filter @ads/db db:migrate`
   - expect: `migrations and roles.sql applied`.
3. Put the key file **outside the repo**, e.g. `~/google-read.json`, then `chmod 600 ~/google-read.json`.
4. Link SnapPool's Google ad account through the manager account (both ids are 10 digits, no dashes):
   `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads accounts link --product snappool --platform google --account <client id> --manager <manager id>`
   - expect: `linked google:<client id> to snappool through manager <manager id>`
5. Store the credential: `doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads credentials put --account google:<client id> --role read < ~/google-read.json`
   - expect: `stored the read credential for google:<client id> (sealed with read-v1)`
6. Dry sync, timed: `time doppler run --config dev -- pnpm --silent --filter @ads/app-worker ads sync --product snappool --platform google --dry`
   - expect: a JSON report with `"outcome": "read"`, `"timezoneMatchesProduct": true`, a 28-day `window`, `entities`, `metrics`, `searchTerms`, `"requests"` under 200, and `real` under 1 minute. A warning about "no Google route for the KPI stage" is expected until M05a/T11 set the conversion routes.
   - report back: paste the JSON (counts only, no names) and the `real` time.
7. Record real fixtures: `RECORD=1 GOOGLE_CREDENTIAL=~/google-read.json pnpm --filter @ads/connector-google record --account <client id> --manager <manager id>`
   - expect: a summary ending with `"wrote": ".../fixtures/google/recorded"`. Then `pnpm test` must stay green.
   - then: `git switch -c m03/recorded-fixtures && git add packages/connector-google/fixtures/google/recorded && git commit -m "test(m03): recorded Google fixtures" && git push -u origin m03/recorded-fixtures`, and tell Claude. The files are redacted and scanned; Claude checks them again before merging.
8. Optional smoke test: `LIVE=1 GOOGLE_CREDENTIAL=~/google-read.json GOOGLE_ACCOUNT=<client id> GOOGLE_MANAGER=<manager id> pnpm test packages/connector-google/test/live.test.ts` → 1 test passed.
9. Delete the key file: `rm ~/google-read.json`. (Keep the original download somewhere safe, or delete the key in the Cloud console and make a new one when needed.)

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- **Google Ads API version:** `v25` (v25.2 released 2026-09-23; sunsets Aug 2027), pinned in `packages/connector-google/src/version.ts`. Minor releases share the endpoint. Check for v26 (expected October 2026) by **2026-11-05** (GOTCHAS row). Upgrading = change the constant, re-record, fix differences (`record-fixture` skill).
- **For M04 (sync stage):** start from `dryRunGoogle` (`core/src/sync/dryRunGoogle.ts`), which resolves the manager, opens the credential, meters the quota and reads every level. Store snapshots with `snapshotOf(record)` (no extra call). Store `findManagerFor`'s answer in `accounts.login_customer_id` when it was found (`setAccountLoginCustomerId`). Click ids: one `getClickIds` call per day not yet synced, at most 90 days back. Search terms are untrusted text (invariant 5). `trustSignals` re-reads the account (one operation; kept so the method stands alone). The two dry-run loops (`dryRun.ts`, `dryRunGoogle.ts`) should become one sync stage.
- **For M05a (SnapPool pack):** Google platform conversions come from the Google feedback routes of the primary KPI stage (`destinationId` = the conversion action id, digits); without one, the sync warns and reads 0.
- **For M13 (Google writes):** reuse `GoogleAdsClient` (add a `mutate` call with `validateOnly`), the token providers (the `write` role) and the GAQL builder for read-backs. Keep sign-in outside the recorded `fetch`.
- **Unverified until the live recording (GOTCHAS):** errors inside a 200 stream, zero metrics omitted, `segments.conversion_action` on `keyword_view`, whether a client's `conversion_action` listing shows the manager's actions, and the quota day (sliding 24 h?).

## Skills to create
- None listed. `record-fixture` now has the Google steps and redaction rules.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | Read connector only; `searchStream` is a read (POST carries the query); no write package touched |
| 2 | No product logic in shared code | yes | No product names in `connector-*`/`core` code; conversion actions come from the settings |
| 3 | AI calls through core/model | yes | No AI calls |
| 4 | The AI never supplies decision numbers | yes | All figures come from the platform |
| 5 | Untrusted text is data | yes | Keyword text and search terms are stored and counted, never interpreted; GAQL is built only from the allowlist, never from platform text |
| 6 | Money is bigint micros / decimal strings | yes | Micros strings → bigint, property-tested; the conversion-value double is converted once, exactly (GOTCHAS) |
| 7 | Every write action has an undo and a test | yes | No write actions added |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No guards added; the GAQL literals have pass/fail tests |
| 9 | Surfaces only record intent | yes | `ads sync --dry` reads only; `ads accounts link --manager` is setup like `ads accounts` (D-069) |
| 10 | apps/web depends only on contracts + db | yes | Untouched |
| 11 | product_id + an index on product-scoped tables | yes | `accounts` is already product-scoped; `api_usage` is global by design |
| 12 | No state outside Postgres | yes | The access token is cached in memory per process (like Meta's currency cache); quota counts live in `api_usage` |
| 13 | No secrets or personal data | yes | Redactor and scanner extended (keys, JWTs, gclids, search terms); test keys made at run time; gitleaks 8.24.3 clean on the branch |
| 14 | No production write capability outside the gateway | yes | Read credential only (Read only access on the manager account, D-071) |
| 15 | Cut items moved at most once | yes | Nothing cut |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-073), GOTCHAS, BLUEPRINT v3.11 updated |

## Evidence
- `pnpm typecheck` → `Tasks: 17 successful, 17 total`
- `pnpm lint` → clean; `pnpm check:boundaries` → `check-boundaries: OK (17 packages)`, `no dependency violations found`
- `pnpm format:check` → `All matched files use Prettier code style!`
- `pnpm test` → `Test Files 44 passed | 1 skipped (45)`, `Tests 563 passed | 3 skipped (566)`
- `pnpm build` → `Tasks: 17 successful, 17 total`; `pnpm --filter @ads/db db:generate` → `No schema changes`
- `gitleaks git --log-opts=origin/main..HEAD` (8.24.3) → `no leaks found`

## Notes and surprises
- 2026-10-06: code review (high) over the milestone diff: 10 candidates. Fixed 7:
  - KPI conversions are kept by action id in code, so a conversion action owned by the manager account counts (the old filter used the client's resource name);
  - `findManagerFor` skips an accessible account it can't list and keeps looking;
  - the dry sync's "store it with" hint now includes `--product`;
  - the quota check and increment run in one transaction under an advisory lock;
  - `ads accounts link --no-manager` clears a stored manager;
  - a failed sign-in no longer counts as an operation;
  - a misleading comment about rethrown errors.

  Not changed:
  - `trustSignals` re-reading the account: one operation a sync; the method stays self-contained (as Meta's);
  - the per-account loop duplicated in `dryRun.ts` and `dryRunGoogle.ts`: M04 replaces both with the sync stage;
  - the conversion-value double: Google sends a double; it's converted once, exactly, and recorded in GOTCHAS.
- 2026-10-06: self-review found that Google `resourceName`s embed personal data (a click view's gclid, a search term view's encoded term). The redactor clears them, and the scanner refuses them.
- 2026-10-06: external facts checked (GOTCHAS). Google Ads API **v25** is current (v25.2, 2026-09-23); minor releases share the major version's endpoint, so the pin is `v25`. v26 is expected in October 2026. `developers.google.com` and `developers.google.cn` are both blocked in cloud sessions; facts come from search summaries of the official pages.
