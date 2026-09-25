// A fresh, fully migrated database per test file, for tests in any package (`@ads/db/testing`).
//
// Recipe (docs/milestones/M01a-database-schema-repositories.md, "Leave behind"):
//   - cloud sessions: `pg_ctlcluster 16 main start`, then once per container
//     `su postgres -c "psql -c \"alter user postgres password 'postgres'\""`;
//   - CI: a postgres:16 service container with the same user and password;
//   - elsewhere: set TEST_DATABASE_URL to a server where that user may CREATE DATABASE and CREATE ROLE.
// The first caller builds a template database (migrations + roles.sql), named after a hash of those
// files; every test file then clones it, which takes milliseconds.
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProductSettings } from '@ads/contracts';
import pg from 'pg';
import { connect, type Database } from './client.ts';
import { MIGRATIONS_DIR, ROLES_SQL, migrateDatabase } from './migrate.ts';

/** Local development only: the throwaway Postgres in a cloud container or CI service. Not a secret. */
export const DEFAULT_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/postgres';

const TEMPLATE_LOCK = 0x61_64_73_01; // pg_advisory_lock key for building the template

export interface TestDatabase extends Database {
  url: string;
  name: string;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function templateName(): Promise<string> {
  const hash = createHash('sha256');
  const files = (await readdir(MIGRATIONS_DIR, { recursive: true })).filter((f) => /\.(sql|json)$/.test(f)).sort();
  for (const f of files) hash.update(f).update(await readFile(join(MIGRATIONS_DIR, f)));
  hash.update(await readFile(ROLES_SQL));
  return `ads_tpl_${hash.digest('hex').slice(0, 16)}`;
}

async function adminClient(adminUrl: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test Postgres at ${new URL(adminUrl).host}. Start it (cloud: pg_ctlcluster 16 main start) ` +
        `or set TEST_DATABASE_URL. See packages/db/src/testing.ts.`,
      { cause: error },
    );
  }
  return client;
}

async function ensureTemplate(admin: pg.Client, adminUrl: string): Promise<string> {
  const name = await templateName();
  await admin.query('select pg_advisory_lock($1)', [TEMPLATE_LOCK]);
  try {
    const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount === 0) {
      const building = `${name}_building`;
      await admin.query(`drop database if exists "${building}" with (force)`);
      await admin.query(`create database "${building}"`);
      const database = connect(withDatabase(adminUrl, building), { max: 1 });
      try {
        await migrateDatabase(database.db);
      } finally {
        await database.close();
      }
      await admin.query(`alter database "${building}" rename to "${name}"`);
    }
  } finally {
    await admin.query('select pg_advisory_unlock($1)', [TEMPLATE_LOCK]);
  }
  return name;
}

/** Creates a fresh database cloned from the migrated template. Call `drop()` in afterAll. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;
  const admin = await adminClient(adminUrl);
  const name = `ads_test_${randomBytes(6).toString('hex')}`;
  try {
    const template = await ensureTemplate(admin, adminUrl);
    await admin.query(`create database "${name}" template "${template}"`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(adminUrl, name);
  const database = connect(url, { max: 4, applicationName: 'ads-agent-test' });
  return {
    ...database,
    url,
    name,
    async drop() {
      await database.close();
      const cleanup = await adminClient(adminUrl);
      try {
        await cleanup.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Valid product settings with core defaults, for tests in any package. */
export const TEST_SETTINGS: ProductSettings = {
  spend: { dailyCeilingMicros: null, monthlyCeilingMicros: null, autoPauseOnMonthlyBreach: false },
  outcomes: { stages: [{ id: 'signup', label: 'Signup', tier: 'success' }], primaryKpiStage: 'signup', feedback: [] },
  trust: {
    minClicksToJudgeTracking: 30,
    maxOutcomeStalenessHours: 48,
    maxAttributionGapPct: 50,
    minOutcomesForGap: 10,
    minIdCapturePct: 60,
  },
  agent: { analystLookupBudget: 20, autoApproveFeedback: false, feedbackDailyCap: 200 },
  notifications: { digest: 'auto' },
  copy: { tier: 'fragments', requiredStrings: [], bannedPhrases: [] },
  testTraffic: { emailDomains: [] },
  guardOverrides: {},
  disabledActions: [],
};
