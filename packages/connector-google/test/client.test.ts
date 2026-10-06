import { AdEntityRecord, ClickRow, MetricRow, SearchTermRow, TrustSignalRow } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { GoogleShapeError, snapshotOf } from '../src/index.ts';
import { ACCOUNT, MANAGER, cassette, replayClient, streamExchange } from './helpers.ts';

const RANGE = { from: '2026-09-28', to: '2026-09-30' };

describe('getAccountInfo', () => {
  it('reads timezone, currency and auto-tagging through the manager account', async () => {
    const { client, replay } = replayClient(['account']);
    expect(await client.getAccountInfo(ACCOUNT)).toEqual({
      name: 'Test Client Account',
      timezone: 'Asia/Singapore',
      currency: 'SGD',
      autoTaggingEnabled: true,
      manager: false,
      status: 'ENABLED',
      testAccount: false,
    });
    expect(replay.remaining()).toBe(0);
  });

  it('refuses a malformed customer id before calling Google', async () => {
    const { client } = replayClient([]);
    await expect(client.getAccountInfo('123-456-7890')).rejects.toThrow(/10 digits/);
  });

  it('sends login-customer-id only when a manager is set (the fixture requires it)', async () => {
    const { client } = replayClient(['account'], {}, { loginCustomerId: '9999999999' });
    await expect(client.getAccountInfo(ACCOUNT)).rejects.toThrow(/no fixture/);
  });
});

describe('listEntities', () => {
  it('lists campaigns (across stream batches), ad groups, keywords and budgets', async () => {
    const { client, replay } = replayClient(['entities']);
    const rows = await client.listEntities(ACCOUNT, ['campaign', 'ad_group', 'ad', 'keyword', 'budget']);
    expect(replay.remaining()).toBe(0);
    for (const r of rows) AdEntityRecord.parse(r);
    expect(
      rows.map((r) => [r.ref.type, r.ref.externalId, r.status, r.rawStatus, r.parent?.externalId ?? null]),
    ).toEqual([
      ['campaign', '111', 'active', 'ENABLED', null],
      ['campaign', '112', 'limited', 'ENABLED', null],
      ['campaign', '113', 'paused', 'PAUSED', null],
      ['campaign', '114', 'removed', 'REMOVED', null],
      ['ad_group', '211', 'active', 'ENABLED', '111'],
      ['ad_group', '212', 'active', 'ENABLED', '112'],
      ['ad_group', '213', 'paused', 'ENABLED', '113'], // enabled, but its campaign is paused
      ['keyword', '211~311', 'active', 'ENABLED', '211'],
      ['keyword', '211~312', 'pending', 'ENABLED', '211'],
      ['keyword', '212~313', 'paused', 'PAUSED', '212'],
      ['budget', '411', 'active', 'ENABLED', null],
      ['budget', '412', 'active', 'ENABLED', null],
      ['budget', '413', 'active', 'ENABLED', null],
    ]);
  });

  it('flags shared budgets, on budgets and on the campaigns that use them', async () => {
    const { client } = replayClient(['entities']);
    const rows = await client.listEntities(ACCOUNT, ['campaign', 'budget']);
    const by = (type: string, id: string) => rows.find((r) => r.ref.type === type && r.ref.externalId === id);
    expect(by('budget', '411')?.budgetShared).toBe(false);
    expect(by('budget', '412')?.budgetShared).toBe(true);
    expect(by('budget', '413')?.budgetShared).toBe(true); // no explicitlyShared, but two campaigns use it
    expect(by('campaign', '112')?.budgetShared).toBe(true);
    expect(by('campaign', '111')).toMatchObject({ dailyBudgetMicros: '20000000', budgetShared: false });
    expect(by('campaign', '111')?.attributes).toMatchObject({
      budgetId: '411',
      budgetType: 'daily',
      biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
    });
    expect(by('campaign', '113')?.budgetShared).toBeNull(); // Google didn't say: unknown, never assumed unshared
  });

  it('keywords carry their text as data and the match type as an attribute', async () => {
    const { client } = replayClient(['entities']);
    const [kw] = (await client.listEntities(ACCOUNT, ['campaign', 'ad_group', 'keyword', 'budget'])).filter(
      (r) => r.ref.type === 'keyword',
    );
    expect(kw).toMatchObject({ name: 'photo sharing app', attributes: { matchType: 'BROAD', campaignId: '111' } });
  });

  it('returns nothing for ads (not read for Google in Phase 0)', async () => {
    const { client, replay } = replayClient([]);
    expect(await client.listEntities(ACCOUNT, ['ad'])).toEqual([]);
    expect(replay.calls).toEqual([]);
  });
});

describe('getMetricsDaily', () => {
  it('reads campaign days and adds the KPI conversion action only', async () => {
    const { client, replay } = replayClient(['metrics-campaign-v1']);
    const rows = await client.getMetricsDaily(ACCOUNT, RANGE, 'campaign');
    expect(replay.remaining()).toBe(0);
    for (const r of rows) MetricRow.parse(r);
    expect(
      rows.map((r) => [
        r.ref.externalId,
        r.day,
        r.impressions,
        r.clicks,
        r.spendMicros,
        r.platformConversions,
        r.platformConversionValueMicros,
      ]),
    ).toEqual([
      ['111', '2026-09-28', 400, 20, '9870000', 2, '0'],
      ['111', '2026-09-29', 380, 18, '8120000', 0, '0'],
      ['111', '2026-09-30', 410, 22, '10050000', 1.5, '12500000'],
      ['112', '2026-09-29', 90, 0, '0', 0, '0'], // clicks omitted by Google = 0
    ]);
  });

  it('restatement: re-reading the window returns the revised day, which replaces the old values', async () => {
    const day = async (name: string) =>
      (await replayClient([name]).client.getMetricsDaily(ACCOUNT, RANGE, 'campaign')).find(
        (r) => r.ref.externalId === '111' && r.day === '2026-09-28',
      );
    expect(await day('metrics-campaign-v1')).toMatchObject({ spendMicros: '9870000', platformConversions: 2 });
    expect(await day('metrics-campaign-v2')).toMatchObject({ spendMicros: '9990000', platformConversions: 3 });
  });

  it('ad group level keeps a conversion day that had no clicks', async () => {
    const { client } = replayClient(['metrics-ad_group']);
    const rows = await client.getMetricsDaily(ACCOUNT, RANGE, 'ad_group');
    expect(rows.map((r) => [r.ref.externalId, r.day, r.clicks, r.platformConversions])).toEqual([
      ['211', '2026-09-28', 20, 2],
      ['212', '2026-09-29', 3, 0],
      ['211', '2026-09-27', 0, 1],
    ]);
  });

  it('keyword level uses <adGroupId>~<criterionId>', async () => {
    const { client } = replayClient(['metrics-keyword']);
    const rows = await client.getMetricsDaily(ACCOUNT, RANGE, 'keyword');
    expect(rows.map((r) => [r.ref.type, r.ref.externalId, r.platformConversions])).toEqual([
      ['keyword', '211~311', 2],
      ['keyword', '211~312', 0],
    ]);
  });

  it('with no KPI conversion action configured, makes no conversion query and reads 0', async () => {
    const c = cassette('metrics-campaign-v1');
    const { client, replay } = replayClient([{ ...c, exchanges: c.exchanges.slice(0, 1) }], {
      conversionActionIds: [],
    });
    const rows = await client.getMetricsDaily(ACCOUNT, RANGE, 'campaign');
    expect(rows.every((r) => r.platformConversions === 0)).toBe(true);
    expect(replay.remaining()).toBe(0);
  });

  it('refuses an empty range and returns nothing for levels Google is not read at', async () => {
    const { client } = replayClient([]);
    await expect(client.getMetricsDaily(ACCOUNT, { from: '2026-09-30', to: '2026-09-01' }, 'campaign')).rejects.toThrow(
      /empty date range/,
    );
    expect(await client.getMetricsDaily(ACCOUNT, RANGE, 'ad')).toEqual([]);
  });

  it('a row that breaks the documented shape fails loudly, without quoting values', async () => {
    const q = cassette('metrics-campaign-v1').exchanges[0]?.request.body as { query: string };
    const bad = [
      { results: [{ campaign: { id: '111' }, segments: { date: '2026-09-28' }, metrics: { costMicros: '12.5' } }] },
    ];
    const { client } = replayClient([{ source: 'inline', exchanges: [streamExchange(q.query, 200, bad)] }], {
      conversionActionIds: [],
    });
    const err = await client.getMetricsDaily(ACCOUNT, RANGE, 'campaign').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleShapeError);
    expect((err as Error).message).toContain('metrics.costMicros');
    expect((err as Error).message).not.toContain('12.5');
  });
});

describe('getSearchTerms', () => {
  it('reads search terms per ad group and day', async () => {
    const { client, replay } = replayClient(['search-terms']);
    const rows = await client.getSearchTerms(ACCOUNT, RANGE);
    expect(replay.remaining()).toBe(0);
    for (const r of rows) SearchTermRow.parse(r);
    expect(rows[0]).toEqual({
      adGroup: { platform: 'google', accountId: ACCOUNT, type: 'ad_group', externalId: '211' },
      day: '2026-09-28',
      searchTerm: 'photo sharing app for weddings',
      impressions: 40,
      clicks: 3,
      spendMicros: '1500000',
    });
  });
});

describe('getClickIds', () => {
  it('reads one day of gclids and skips clicks without one', async () => {
    const { client, replay } = replayClient(['clicks']);
    const rows = await client.getClickIds(ACCOUNT, '2026-09-30');
    expect(replay.remaining()).toBe(0);
    for (const r of rows) ClickRow.parse(r);
    expect(rows.map((r) => [r.gclid, r.campaignId, r.adGroupId])).toEqual([
      ['TestGclid-0001-abcdefghij', '111', '211'],
      ['TestGclid-0002-klmnopqrst', '111', '211'],
    ]);
  });

  it('refuses a malformed day before calling Google', async () => {
    const { client } = replayClient([]);
    await expect(client.getClickIds(ACCOUNT, '2026-09-31')).rejects.toThrow(/date/);
  });
});

describe('snapshot', () => {
  it('fetches one entity by id; the hash equals snapshotOf on the listed record', async () => {
    const { client, replay } = replayClient(['snapshot']);
    const refs = [
      { type: 'campaign', externalId: '111' },
      { type: 'ad_group', externalId: '211' },
      { type: 'keyword', externalId: '211~311' },
      { type: 'budget', externalId: '411' },
    ] as const;
    const listed = await replayClient(['entities']).client.listEntities(ACCOUNT, [
      'campaign',
      'ad_group',
      'keyword',
      'budget',
    ]);
    for (const r of refs) {
      const s = await client.snapshot({ platform: 'google', accountId: ACCOUNT, ...r });
      const record = listed.find((e) => e.ref.type === r.type && e.ref.externalId === r.externalId);
      expect(record).toBeDefined();
      if (record) expect(s.hash).toBe(snapshotOf(record).hash);
    }
    expect(replay.remaining()).toBe(0);
    const budget = await replayClient(['snapshot']).client.snapshot({
      platform: 'google',
      accountId: ACCOUNT,
      type: 'campaign',
      externalId: '111',
    });
    expect(budget.snapshot).toEqual({
      name: 'Signups - Search',
      status: 'active',
      rawStatus: 'ENABLED',
      dailyBudgetMicros: '20000000',
      budgetShared: false,
      budgetType: 'daily',
      bidStrategy: 'MAXIMIZE_CONVERSIONS',
    });
  });

  it('refuses bad refs before calling Google', async () => {
    const { client } = replayClient([]);
    const ref = { platform: 'google', accountId: ACCOUNT } as const;
    await expect(client.snapshot({ ...ref, type: 'keyword', externalId: '311' })).rejects.toThrow(/adGroupId/);
    await expect(client.snapshot({ ...ref, type: 'ad', externalId: '1' })).rejects.toThrow(/not read/);
    await expect(client.snapshot({ ...ref, platform: 'meta', type: 'campaign', externalId: '1' })).rejects.toThrow(
      /not a Google/,
    );
  });
});

describe('trustSignals', () => {
  it('reports clicks, spend, KPI conversions, conversion actions and auto-tagging', async () => {
    const { client, replay } = replayClient(['trust']);
    const t = await client.trustSignals(ACCOUNT, RANGE);
    expect(replay.remaining()).toBe(0);
    TrustSignalRow.parse(t);
    expect(t).toEqual({
      clicks: 120,
      platformConversions: 7,
      spendMicros: '45670000',
      spendCapMicros: null,
      amountSpentMicros: null,
      autoTaggingEnabled: true,
      conversionActionsEnabled: 2,
      conversionActionsMissing: [],
    });
  });

  it('names a configured KPI conversion action that is missing or not enabled', async () => {
    const c = cassette('trust');
    // Same exchanges, but the client is configured for action 556 (removed) instead of 555.
    const swap = (q: unknown): unknown =>
      JSON.parse(JSON.stringify(q).replaceAll('conversionActions/555', 'conversionActions/556')) as unknown;
    const exchanges = c.exchanges.map((x) => ({ ...x, request: { ...x.request, body: swap(x.request.body) } }));
    const { client } = replayClient([{ ...c, exchanges }], { conversionActionIds: ['556'] });
    expect((await client.trustSignals(ACCOUNT, RANGE)).conversionActionsMissing).toEqual(['556']);
  });
});

describe('manager → client accounts', () => {
  it('lists the accessible accounts and the client accounts under the manager', async () => {
    const { client, api, replay } = replayClient(['clients']);
    expect(await api.listAccessibleCustomers()).toEqual([MANAGER]);
    expect(await client.listClientAccounts(MANAGER)).toEqual([
      { id: MANAGER, level: 0, manager: true, status: 'ENABLED', timezone: 'Asia/Singapore', currency: 'SGD' },
      { id: ACCOUNT, level: 1, manager: false, status: 'ENABLED', timezone: 'Asia/Singapore', currency: 'SGD' },
      { id: '9876543210', level: 1, manager: false, status: 'ENABLED', timezone: 'Asia/Singapore', currency: 'SGD' },
    ]);
    expect(replay.remaining()).toBe(0);
  });

  it('finds the manager to sign in through for a client account', async () => {
    const { client } = replayClient(['clients']);
    expect(await client.findManagerFor(ACCOUNT)).toBe(MANAGER);
  });

  it('skips an accessible account it cannot list, and keeps looking', async () => {
    const c = cassette('clients');
    const [accessible, clients] = c.exchanges;
    if (!accessible || !clients) throw new Error('clients.json changed');
    const query = (clients.request.body as { query: string }).query;
    const cancelled = {
      ...clients,
      request: {
        ...clients.request,
        path: '/customers/9990001111/googleAds:searchStream',
        headers: { 'login-customer-id': '9990001111' },
        body: { query },
      },
      response: {
        status: 403,
        headers: {},
        body: {
          error: {
            code: 403,
            message: 'The customer account is not enabled.',
            status: 'PERMISSION_DENIED',
            details: [
              {
                '@type': 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure',
                errors: [{ errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' } }],
              },
            ],
          },
        },
      },
    };
    const both = {
      ...accessible,
      response: { ...accessible.response, body: { resourceNames: ['customers/9990001111', `customers/${MANAGER}`] } },
    };
    const { client } = replayClient([{ ...c, exchanges: [both, cancelled, clients] }]);
    expect(await client.findManagerFor(ACCOUNT)).toBe(MANAGER);
  });

  it('says how to fix access when no accessible account holds the client', async () => {
    const c = cassette('clients');
    const { client } = replayClient([c]);
    await expect(client.findManagerFor('5555555555')).rejects.toThrow(/can't reach 5555555555/);
  });
});
