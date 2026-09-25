# M01a — Database schema and repositories

| | |
|---|---|
| **Status** | awaiting live acceptance |
| **Phase** | 0 |
| **Started** | 2026-09-25 |
| **Finished** | 2026-09-25 (cloud part) |
| **PRs** | — |

## Goal
The full schema with typed repositories and the proposal state machine, with both products seeded.

## Needs
- [x] M00: merged (awaiting its live acceptance, which M01a doesn't depend on).
- [ ] T2 + T3 (Neon project with `prod` and `dev` branches; Doppler): **only for the live steps**. Cloud work needs nothing.

## Read first
- BLUEPRINT §3.8–3.9 (proposals, approvals, state machine) and §4 (schema, roles); `packages/contracts`.
- BLUEPRINT §3.6 (undo table, fingerprint fields) and §6 "Undo", for `createUndoProposal`.

## Session plan (one session = one PR, 400–600k tokens incl. tests, review, fixes)
- Build order: 1 (schema, migration, scripts, test helper) → 2 (`roles.sql`) → 3 (repositories, in the order listed) → 4 (seed) → CI Postgres service → skill `db-migration`.
- Cut first, if behind at ~300k: the `api_usage` repository (moves to M03).
- Checkpoints (`docs/process/SESSIONS.md` §4):
  - [x] ~50k oriented
  - [x] ~300k built, typecheck green
  - [x] ~450k tests green, self-review done
  - [x] ~550k committed, pushed, handed off

## Builds
- [x] 1. Drizzle schema for every table in §4 except `source_copy`, migration `0001_init`, and the scripts `db:generate` / `db:migrate`. A test-database helper runs against local Postgres 16 (in cloud sessions, `pg_ctlcluster 16 main start`) and a service container in CI.
- [x] 2. `packages/db/sql/roles.sql`: the three database roles and their grants (§4). The test helper applies it; Marcus applies it on Neon in the live steps.
- [x] 3. Repositories as plain functions:
  - [x] products and settings, with optimistic concurrency on `settings_version` and `settings_history`;
  - [x] accounts, ad entities, snapshots (insert only if changed), metrics (upsert window), search terms, outcomes;
  - [x] cycles (`startScheduled`, `advance`, `finish`);
  - [x] findings, and proposals (create, `newVersion`, status changes checked against the §3.9 transition table);
  - [x] approvals, change log, briefs, operator requests, notifications, drift, system flags, API usage;
  - [x] `createUndoProposal(revisionId)`, which is used by both the worker and the gateway.
- [x] 4. An idempotent seed:
  - `snappool` (active) and `property-sg` (dormant), with settings taken from stub pack defaults until M05a;
  - the offering `sora-at-lakeside` (with facts `{}`);
  - `system_flags.writes_enabled = false`.

Build notes:
- 1: `packages/db/src/schema.ts`, `migrations/0000_init.sql` (drizzle-kit numbers from 0000, D-066), `drizzle.config.ts`, scripts `db:generate`, `db:migrate` (migrations + roles.sql), `db:seed`; `src/testing.ts` (`@ads/db/testing`); CI `postgres:16` service plus a "migrations match the schema" step.
- 2: `sql/roles.sql`: NOLOGIN roles, revoke-then-grant (re-runnable), view `dashboard_outcomes`. Grants the gateway needs beyond the §4 list are in D-066.
- 3: `src/repos/{products,adData,outcomes,cycles,proposals,changes,plumbing}.ts`; errors in `src/errors.ts`. The API-usage repository was built (not cut). Credentials and `credential_access` repositories belong to the vault (M01b).
- 4: `src/seed.ts` + data in `products/seed.json` (D-066). Also seeds SnapPool's own offering `snappool`.

## Tests
- [x] Every repository.
- [x] The transition table: every illegal transition throws.
- [x] The metrics upsert overwrites values and bumps `restated_at`. Snapshots are stored only when the hash changes.
- [x] A second scheduled cycle on the same day is refused.
- [x] An approval is unique per version.
- [x] Settings: a stale `baseVersion` is refused.
- [x] `createUndoProposal` builds the stored undo, with the fingerprint taken from the change's `after` state.

## Done when (cloud)
- [x] The migration and `roles.sql` apply to a fresh Postgres, the seed is idempotent, and all tests are green.
  - evidence: see **Evidence** below.

## Done when (live, run by Marcus)
- [ ] Migrations and `roles.sql` are applied to the Neon `dev` and `prod` branches, and `prod` is seeded (Marcus runs them via `doppler run`).
  - result: —

### Live steps for Marcus
Needs T2 (Neon project with `prod` and `dev` branches) and T3 (Doppler). Run on your own machine after this PR is merged; they use the Neon **owner** role, which may create tables and roles. Use the **direct** connection string (the host without `-pooler`).
1. `git pull` on `main`, then `pnpm install`.
2. In Doppler's `dev` config, add `DATABASE_URL` = the Neon **dev** branch's owner connection string.
3. `doppler run --config dev -- pnpm --filter @ads/db db:migrate`, then run it a second time.
   - expect: `migrations and roles.sql applied`, both times.
4. `doppler run --config dev -- pnpm --filter @ads/db db:seed`
   - expect: `{"productsCreated":["snappool","property-sg"],"offeringsEnsured":2,"flagsCreated":["writes_enabled"]}`
5. **Prod** (the owner string isn't kept in Doppler's service configs): `read -rs DATABASE_URL && export DATABASE_URL`, paste the Neon **prod** branch's owner connection string, press Enter. Then:
   `pnpm --filter @ads/db db:migrate && pnpm --filter @ads/db db:seed && unset DATABASE_URL`
   - expect: the same two lines as steps 3 and 4.
6. Check in the Neon SQL editor, on **prod**: `select slug, status, settings_version from products order by slug; select key, value from system_flags;`
   - expect: `property-sg | dormant | 1`, `snappool | active | 1`, and `writes_enabled | false`.
7. report back: "migrated and seeded", or paste any error. (The login roles for each service, with passwords, come in M07.)

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- **How to write a migration:** the `db-migration` skill (`.claude/skills/db-migration/SKILL.md`). In short: edit `schema.ts` → `pnpm --filter @ads/db db:generate --name <what>` → read the SQL → grants in `roles.sql` + `test/roles.test.ts`. Never edit a merged migration. CI fails if the schema and migrations disagree.
- **The transition table:** `PROPOSAL_TRANSITIONS` in `packages/db/src/repos/proposals.ts` is the one definition (matches BLUEPRINT §3.9; `pending → pending` is `newVersion`). Status changes go only through `transitionProposal` and `recordDecision`. `test/proposals.test.ts` checks all 144 status pairs.
- **The local test-database recipe:** cloud: `pg_ctlcluster 16 main start` and `su postgres -c "psql -c \"alter user postgres password 'postgres'\""` once per container; CI has a `postgres:16` service; elsewhere set `TEST_DATABASE_URL`. Tests use `createTestDatabase()` from `@ads/db/testing`: a template database (migrations + roles.sql, named by their hash) is cloned per test file.
- **For M01b:** the `jobs` table exists with no repository yet (the queue is M01b). `recordOperatorRequest` / `completeOperatorRequest` exist; claiming with SKIP LOCKED is M01b's processor. The vault writes `credentials` and `credential_access` (no repository yet). `recordDecision` does the approve/reject transaction the processor needs; `createUndoProposal(db, revisionId, { fieldsFor })` takes the gateway's `fieldsFor` from M11a.
- **For M08:** `createProposal` needs the planned `undo`; for `add_negative_keyword` the real undo (the created criterion id) is only known at apply time, and the gateway stores it in `change_log`.

## Skills to create
- `db-migration`.

## Invariants review (BLUEPRINT §8), done at close
| # | Invariant | OK? | Note |
|---|---|---|---|
| 1 | One write path | yes | `change_log` insert is granted only to `agent_gateway` (roles test). No connector-write dependency added. |
| 2 | No product logic in shared code | yes | Product names only in `products/seed.json`; preflight grep on `packages/db` is empty. |
| 3 | AI calls through core/model | yes | No AI code. |
| 4 | The AI never supplies decision numbers | yes | `findings.evidence` is typed `ComputedEvidence`, written by core from SQL. |
| 5 | Untrusted text is data | yes | Search terms stored as parameters; a test stores an injection-shaped term as plain data. |
| 6 | Money is bigint micros / decimal strings | yes | All money columns `bigint` mode `bigint`; tests assert bigint values. |
| 7 | Every write action has an undo and a test | yes (n/a) | No write actions added; `createUndoProposal` is tested for each undo kind. |
| 8 | Every guard has a property test; copy rules have pass/fail examples | yes (n/a) | No guards or copy rules. |
| 9 | Surfaces only record intent | yes | `agent_dashboard` may only insert `operator_requests` (roles test). |
| 10 | apps/web depends only on contracts + db | yes | Unchanged. |
| 11 | product_id + an index on product-scoped tables | yes | `test/migrate.test.ts` checks every table with `product_id` (only the global `jobs` is exempt). |
| 12 | No state outside Postgres | yes | |
| 13 | No secrets or personal data | yes | The only password is the throwaway local/CI `postgres`; test-traffic domains are not in the seed; `hashed_contact` is hidden from the dashboard. |
| 14 | No production write capability outside the gateway | yes | |
| 15 | Cut items moved at most once | yes | Nothing cut. |
| 16 | Memory is current | yes | NOW, LOG, DECISIONS (D-066), GOTCHAS updated. |

## Evidence
- `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm build && pnpm format:check` → exit 0; `Test Files 18 passed`, `Tests 320 passed` (230 in `packages/db`); `no dependency violations found`.
- Fresh database `ads_cli_check` with `DATABASE_URL` set:
  - `pnpm --filter @ads/db db:migrate` (twice) → `migrations and roles.sql applied` both times;
  - `pnpm --filter @ads/db db:seed` → `{"productsCreated":["snappool","property-sg"],"offeringsEnsured":2,"flagsCreated":["writes_enabled"]}`; again → `{"productsCreated":[],"offeringsEnsured":2,"flagsCreated":[]}`;
  - `products`: `property-sg|dormant|1`, `snappool|active|1`; `system_flags`: `writes_enabled|false`; roles `agent_dashboard`, `agent_gateway`, `agent_worker` exist.
- `pnpm --filter @ads/db db:generate` → `No schema changes, nothing to migrate`; adding a column without a migration makes the CI check fail (tried locally, then reverted).

## Notes and surprises
- 2026-09-25: drizzle-kit can't serialise a bigint default (`sql\`0\`` instead), and Drizzle's jsonb reader re-parses JSON strings (a stored `"true"` read back as `true`); `getFlag` reads `::text`. Both in GOTCHAS.
- 2026-09-25: the §4 grants didn't let the gateway create undo proposals, link reverted changes or halt a product; filled in (D-066).
- 2026-09-25: library choice. `drizzle-orm` **0.45.3** + `drizzle-kit` **0.31.11** (the stable `latest` tags; 1.0 is still `1.0.0-rc.4`), with `pg` **8.23.0** (node-postgres). Recorded in GOTCHAS.
