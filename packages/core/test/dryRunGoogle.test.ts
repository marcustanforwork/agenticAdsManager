import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { type Cassette, loadCassette, replayFetch } from '@ads/connector-testing';
import { GOOGLE_TOKEN_URL, quotaDay } from '@ads/connector-google';
import { localDate, minusDays } from '@ads/contracts';
import { createProduct, setAccountLoginCustomerId, setAccountStatus, sumApiUsage, upsertAccount } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { parseMasterKey, put } from '@ads/vault';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dryRunSync, googleReadConfig } from '../src/index.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'connector-google', 'fixtures', 'google');
const ACCOUNT = '1234567890';
const MANAGER = '1112223333';
/** 2026-10-01 01:30 in Singapore: "today" there is 2026-10-01. */
const NOW = new Date('2026-09-30T17:30:00Z');
const masterKey = parseMasterKey(`read-v1:${randomBytes(32).toString('base64')}`);

const SETTINGS = {
  ...TEST_SETTINGS,
  outcomes: {
    ...TEST_SETTINGS.outcomes,
    feedback: [{ stage: 'signup', platform: 'google' as const, destinationId: '555' }],
  },
};

/** The hand-written fixtures, with the dates in their queries moved to the windows this run asks for. */
function cassettesFor(now: Date, names: string[]): Cassette[] {
  const today = localDate(now, 'Asia/Singapore');
  const window = `BETWEEN '${minusDays(today, 27)}' AND '${today}'`;
  const trust = `BETWEEN '${minusDays(today, 6)}' AND '${today}'`;
  return names.map((n) => {
    const c = loadCassette(join(FIXTURES, `${n}.json`));
    return {
      ...c,
      exchanges: c.exchanges.map((x) => {
        const body = x.request.body as { query?: string } | undefined;
        if (body?.query === undefined) return x;
        const query = body.query
          .replace("BETWEEN '2026-09-28' AND '2026-09-30'", body.query.includes('FROM customer WHERE') ? trust : window)
          .replace("segments.date = '2026-09-30'", `segments.date = '${minusDays(today, 1)}'`);
        return { ...x, request: { ...x.request, body: { query } } };
      }),
    };
  });
}
const ALL = [
  'account',
  'entities',
  'metrics-campaign-v1',
  'metrics-ad_group',
  'metrics-keyword',
  'search-terms',
  'clicks',
  'trust',
];

/** Google's token endpoint, faked: sign-in never goes through the recorded or replayed fetch. */
let tokenCalls = 0;
const tokenFetch: typeof fetch = (input) => {
  tokenCalls++;
  expect(input).toBe(GOOGLE_TOKEN_URL);
  return Promise.resolve(new Response(JSON.stringify({ access_token: `ya29.${'t'.repeat(30)}`, expires_in: 3599 })));
};

let t: TestDatabase;
let accountId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const product = await createProduct(t.db, {
    slug: 'dry-google',
    name: 'Dry G',
    packId: 'test-pack',
    settings: SETTINGS,
  });
  const account = await upsertAccount(t.db, { productId: product.id, platform: 'google', externalId: ACCOUNT });
  accountId = account.id;
  await setAccountLoginCustomerId(t.db, account.id, MANAGER);
  // A throwaway key made at run time: no key material is ever committed.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await put(
    t.db,
    account.id,
    'read',
    {
      type: 'service_account',
      client_email: 'ads-agent-read@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: GOOGLE_TOKEN_URL,
    },
    masterKey,
  );
  const paused = await upsertAccount(t.db, { productId: product.id, platform: 'google', externalId: '5555555555' });
  await setAccountStatus(t.db, paused.id, 'paused');
});
afterAll(async () => t.drop());
beforeEach(async () => {
  tokenCalls = 0;
  await t.db.execute('delete from api_usage');
});

const run = (fetch: typeof globalThis.fetch, extra: { googleSoftCap?: number } = {}) =>
  dryRunSync({
    db: t.db,
    productSlug: 'dry-google',
    platform: 'google',
    masterKey,
    fetch,
    tokenFetch,
    now: () => NOW,
    ...extra,
  });

describe('dryRunSync (google)', () => {
  it('reads entities, 28 days of metrics, search terms, click ids and trust signals, counting every operation', async () => {
    const replay = replayFetch(cassettesFor(NOW, ALL));
    const report = await run(replay.fetch);
    expect(replay.remaining()).toBe(0);
    expect(report.warnings).toEqual([]);
    const [read, skipped] = report.accounts;
    expect(skipped).toMatchObject({ account: 'google:5555555555', outcome: 'skipped', detail: 'account is paused' });
    expect(read).toMatchObject({
      account: `google:${ACCOUNT}`,
      outcome: 'read',
      timezone: 'Asia/Singapore',
      currency: 'SGD',
      timezoneMatchesProduct: true,
      loginCustomerId: MANAGER,
      window: { from: '2026-09-04', to: '2026-10-01' },
      entities: {
        campaign: { total: 4, byStatus: { active: 1, limited: 1, paused: 1, removed: 1 } },
        ad_group: { total: 3, byStatus: { active: 2, paused: 1 } },
        keyword: { total: 3, byStatus: { active: 1, pending: 1, paused: 1 } },
        budget: { total: 3, byStatus: { active: 3 } },
      },
      sharedBudgets: 2,
      snapshots: 13,
      metrics: {
        campaign: { rows: 4, days: 3, clicks: 60, spendMicros: '28040000', platformConversions: 3.5 },
        ad_group: { rows: 3, days: 3 },
        keyword: { rows: 2, platformConversions: 2 },
      },
      searchTerms: { rows: 2, days: 2 },
      clickIds: { day: '2026-09-30', rows: 2 },
      trust: {
        clicks: 120,
        platformConversions: 7,
        autoTaggingEnabled: true,
        conversionActionsEnabled: 2,
        conversionActionsMissing: [],
      },
    });
    expect(read?.requests).toBe(replay.calls.length);
    expect(read?.requests).toBeLessThan(200); // the live acceptance limit
    expect(await sumApiUsage(t.db, { platform: 'google', date: quotaDay(NOW) })).toBe(read?.requests);
    expect(tokenCalls).toBe(1); // signed in once, then cached
    expect(JSON.stringify(report)).not.toContain('Signups'); // no entity names or search terms in the output
    expect(JSON.stringify(report)).not.toContain('photo');
  });

  it('stops at the soft cap, before sending the request over it', async () => {
    const replay = replayFetch(cassettesFor(NOW, ALL));
    const report = await run(replay.fetch, { googleSoftCap: 5 });
    expect(report.accounts[0]).toMatchObject({ outcome: 'error', requests: 5 });
    expect(report.accounts[0]?.detail).toMatch(/soft cap is reached: 5 of 5/);
    expect(replay.calls).toHaveLength(5);
    expect(await sumApiUsage(t.db, { platform: 'google', date: quotaDay(NOW) })).toBe(5);
  });

  it('finds the manager account when none is stored, and says how to store it', async () => {
    await setAccountLoginCustomerId(t.db, accountId, null);
    try {
      const replay = replayFetch(cassettesFor(NOW, ['clients', ...ALL]));
      const report = await run(replay.fetch);
      expect(report.accounts[0]).toMatchObject({ outcome: 'read', loginCustomerId: MANAGER });
      expect(report.warnings).toEqual([
        `google:${ACCOUNT} is reached through manager ${MANAGER}; store it with: ads accounts link --product dry-google --platform google --account ${ACCOUNT} --manager ${MANAGER}`,
      ]);
      expect(report.accounts[0]?.requests).toBe(replay.calls.length);
    } finally {
      await setAccountLoginCustomerId(t.db, accountId, MANAGER);
    }
  });

  it('reports a per-account error and carries on', async () => {
    const report = await run(replayFetch([]).fetch);
    expect(report.accounts[0]).toMatchObject({ outcome: 'error' });
    expect(report.accounts[0]?.detail).toMatch(/no fixture/);
  });
});

describe('googleReadConfig', () => {
  it("counts only the KPI stage's conversion actions, and warns about the rest", () => {
    expect(googleReadConfig(SETTINGS)).toEqual({ conversionActionIds: ['555'], warnings: [] });
    expect(googleReadConfig(TEST_SETTINGS).warnings).toEqual([
      'no Google route for the KPI stage "signup" in the settings: platform conversions read as 0',
    ]);
    const bad = {
      ...SETTINGS,
      outcomes: {
        ...SETTINGS.outcomes,
        feedback: [{ stage: 'signup', platform: 'google' as const, destinationId: 'abc' }],
      },
    };
    expect(googleReadConfig(bad)).toEqual({
      conversionActionIds: [],
      warnings: ['the Google route for "signup" has a destinationId that is not a conversion action id'],
    });
  });
});
