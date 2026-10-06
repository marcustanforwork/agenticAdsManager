# M03 — Google read connector

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-10-06 |
| **Finished** | — |
| **PRs** | — |

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
  - [x] ~50k oriented
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. Transport and sign-in (D-070, D-071, D-072):
  - a small REST client on `fetch`, like M02's `GraphClient`: `googleAds:searchStream` for reads; the API version pinned in one constant; **no developer token**;
  - one token-provider interface; the credential comes from the vault (`read` role): the **Read only** service account's key file (D-071, if Q13 approves it), or the read-only Google login's refresh token plus the OAuth client from Doppler (D-046). The token exchange happens outside the recorded `fetch`;
  - the manager account's id in the `login-customer-id` header (decide where it's stored, e.g. a nullable `accounts` column via the `db-migration` skill);
  - resolution from manager account to client account.
- [ ] 2. Read methods:
  - `getAccountInfo`;
  - `listEntities` for campaigns, ad groups, keywords and budgets (with `explicitly_shared`);
  - `getMetricsDaily` at campaign, ad group and keyword level, over 28 days;
  - `getSearchTerms`;
  - `getClickIds` (`click_view`, one day per query);
  - `snapshot`;
  - `trustSignals`: conversion actions exist, conversions were recorded in the last 7 days, and auto-tagging is on.
- [ ] 3. A GAQL builder with an allowlist of resources and fields. No free-form GAQL.
- [ ] 4. Quota accounting in `api_usage`, with a soft cap (Explorer allows 2,880 operations a day **per Cloud project**, so the cap sums every Google account for the day).
- [ ] 5. Fixtures in `fixtures/google/*.json`, recorded via `connector-testing`. Extend its redactor and scanner to PEM private keys and `private_key` fields (service-account key files).
- [ ] 6. `ads sync --product snappool --platform google --dry`.

## Tests
- [ ] Replay tests for every method.
- [ ] Micros property test.
- [ ] The quota cap.
- [ ] Restatement overwrites old values.
- [ ] Shared budgets are flagged.
- [ ] Redaction: no private key or access token in any fixture file.
- [ ] A live smoke test, skipped unless `LIVE=1`.

## Done when (cloud)
- [ ] All replay tests are green.

## Done when (live, run by Marcus)
- [ ] `ads sync --dry` against SnapPool's Google account (or the test account) prints entities, 28 days of metrics and search terms, in under 60 s and under 200 operations.

### Live steps for Marcus
_Written at close._

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- The pinned REST API version and the next upgrade-check date, recorded in GOTCHAS.

## Skills to create
- None listed. (`record-fixture` gains the Google steps.)

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
- 2026-10-06: external facts checked (GOTCHAS). Google Ads API **v25** is current (v25.2, 2026-09-23); minor releases share the major version's endpoint, so the pin is `v25`. v26 is expected in October 2026. `developers.google.com` and `developers.google.cn` are both blocked in cloud sessions; facts come from search summaries of the official pages.
