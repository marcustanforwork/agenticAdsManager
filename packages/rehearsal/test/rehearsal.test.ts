// The pre-live rehearsal (F3, D-092): the first live weekend, end to end, in the order of the live steps, on a fresh
// database. Each `it` is one stretch of Marcus's checklist and builds on the ones before it, so they run in order.
// Only the outside world is faked (support/): the ad platforms (cassettes), Google's sign-in, SnapPool's database,
// the AI, Telegram, the healthchecks pings and the clock. Everything else is the code that will run on the SER9:
// the migration script, the `ads` CLI, the worker service, the Telegram bot's handlers, the request processor, and
// the dashboard's loaders and pages under its own database role.
import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GOOGLE_TOKEN_URL } from '@ads/connector-google';
import { type Database, connect, findProductBySlug, getFlag, listCycles, schema } from '@ads/db';
import { DEFAULT_TEST_DATABASE_URL } from '@ads/db/testing';
import { createFixtureDb, seedFixtures, type FixtureDb } from '@ads/pack-saas-snappool/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliContext, ads } from './support/cli.ts';
import { fakeModel } from './support/model.ts';
import { GOOGLE_ACCOUNT, GOOGLE_MANAGER, META_ACCOUNT, fakePlatforms, tokenFetch } from './support/platforms.ts';
import { OWNER_ID, fakeTelegram } from './support/telegram.ts';

const run = promisify(execFile);
const REPO = join(import.meta.dirname, '..', '..', '..');
const ADMIN_URL = process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;

/** Monday 5 October 2026, 08:30 in Singapore: the morning after the setup weekend. */
let clock = new Date('2026-10-05T00:30:00Z');
const now = (): Date => clock;

const dbName = `ads_rehearsal_${randomBytes(6).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let snappool: FixtureDb;
let database: Database;
const platforms = fakePlatforms(now);
const model = fakeModel();
const telegram = fakeTelegram();
const env: Record<string, string> = {
  DATABASE_URL: dbUrl,
  VAULT_READ_KEY: `read-v1:${randomBytes(32).toString('base64')}`,
  OPERATOR_ACTORS: 'cli:marcus,web:marcus@example.com',
  ADS_OPERATOR: 'marcus',
  TELEGRAM_OWNER_ID: String(OWNER_ID),
  HEALTHCHECK_WORKER_URL: 'https://hc.invalid/worker-alive',
  HEALTHCHECK_DAILY_SYNC_URL: 'https://hc.invalid/daily-sync',
};
const cli: CliContext = { env, fetch: platforms.fetch, tokenFetch, now, model: model.model };

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  // An empty database, as a new Neon branch is: the migration script builds everything (M01a step 3).
  await admin((c) => c.query(`create database "${dbName}"`));
  snappool = await createFixtureDb();
  await seedFixtures(snappool);
  env['SNAPPOOL_DATABASE_URL'] = snappool.url;
  database = connect(dbUrl, { max: 3 });
});

afterAll(async () => {
  await database?.close();
  await snappool?.drop();
  await admin((c) => c.query(`drop database if exists "${dbName}" with (force)`));
});

describe('the first live weekend, rehearsed', () => {
  it('M01a: the migration script runs twice on an empty database, then `ads seed` creates both products', async () => {
    for (let i = 0; i < 2; i++) {
      const { stdout } = await run('pnpm', ['--silent', '--filter', '@ads/db', 'db:migrate'], {
        cwd: REPO,
        env: { ...process.env, DATABASE_URL: dbUrl },
      });
      expect(stdout).toContain('migrations and roles.sql applied');
    }
    const seeded = (await ads(cli, ['seed'])).json();
    expect(seeded).toMatchObject({ productsCreated: ['snappool', 'property-sg'], docsCreated: 6 });
    expect((await ads(cli, ['seed'])).json()).toMatchObject({ productsCreated: [], docsCreated: 0 });
    // M01a step 6: what the Neon SQL editor shows.
    const products = await database.pool.query<{ slug: string; status: string; settings_version: number }>(
      'select slug, status, settings_version from products order by slug',
    );
    expect(products.rows).toEqual([
      { slug: 'property-sg', status: 'dormant', settings_version: 1 },
      { slug: 'snappool', status: 'active', settings_version: 1 },
    ]);
    expect(await getFlag(database.db, 'writes_enabled')).toBe(false);
    expect((await ads(cli, ['phase'])).json()).toEqual({ phase: 0 });
  });

  it('M02, M03: the accounts are linked, their read credentials stored, and the dry syncs read them', async () => {
    const link = await ads(cli, [
      'accounts',
      'link',
      '--product',
      'snappool',
      '--platform',
      'meta',
      '--account',
      META_ACCOUNT,
    ]);
    expect(link.exitCode).toBe(0);
    const metaKey = JSON.stringify({ accessToken: `EAA${'r'.repeat(40)}`, appSecret: 'a'.repeat(32) });
    const put = await ads(cli, ['credentials', 'put', '--account', `meta:${META_ACCOUNT}`, '--role', 'read'], metaKey);
    expect(put.printed.join('\n')).not.toContain('EAA');

    await ads(cli, [
      'accounts',
      'link',
      '--product',
      'snappool',
      '--platform',
      'google',
      '--account',
      GOOGLE_ACCOUNT,
      '--manager',
      GOOGLE_MANAGER,
    ]);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const googleKey = JSON.stringify({
      type: 'service_account',
      client_email: 'ads-agent-read@rehearsal.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: GOOGLE_TOKEN_URL,
    });
    await ads(cli, ['credentials', 'put', '--account', `google:${GOOGLE_ACCOUNT}`, '--role', 'read'], googleKey);

    const meta = await ads(cli, ['sync', '--product', 'snappool', '--platform', 'meta', '--dry']);
    expect(meta.exitCode).toBe(0);
    expect(meta.json()).toMatchObject({
      dryRun: true,
      accounts: [{ account: `meta:${META_ACCOUNT}`, outcome: 'read' }],
    });
    const google = await ads(cli, ['sync', '--product', 'snappool', '--platform', 'google', '--dry']);
    expect(google.exitCode).toBe(0);
    const report = google.json<{ accounts: { outcome: string; requests: number }[] }>();
    expect(report.accounts).toMatchObject([{ outcome: 'read' }]);
    expect(report.accounts[0]?.requests).toBeLessThan(200); // M03 step 5
  });

  it('M05a, M05b: outcomes are read from SnapPool, the starting settings set, and the KPI switched and back', async () => {
    const outcomes = await ads(cli, ['outcomes', '--product', 'snappool']);
    expect(outcomes.exitCode).toBe(0);
    expect(outcomes.json()).toMatchObject({ read: { outcome: 'read' } });

    const patch = {
      testTraffic: { emailDomains: ['staff.example'] },
      spend: { monthlyCeilingMicros: '500000000', dailyCeilingMicros: '25000000' },
    };
    const set = await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(patch)]);
    expect(set.json()).toMatchObject({ status: 'done', version: 2 });
    const paid = { outcomes: { primaryKpiStage: 'paid' } };
    expect(
      (await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(paid)])).json(),
    ).toMatchObject({
      status: 'done',
    });
    expect((await ads(cli, ['outcomes', '--product', 'snappool', '--no-read'])).json()).toMatchObject({
      kpiStage: 'paid',
    });
    const back = { outcomes: { primaryKpiStage: 'signup' } };
    expect(
      (await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(back)])).json(),
    ).toMatchObject({
      status: 'done',
    });

    const docs = (await ads(cli, ['docs', 'list', '--product', 'snappool'])).json<{ docs: { version: number }[] }>();
    expect(docs.docs).toHaveLength(3);
    const product = await findProductBySlug(database.db, 'snappool');
    expect(product?.timezone).toBe('Asia/Singapore');
    expect(await listCycles(database.db, product?.id ?? '')).toEqual([]);
    expect(await database.db.select().from(schema.notifications)).toEqual([]);
  });
});
