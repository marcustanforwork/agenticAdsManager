import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { type Cassette, loadCassette, replayFetch } from '@ads/connector-testing';
import { createProduct, setAccountStatus, upsertAccount } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { parseMasterKey, put } from '@ads/vault';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate, minusDays } from '@ads/contracts';
import { dryRunSync, metaReadConfig } from '../src/index.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'connector-meta', 'fixtures', 'meta');
const ACT = 'act_1234567890';
const DATASET = '987654321012345';
/** 2026-10-01 01:30 in Singapore: "today" there is 2026-10-01. */
const NOW = new Date('2026-09-30T17:30:00Z');
const masterKey = parseMasterKey(`read-v1:${randomBytes(32).toString('base64')}`);

const SETTINGS = {
  ...TEST_SETTINGS,
  outcomes: {
    ...TEST_SETTINGS.outcomes,
    feedback: [{ stage: 'signup', platform: 'meta' as const, destinationId: DATASET, eventName: 'Lead' }],
  },
};

/** The hand-written fixtures, with their date parameters moved to the windows this run asks for. */
function cassettesFor(now: Date): Cassette[] {
  const today = localDate(now, 'Asia/Singapore');
  const window = JSON.stringify({ since: minusDays(today, 27), until: today });
  const trust = JSON.stringify({ since: minusDays(today, 6), until: today });
  const end = Math.floor(now.getTime() / 3_600_000) * 3_600;
  const load = (n: string) => loadCassette(join(FIXTURES, `${n}.json`));
  const shift = (c: Cassette): Cassette => ({
    ...c,
    exchanges: c.exchanges.map((x) => {
      const q = { ...x.request.query };
      if (q['time_range'] !== undefined) q['time_range'] = q['level'] === 'account' ? trust : window;
      if (q['start_time'] !== undefined) q['start_time'] = String(end - 7 * 86_400);
      if (q['end_time'] !== undefined) q['end_time'] = String(end);
      return { ...x, request: { ...x.request, query: q } };
    }),
  });
  // trust.json repeats the account read (trustSignals reads the spending limit fresh).
  return ['entities', 'metrics-campaign-v1', 'metrics-adset', 'metrics-ad', 'trust'].map((n) => shift(load(n)));
}

let t: TestDatabase;
let productId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const product = await createProduct(t.db, { slug: 'dry-test', name: 'Dry', packId: 'test-pack', settings: SETTINGS });
  productId = product.id;
  const account = await upsertAccount(t.db, { productId, platform: 'meta', externalId: ACT });
  await put(t.db, account.id, 'read', { accessToken: `EAA${'z'.repeat(40)}`, appSecret: 's'.repeat(32) }, masterKey);
  const paused = await upsertAccount(t.db, { productId, platform: 'meta', externalId: 'act_999' });
  await setAccountStatus(t.db, paused.id, 'paused');
});
afterAll(async () => t.drop());

describe('dryRunSync (meta)', () => {
  it('reads every level, summarises what would be stored, and skips paused accounts', async () => {
    const replay = replayFetch(cassettesFor(NOW));
    const report = await dryRunSync({
      db: t.db,
      productSlug: 'dry-test',
      platform: 'meta',
      masterKey,
      fetch: replay.fetch,
      now: () => NOW,
    });
    expect(replay.remaining()).toBe(0);
    expect(report.warnings).toEqual([]);
    const [read, skipped] = report.accounts;
    expect(skipped).toMatchObject({ account: 'meta:act_999', outcome: 'skipped', detail: 'account is paused' });
    expect(read).toMatchObject({
      account: `meta:${ACT}`,
      outcome: 'read',
      timezone: 'Asia/Singapore',
      currency: 'SGD',
      timezoneMatchesProduct: true,
      window: { from: '2026-09-04', to: '2026-10-01' },
      entities: {
        campaign: { total: 3, byStatus: { active: 1, paused: 1, removed: 1 } },
        ad_group: { total: 2, byStatus: { active: 1, paused: 1 } },
        ad: { total: 3, byStatus: { active: 1, pending: 1, unknown: 1 } },
      },
      snapshots: 8,
      metrics: {
        campaign: { rows: 3, days: 3, clicks: 59, spendMicros: '55440000', platformConversions: 3 },
        ad_group: { rows: 2, days: 1 },
        ad: { rows: 2, platformConversions: 2 },
      },
      trust: { clicks: 190, platformConversions: 9, spendCapMicros: '500000000', datasetEventsReceived: 9 },
    });
    expect(read?.requests).toBe(replay.calls.length);
    expect(JSON.stringify(report)).not.toContain('Signups'); // no entity names in the output
  });

  it('reports a per-account error and carries on', async () => {
    const report = await dryRunSync({
      db: t.db,
      productSlug: 'dry-test',
      platform: 'meta',
      masterKey,
      fetch: replayFetch([]).fetch,
      now: () => NOW,
    });
    expect(report.accounts[0]).toMatchObject({ outcome: 'error' });
    expect(report.accounts[0]?.detail).toMatch(/no fixture/);
  });

  it('refuses an unknown product', async () => {
    await expect(dryRunSync({ db: t.db, productSlug: 'nope', platform: 'meta', masterKey })).rejects.toThrow(/nope/);
  });
});

describe('metaReadConfig', () => {
  it('counts only the KPI stage, so funnel stages are never added together', () => {
    const twoStages = {
      ...SETTINGS,
      outcomes: {
        stages: [
          { id: 'lead', label: 'Lead', tier: 'soft' as const },
          { id: 'signup', label: 'Signup', tier: 'success' as const },
        ],
        primaryKpiStage: 'signup',
        feedback: [
          { stage: 'lead', platform: 'meta' as const, destinationId: '111', eventName: 'Lead' },
          { stage: 'signup', platform: 'meta' as const, destinationId: DATASET, eventName: 'CompleteRegistration' },
        ],
      },
    };
    expect(metaReadConfig(twoStages)).toEqual({
      conversionActionTypes: ['offsite_conversion.fb_pixel_complete_registration'],
      datasetId: DATASET,
      warnings: [],
    });
  });

  it('derives the conversion action types and the dataset from the feedback routes', () => {
    expect(metaReadConfig(SETTINGS)).toEqual({
      conversionActionTypes: ['offsite_conversion.fb_pixel_lead'],
      datasetId: DATASET,
      warnings: [],
    });
  });

  it('still watches a Meta dataset when the KPI stage is not routed to Meta', () => {
    const otherStage = {
      ...SETTINGS,
      outcomes: {
        stages: [
          { id: 'lead', label: 'Lead', tier: 'soft' as const },
          { id: 'signup', label: 'Signup', tier: 'success' as const },
        ],
        primaryKpiStage: 'signup',
        feedback: [{ stage: 'lead', platform: 'meta' as const, destinationId: '111', eventName: 'Lead' }],
      },
    };
    const c = metaReadConfig(otherStage);
    expect(c.datasetId).toBe('111');
    expect(c.conversionActionTypes).toEqual([]); // conversions stay KPI-stage only
    expect(c.warnings[0]).toMatch(/no Meta route for the KPI stage/);
  });

  it('warns, rather than fails, when the settings have no usable Meta route', () => {
    expect(metaReadConfig(TEST_SETTINGS).warnings[0]).toMatch(/no Meta route for the KPI stage "signup"/);
    const noEvent = {
      ...SETTINGS,
      outcomes: {
        ...SETTINGS.outcomes,
        feedback: [{ stage: 'signup', platform: 'meta' as const, destinationId: DATASET }],
      },
    };
    expect(metaReadConfig(noEvent)).toMatchObject({
      conversionActionTypes: [],
      datasetId: DATASET,
      warnings: [expect.stringMatching(/no eventName/)],
    });
    const custom = {
      ...SETTINGS,
      outcomes: { ...SETTINGS.outcomes, feedback: [{ ...SETTINGS.outcomes.feedback[0]!, eventName: 'HostSignup' }] },
    };
    const c = metaReadConfig(custom);
    expect(c.conversionActionTypes).toEqual([]);
    expect(c.warnings[0]).toMatch(/HostSignup/);
  });
});
