---
name: db-migration
description: Add or change database tables, columns, indexes, constraints or role grants in packages/db (Drizzle + Postgres), and write repository functions and their tests. Use when a milestone needs a new table or column, when the schema in BLUEPRINT §4 changes, when touching roles.sql, when adding a proposal status or transition, or when a test needs a database ("set up the test DB", "Postgres isn't running", "add a migration").
---

# Database migrations and repositories

The schema is `packages/db/src/schema.ts` (mirrors BLUEPRINT §4). Migrations are SQL files that drizzle-kit
generates into `packages/db/migrations/`. `sql/roles.sql` holds the three roles and their grants.

## 1. Get a test database (once per container)

- **Cloud session:** `pg_ctlcluster 16 main start`, then
  `su postgres -c "psql -c \"alter user postgres password 'postgres'\""`.
- **CI:** the `postgres:16` service in `.github/workflows/ci.yml` (same user and password).
- **Elsewhere:** set `TEST_DATABASE_URL` to a server where the user may `CREATE DATABASE` and `CREATE ROLE`.
- Tests call `createTestDatabase()` from `@ads/db/testing` in `beforeAll` and `drop()` in `afterAll`. The first
  call builds a template (migrations + roles.sql, named after their hash); each test file clones it.

## 2. Change the schema

1. Edit `src/schema.ts`. Rules:
   - every **product-scoped** table has `product_id` (via `productId()`) **and an index starting with it**
     (invariant 11; `test/migrate.test.ts` checks this);
   - money is `micros()` (bigint, mode `bigint`); never a float. Counts are `bigint({ mode: 'number' })` or `integer`;
   - allowed values get a named `check(... oneOf(...))` constraint as well as the `{ enum }` type;
   - bigint/numeric defaults are written `default(sql\`0\`)` (drizzle-kit can't serialise a JS bigint default).
2. Generate: `pnpm --filter @ads/db db:generate --name <what_changed>`. Read the SQL it wrote.
   - A data change, backfill, view or function goes in a custom migration:
     `pnpm --filter @ads/db exec drizzle-kit generate --custom --name <what>`, then write the SQL.
3. **Never edit a migration that is on `main`.** Fix forward with a new one. (Before merge, delete and regenerate.)
4. New table? Decide its grants in `sql/roles.sql` (BLUEPRINT §4 "Database roles") and add a case to
   `test/roles.test.ts`. roles.sql revokes everything and re-grants, so it is safe to re-run.
5. Add or change the repository in `src/repos/` (plain functions; first argument `db: DbOrTx`), export it from
   `src/index.ts`, and test it in `test/`.
6. If BLUEPRINT §4 no longer matches, fix it with the `update-plan` skill in the same PR.

## 3. Repository conventions

- Validate JSON documents with the `@ads/contracts` schema on write **and** read (settings, WriteOps).
- Multi-statement changes run in `db.transaction(...)`; it nests as a savepoint when given a transaction.
- Optimistic concurrency: `where version = base` and throw `StaleVersionError` if no row changed.
- Throw the errors in `src/errors.ts` (`NotFoundError`, `RefusedError`, `IllegalTransitionError`,
  `StaleVersionError`, `DuplicateCycleError`); callers turn them into messages for Marcus.
- Drizzle wraps Postgres errors; use `isUniqueViolation(error, '<constraint>')` and, in tests, `expectConstraint`.
- Drizzle's jsonb reader re-parses **string** values. Store objects, or read with `::text` and `JSON.parse`
  (see `getFlag`).

## 4. Proposal statuses (BLUEPRINT §3.9)

`PROPOSAL_TRANSITIONS` in `src/repos/proposals.ts` is the only definition. Status changes go through
`transitionProposal` (or `recordDecision`); never `update proposals set status` in code. Adding a status or edge
means: contracts `ProposalStatus`, the schema check list, the table, the exhaustive test in
`test/proposals.test.ts`, and BLUEPRINT §3.9 (via `update-plan`).

## 5. Apply it

- Locally/CI: tests apply everything automatically.
- A real database (Marcus runs it; never in a cloud session):
  `doppler run --config <dev|prd> -- pnpm --filter @ads/db db:migrate` (migrations + roles.sql), then
  `db:seed` only when the milestone says so. The seed never overwrites existing rows.

## 6. Before pushing

`pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm test && pnpm format:check`, and
`pnpm --filter @ads/db db:generate` must report no schema changes (the migration matches `schema.ts`).
