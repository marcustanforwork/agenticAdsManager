# M01a — Database schema and repositories

| | |
|---|---|
| **Status** | in progress |
| **Phase** | 0 |
| **Started** | 2026-09-25 |
| **Finished** | — |
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
  - [ ] ~300k built, typecheck green
  - [ ] ~450k tests green, self-review done
  - [ ] ~550k committed, pushed, handed off

## Builds
- [ ] 1. Drizzle schema for every table in §4 except `source_copy`, migration `0001_init`, and the scripts `db:generate` / `db:migrate`. A test-database helper runs against local Postgres 16 (in cloud sessions, `pg_ctlcluster 16 main start`) and a service container in CI.
- [ ] 2. `packages/db/sql/roles.sql`: the three database roles and their grants (§4). The test helper applies it; Marcus applies it on Neon in the live steps.
- [ ] 3. Repositories as plain functions:
  - [ ] products and settings, with optimistic concurrency on `settings_version` and `settings_history`;
  - [ ] accounts, ad entities, snapshots (insert only if changed), metrics (upsert window), search terms, outcomes;
  - [ ] cycles (`startScheduled`, `advance`, `finish`);
  - [ ] findings, and proposals (create, `newVersion`, status changes checked against the §3.9 transition table);
  - [ ] approvals, change log, briefs, operator requests, notifications, drift, system flags, API usage;
  - [ ] `createUndoProposal(revisionId)`, which is used by both the worker and the gateway.
- [ ] 4. An idempotent seed:
  - `snappool` (active) and `property-sg` (dormant), with settings taken from stub pack defaults until M05a;
  - the offering `sora-at-lakeside` (with facts `{}`);
  - `system_flags.writes_enabled = false`.

## Tests
- [ ] Every repository.
- [ ] The transition table: every illegal transition throws.
- [ ] The metrics upsert overwrites values and bumps `restated_at`. Snapshots are stored only when the hash changes.
- [ ] A second scheduled cycle on the same day is refused.
- [ ] An approval is unique per version.
- [ ] Settings: a stale `baseVersion` is refused.
- [ ] `createUndoProposal` builds the stored undo, with the fingerprint taken from the change's `after` state.

## Done when (cloud)
- [ ] The migration and `roles.sql` apply to a fresh Postgres, the seed is idempotent, and all tests are green.
  - evidence: —

## Done when (live, run by Marcus)
- [ ] Migrations and `roles.sql` are applied to the Neon `dev` and `prod` branches, and `prod` is seeded (Marcus runs them via `doppler run`).
  - result: —

### Live steps for Marcus
(Written at close.)

## Cut / moved
| Item | Moved to | Why | Date |
|---|---|---|---|
| | | | |

## Leave behind (for later milestones)
- How to write a migration; the transition table; the local test-database recipe. (Written at close.)

## Skills to create
- `db-migration`.

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

## Notes and surprises
- 2026-09-25: library choice. `drizzle-orm` **0.45.3** + `drizzle-kit` **0.31.11** (the stable `latest` tags; 1.0 is still `1.0.0-rc.4`), with `pg` **8.23.0** (node-postgres). Recorded in GOTCHAS.
