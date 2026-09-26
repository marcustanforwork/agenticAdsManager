# M01b — Queue, leader lock, vault, request processor

| | |
|---|---|
| **Status** | done (no live steps) |
| **Phase** | 0 |
| **Started** | 2026-09-25 |
| **Finished** | 2026-09-25 |
| **PRs** | [#5](https://github.com/marcustanforwork/agenticAdsManager/pull/5) |

## Goal
The background-job plumbing, the credential vault, and the single processor for everything a human asks for.

## Needs
- [x] M01a: merged (PR #4). Its live steps (Neon migrate + seed, T2 + T3) are **not done yet**. They don't block M01b, whose work is cloud-only against a local test database.

## Read first
- BLUEPRINT §3.8 (`OperatorRequest`) and §5.2–5.5; M01a's milestone file ("Leave behind").

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 1 queue (in `@ads/db`, see the notes) → 2 leader lock → 3 vault → 4 CLIs → 5 request processor → 6 recovery skeleton. Each step leaves the tree green and is committed and pushed.
- Cut first, if behind at ~300k: master-key rotation (keep `master_key_id`).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. `core/queue`: enqueue, claim, heartbeat, complete, fail with backoff, reclaim expired; two queues; priorities; NOTIFY wake-ups with a polling fallback.
  - notes: this lives in **`@ads/db`** (`src/queue/`), not in `core`. The gateway app needs the queue too, and the gateway may not depend on `core` (BLUEPRINT §2). Recorded as D-068.
  - done: `packages/db/src/queue/{jobs,listener,runner}.ts`; tests `packages/db/test/queue.test.ts` (12) and `runner-leader.test.ts`. A claim counts as an attempt, so a job that keeps crashing its process still reaches `max_attempts`. A job that fails for good adds a `job_failed` notification (the alert). `startQueueRunner` runs one job at a time, with heartbeats, a LISTEN wake-up and a 30 s poll.
- [x] 2. The leader-lock helper (§5.2).
  - notes: also in `@ads/db` (`src/queue/leader.ts`), next to the queue's other connection-level plumbing.
  - done: `contendForLeadership({ url, lockKey, retryMs })`; tested in `runner-leader.test.ts` (the second contender waits; a killed connection loses leadership and Postgres frees the lock).
- [x] 3. `packages/vault`:
  - AES-256-GCM envelope encryption with Node `crypto`;
  - `put(accountId, role, tokenJson, masterKey)`;
  - `get(accountId, role, { process, purpose }, masterKey)`, which writes a `credential_access` row;
  - master-key rotation;
  - the read key cannot open write or feedback rows.
  - done: `packages/vault/src/index.ts`, tests `packages/vault/test/vault.test.ts` (11). Master keys are `<id>:<base64 32 bytes>` with ids `read-vN` / `write-vN`; a read key is refused for write and feedback rows before the row is read, and read key bytes relabelled as a write key still can't decrypt. The ciphertexts are bound to their account and role (AAD). Rotation re-wraps the data keys in one transaction (all rows or none). **roles.sql:** `agent_gateway` gets `INSERT, UPDATE` on `credentials` (for `ads-gw credentials put` and rotation; part of D-068).
- [x] 4. CLIs: `ads credentials put --account X --role read` reads the token from **stdin**, never from arguments. `ads-gw credentials put --role write|feedback`.
  - done: `credentials put | check | rotate-key` in both CLIs (`apps/*/src/cli.ts`); shared logic in `packages/vault/src/commands.ts`. Keys come from `VAULT_READ_KEY` (ads) / `VAULT_WRITE_KEY` (ads-gw), plus `…_NEW` for rotation; the DB from `DATABASE_URL`. `--account` takes an account id, `meta:act_…`/`google:…`, or a bare external id. `check` decrypts (audited as `cli check`) and prints only the field names. Tests: `apps/*/test/credentials.test.ts`.
- [x] 5. The `core/requests` processor:
  - schema validation, actor check, freshness checks, one transaction per request, `result` written, `NOTIFY`;
  - implements `halt`, `resume_agent`, `settings_patch` (validated with `ProductSettings` and tighten-only) and `brief_feedback`;
  - other kinds are refused with "not available yet (M-number)".
  - done: `packages/core/src/requests/{processor,handlers,settingsPatch}.ts`; tests `packages/core/test/requests.test.ts`. Allowed actors come from `OPERATOR_ACTORS` (comma-separated, e.g. `telegram:<id>,cli:marcus`; kept in Doppler). The patch merges plain objects key by key and replaces anything else (null unsets); unknown keys are refused by name. Tighten-only is checked against the core defaults **and each platform's defaults** (a product override of 25% is refused because Meta's default is 20%); M05a adds the pack layer. Halt all moves only `active` products (dormant stays dormant); resume moves only `halted` ones. A handler fault (not a refusal) rolls back and leaves the request queued for the next pass. A request naming an unknown product can't be recorded at all (the foreign key).
- [x] 6. `core/recovery` skeleton: reclaim leases, re-queue stuck requests. Cycles are added in M04.
  - done: `recoverWorker(db, ctx)` in `packages/core/src/recovery.ts`: reclaims the worker queue's expired leases, drains queued requests, and queues a `worker_recovered` note if it did anything. A crash can't leave a request half-done (it's processed in the transaction that locks it), so "re-queue stuck requests" = process what is still queued.

## Tests
- [x] Queue: two claimers never get the same job; an expired lease is reclaimed; failures back off; `max_attempts` leads to `failed`; priority order is respected.
- [x] Leader lock: a second contender waits; the lock is released on disconnect.
- [x] Vault: round-trip works; a wrong key fails; the read key can't open write rows; every `get` writes an audit row; rotation works.
- [x] Requests: halt and resume; a valid `settings_patch` creates a new version; a looser guard override is refused; a stale `baseVersion` is refused; an unknown actor is refused.

## Done when (cloud)
- [x] All tests are green.
  - evidence: `pnpm test` → `Test Files 25 passed (25)`, `Tests 385 passed (385)` (2026-09-25, after the review fixes).

## Done when (live, run by Marcus)
- None. Tokens are loaded with these CLIs in the M02 and M03 live steps.

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- **How to add a new operator request kind** (e.g. M05a `facts_put`, M09a `approve`):
  1. The contract already lists every kind (`OperatorRequest` in `packages/contracts/src/proposals.ts`). If you need a new one, add it there first.
  2. Write the handler in `packages/core/src/requests/handlers.ts`: `(tx, request, row) => Promise<result>`. It runs in the processor's transaction, inside a savepoint. To **refuse**, throw `RefusedError`, `StaleVersionError`, `NotFoundError`, `GuardLoosenedError` or `SettingsPatchError`, and the message is shown to Marcus. Any other error is a fault: the request stays queued (or, for Telegram/CLI, the submit fails and nothing is recorded).
  3. Add it to `HANDLERS` and remove it from `NOT_AVAILABLE_UNTIL`.
  4. Put freshness checks (version, action hash, expiry) inside the handler, and write everything in the given `tx`.
  5. Spend-reducing work for the gateway: `enqueueJob(tx, { queue: 'gateway', kind, priority: 100, ... })`, which wakes the gateway at commit.
  6. Test it in `packages/core/test/requests.test.ts`: `done`, each refusal, and that a refusal changes nothing.
- **Running a queue** (M04 cycles, M07 services, M11b gateway): `startQueueRunner({ db, listenUrl: <direct URL>, queue, handlers })` from `@ads/db`. Handlers get `{ signal }`: stop when it aborts (lease lost or shutdown). Throw `PermanentJobError` for failures that retrying can't fix. The worker's `main.ts` doesn't start a runner, a leader lock, or `recoverWorker` yet. M04/M07 wire them in, with `OPERATOR_ACTORS` and `DATABASE_URL` from Doppler.
- **Leader:** `contendForLeadership({ url: <direct URL> })`: only the leader runs cron and polls Telegram (M07, M09a).
- **Vault:** `get(db, accountId, role, { process, purpose }, key)` returns the token JSON unvalidated; each connector validates it with its own zod schema (M02, M03). Keys: `VAULT_READ_KEY` in the worker's Doppler config, `VAULT_WRITE_KEY` in the gateway's only. Make one with `echo "read-v1:$(openssl rand -base64 32)"`.
- **Tokens are loaded in the M02/M03 live steps:** `doppler run --config worker -- ads credentials put --account meta:act_… --role read < token.json`, then `ads credentials check …` (prints only field names).
- **For M10a:** bind each request to the DB role that inserted it (added to M10a's Builds in BLUEPRINT, D-068). Today the processor trusts the `actor` column.
- **For M05a:** add the pack's guard overrides as a layer in `checkGuardOverridesTightenOnly` (`packages/core/src/requests/settingsPatch.ts`).

## Skills to create
- None listed.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | No ad-platform calls; nothing depends on a `*-write` package outside the gateway (`check:boundaries` OK). |
| 2 | No product logic in shared code | yes | No product names or pack ids in db, vault, core; tests use `test-pack`. |
| 3 | AI calls through core/model | yes | No AI calls. |
| 4 | The AI never supplies decision numbers | yes | No AI. Guard numbers come from settings, checked tighten-only. |
| 5 | Untrusted text is data | yes | Request payloads are zod-validated; patches can't add unknown or `__proto__` keys; SQL is parameterised; LISTEN channels escaped. |
| 6 | Money is bigint micros / decimal strings | yes | Only through `ProductSettings` (MicrosJson); no floats for money. |
| 7 | Every write action has an undo and a test | yes | No write actions added. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes | No new guards; tighten-only reuses `mergeGuardsTightenOnly` (property-tested in contracts) and has example tests here. |
| 9 | Surfaces only record intent | yes | CLIs only store credentials (setup, not an ad change). Requests go through the one processor. |
| 10 | apps/web depends only on contracts + db | yes | Untouched. |
| 11 | product_id + an index on product-scoped tables | yes | No new tables. |
| 12 | No state outside Postgres | yes | Queue, leases, leader lock and audit are all in Postgres. |
| 13 | No secrets or personal data | yes | Keys and actor ids come from env (Doppler); tokens read from stdin only and never printed; test keys are random per run. |
| 14 | No production write capability outside the gateway | yes | The write key opens write/feedback rows; the worker CLI accepts only a read key and the read role (tested). |
| 15 | Cut items moved at most once | yes | Nothing cut (rotation was built). |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-068), GOTCHAS updated at close. |

## Evidence
- `pnpm typecheck` → `Tasks: 17 successful, 17 total`
- `pnpm lint` → ok · `pnpm check:boundaries` → `check-boundaries: OK (17 packages)`, `no dependency violations found (121 modules, 290 dependencies cruised)`
- `pnpm test` → `Test Files 25 passed (25)`, `Tests 385 passed (385)`
- `pnpm format:check` → `All matched files use Prettier code style!`

## Notes and surprises
- 2026-09-25: postgresql.org is blocked by the cloud proxy. The Postgres behaviours M01b relies on (NOTIFY is delivered at commit; a session advisory lock is released when its connection closes) are proven by this milestone's tests against Postgres 16 instead.
- 2026-09-25: **code review (high), 10 findings, all confirmed and fixed** (commit `7c3c0a0`):
  1. the runner never reclaimed expired leases (only at startup), so it now reclaims on every poll;
  2. the request drain spun on a request another worker held, so it now selects with SKIP LOCKED;
  3. a failed `completeJob` counted as a failed attempt (and would re-run finished work), so completion is now outside the handler's try;
  4. a failing `failJob` could escape the loop, so bookkeeping errors are now logged, never thrown;
  5. the runner claimed kinds it couldn't run, so it now claims only kinds it has handlers for;
  6. heartbeat errors never stopped the handler, so it now aborts once the lease may have expired;
  7. shutdown used up an attempt, so a new `releaseJob` hands the job back uncounted;
  8. the leader had no keepalive, so it now pings and uses TCP keepalive on both sides;
  9. submit raced with the drain, so recording and processing now happen in one transaction;
  10. the CLI code was duplicated, so it now lives in `@ads/vault` `cli.ts`.

  New tests cover 1, 2, 5, 7 and 9.
- 2026-09-25: **security review: no findings** at the reporting bar. It checked crypto (a fresh IV and data key each time, AAD binding, the key-class check before any read), secrets exposure, SQL injection, and request validation. One design point: the processor trusts the `actor` column that the inserting role sets. It was moved to M10a in the plan (D-068), and it can't be exploited today because only the worker and the CLIs insert rows.
- 2026-09-25: **rotation is all-or-nothing:** one row that fails to open with the old key stops the whole rotation (tested). The error says which key; fix or re-`put` that credential, then rotate again.
