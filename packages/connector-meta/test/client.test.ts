import { MetricRow, AdEntityRecord, TrustSignalRow } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { MetaShapeError, snapshotOf } from '../src/index.ts';
import { ACCOUNT_FIELDS, ACT, LEAD, inlineClient, replayClient } from './helpers.ts';

const RANGE = { from: '2026-09-28', to: '2026-09-30' };

describe('getAccountInfo', () => {
  it('reads timezone, currency, the spending limit and the amount spent, in micros', async () => {
    const { client, replay } = replayClient(['account']);
    expect(await client.getAccountInfo(ACT)).toEqual({
      name: 'Test Ad Account',
      timezone: 'Asia/Singapore',
      currency: 'SGD',
      spendCapMicros: 500_000_000n, // "50000" cents = S$500
      amountSpentMicros: 412_340_000n,
      accountStatus: 1,
    });
    expect(replay.remaining()).toBe(0);
  });

  it('treats spend_cap "0" as no limit', async () => {
    const c = inlineClient([
      {
        request: { method: 'GET', path: `/${ACT}`, query: { fields: ACCOUNT_FIELDS } },
        response: {
          status: 200,
          headers: {},
          body: {
            id: ACT,
            name: 'x',
            currency: 'SGD',
            timezone_name: 'Asia/Singapore',
            spend_cap: '0',
            amount_spent: '0',
          },
        },
      },
    ]);
    const info = await c.getAccountInfo(ACT);
    expect(info.spendCapMicros).toBeUndefined();
    expect(info.amountSpentMicros).toBe(0n);
  });

  it('refuses a malformed account id before calling Meta', async () => {
    const { client } = replayClient([]);
    await expect(client.getAccountInfo('1234567890')).rejects.toThrow(/act_<digits>/);
  });
});

describe('listEntities', () => {
  it('lists campaigns (across pages), ad sets and ads with normalised statuses and parents', async () => {
    const { client, replay } = replayClient(['entities']);
    const rows = await client.listEntities(ACT, ['campaign', 'ad_group', 'ad', 'keyword', 'budget']);
    expect(replay.remaining()).toBe(0);
    for (const r of rows) AdEntityRecord.parse(r);

    const summary = rows.map((r) => [
      r.ref.type,
      r.ref.externalId.slice(-1),
      r.status,
      r.rawStatus,
      r.parent?.externalId.slice(-1) ?? null,
    ]);
    expect(summary).toEqual([
      ['campaign', '1', 'active', 'ACTIVE', null],
      ['campaign', '2', 'paused', 'PAUSED', null],
      ['campaign', '3', 'removed', 'ARCHIVED', null],
      ['ad_group', '1', 'active', 'ACTIVE', '1'],
      ['ad_group', '2', 'paused', 'CAMPAIGN_PAUSED', '2'],
      ['ad', '1', 'active', 'ACTIVE', '1'],
      ['ad', '2', 'pending', 'PENDING_REVIEW', '1'],
      ['ad', '3', 'unknown', 'SOME_NEW_STATUS', '2'],
    ]);
    const [cbo] = rows;
    expect(cbo?.dailyBudgetMicros).toBe('20000000'); // "2000" cents = S$20.00
    expect(cbo?.budgetShared).toBe(false);
    expect(cbo?.attributes).toMatchObject({
      configuredStatus: 'ACTIVE',
      budgetType: 'daily',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      objective: 'OUTCOME_LEADS',
    });
    const lifetime = rows.find((r) => r.rawStatus === 'CAMPAIGN_PAUSED');
    expect(lifetime?.dailyBudgetMicros).toBeNull();
    expect(lifetime?.attributes).toMatchObject({
      budgetType: 'lifetime',
      lifetimeBudgetMicros: '300000000',
      configuredStatus: 'ACTIVE',
    });
    expect(rows.find((r) => r.ref.type === 'ad_group')?.attributes?.['attributionSpec']).toEqual([
      { event_type: 'CLICK_THROUGH', window_days: 7 },
      { event_type: 'VIEW_THROUGH', window_days: 1 },
    ]);
  });

  it('returns nothing (and calls nothing) for types Meta does not have', async () => {
    const { client, replay } = replayClient([]);
    expect(await client.listEntities(ACT, ['keyword', 'budget'])).toEqual([]);
    expect(replay.calls).toEqual([]);
  });
});

describe('getMetricsDaily', () => {
  it('reads campaign-level days with link clicks, spend in micros, conversions and the attribution setting', async () => {
    const { client } = replayClient(['metrics-campaign-v1']);
    const rows = await client.getMetricsDaily(ACT, RANGE, 'campaign');
    for (const r of rows) MetricRow.parse(r);
    expect(rows.map((r) => [r.day, r.impressions, r.clicks, r.spendMicros, r.platformConversions])).toEqual([
      ['2026-09-28', 1520, 31, '18420000', 2],
      ['2026-09-29', 1610, 0, '19070000', 0],
      ['2026-09-30', 1490, 28, '17950000', 1],
    ]);
    expect(rows[0]?.attributionSetting).toBe('7d_click_1d_view');
    expect(rows[0]?.ref).toEqual({
      platform: 'meta',
      accountId: ACT,
      type: 'campaign',
      externalId: '120200000000000001',
    });
  });

  it('a later download restates an earlier day, and the client returns the new values', async () => {
    const first = await replayClient(['metrics-campaign-v1']).client.getMetricsDaily(ACT, RANGE, 'campaign');
    const later = await replayClient(['metrics-campaign-v2']).client.getMetricsDaily(ACT, RANGE, 'campaign');
    const changed = later.filter((row) => JSON.stringify(row) !== JSON.stringify(first.find((f) => f.day === row.day)));
    expect(changed.map((r) => r.day)).toEqual(['2026-09-28']);
    expect(changed[0]).toMatchObject({ spendMicros: '18970000', platformConversions: 3, clicks: 32 });
  });

  it('maps ad set rows to ad_group refs', async () => {
    const rows = await replayClient(['metrics-adset']).client.getMetricsDaily(
      ACT,
      { from: '2026-09-28', to: '2026-09-30' },
      'ad_group',
    );
    expect(
      rows.map((r) => [r.ref.type, r.ref.externalId, r.clicks, r.platformConversions, r.attributionSetting]),
    ).toEqual([
      ['ad_group', '120210000000000001', 31, 2, '7d_click_1d_view'],
      ['ad_group', '120210000000000002', 0, 0, 'mixed'],
    ]);
  });

  it('adds fractional conversions exactly and reads conversion values in micros', async () => {
    const rows = await replayClient(['metrics-ad']).client.getMetricsDaily(ACT, RANGE, 'ad');
    expect(
      rows.map((r) => [r.ref.externalId.slice(-1), r.platformConversions, r.platformConversionValueMicros]),
    ).toEqual([
      ['1', 1.5, '7250000'],
      ['2', 0.5, '0'],
    ]);
  });

  it('truncates a modelled count beyond 6 decimals instead of failing', async () => {
    const c = inlineClient(
      [
        {
          request: {
            method: 'GET',
            path: `/${ACT}/insights`,
            query: {
              level: 'campaign',
              time_range: '{"since":"2026-09-28","until":"2026-09-28"}',
              time_increment: '1',
              fields:
                'campaign_id,date_start,date_stop,impressions,inline_link_clicks,spend,actions,action_values,attribution_setting',
              limit: '500',
            },
          },
          response: {
            status: 200,
            headers: {},
            body: {
              data: [
                {
                  campaign_id: '1',
                  date_start: '2026-09-28',
                  date_stop: '2026-09-28',
                  spend: '1.00',
                  actions: [{ action_type: LEAD, value: '0.3333333333' }],
                },
              ],
            },
          },
        },
      ],
      { conversionActionTypes: [LEAD] },
    );
    const [row] = await c.getMetricsDaily(ACT, { from: '2026-09-28', to: '2026-09-28' }, 'campaign');
    expect(row?.platformConversions).toBe(0.333333);
  });

  it('counts only the configured conversion action types', async () => {
    const rows = await replayClient(['metrics-campaign-v1'], { conversionActionTypes: [] }).client.getMetricsDaily(
      ACT,
      RANGE,
      'campaign',
    );
    expect(rows.map((r) => r.platformConversions)).toEqual([0, 0, 0]);
  });

  it('returns nothing for keyword level, and refuses an empty range', async () => {
    const { client } = replayClient([]);
    expect(await client.getMetricsDaily(ACT, RANGE, 'keyword')).toEqual([]);
    await expect(client.getMetricsDaily(ACT, { from: '2026-09-30', to: '2026-09-28' }, 'campaign')).rejects.toThrow(
      /empty date range/,
    );
  });
});

describe('snapshot', () => {
  it('takes the tracked fields, hashes them, and matches the snapshot derived from the listing', async () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const { client } = replayClient(['snapshot'], { now: () => now });
    const ref = {
      platform: 'meta' as const,
      accountId: ACT,
      type: 'campaign' as const,
      externalId: '120200000000000001',
    };
    const s = await client.snapshot(ref);
    expect(s.takenAt).toBe(now);
    expect(s.snapshot).toEqual({
      name: 'Signups - Advantage+',
      status: 'active',
      rawStatus: 'ACTIVE',
      configuredStatus: 'ACTIVE',
      dailyBudgetMicros: '20000000',
      lifetimeBudgetMicros: null,
      budgetShared: false,
      budgetType: 'daily',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    });
    expect(s.hash).toMatch(/^[a-f0-9]{64}$/);

    const listed = await replayClient(['entities']).client.listEntities(ACT, ['campaign']);
    const fromListing = snapshotOf(listed.find((r) => r.ref.externalId === ref.externalId)!);
    expect(fromListing.hash).toBe(s.hash);

    const adSet = await client.snapshot({ ...ref, type: 'ad_group', externalId: '120210000000000002' });
    expect(adSet.snapshot).toMatchObject({
      budgetType: 'lifetime',
      lifetimeBudgetMicros: '300000000',
      status: 'paused',
    });
    expect(adSet.hash).not.toBe(s.hash);
  });

  it('refuses an entity that belongs to another ad account', async () => {
    const { client } = replayClient(['snapshot']);
    await expect(
      client.snapshot({ platform: 'meta', accountId: ACT, type: 'campaign', externalId: '120200000000000099' }),
    ).rejects.toThrow(/another ad account/);
  });

  it('refuses refs that are not Meta campaigns, ad sets or ads', async () => {
    const { client } = replayClient([]);
    await expect(
      client.snapshot({ platform: 'google', accountId: ACT, type: 'campaign', externalId: '1' }),
    ).rejects.toThrow(/not a Meta/);
    await expect(
      client.snapshot({ platform: 'meta', accountId: ACT, type: 'keyword', externalId: '1' }),
    ).rejects.toThrow(/no keyword/);
  });
});

describe('trustSignals', () => {
  it('reports clicks, conversions, spend, the spending limit and the dataset events of the last 7 days', async () => {
    const { client, replay } = replayClient(['trust'], {
      datasetId: '987654321012345',
      now: () => new Date('2026-10-01T02:30:00Z'),
    });
    const t = await client.trustSignals(ACT, { from: '2026-09-24', to: '2026-09-30' });
    TrustSignalRow.parse(t);
    expect(t).toEqual({
      clicks: 190,
      platformConversions: 9,
      spendMicros: '131500000',
      spendCapMicros: '500000000',
      amountSpentMicros: '412340000',
      datasetEventsReceived: 9,
      datasetLastEventAt: '2026-09-30T03:41:12.000Z',
    });
    expect(replay.remaining()).toBe(0);
  });

  it('reports null dataset signals when no dataset is configured', async () => {
    const { client } = replayClient(['trust']);
    const t = await client.trustSignals(ACT, { from: '2026-09-24', to: '2026-09-30' });
    expect(t.datasetEventsReceived).toBeNull();
    expect(t.datasetLastEventAt).toBeNull();
  });
});

describe('shape errors', () => {
  it('names the field, never the value, when Meta returns something unexpected', async () => {
    const c = inlineClient([
      {
        request: { method: 'GET', path: `/${ACT}`, query: { fields: ACCOUNT_FIELDS } },
        response: {
          status: 200,
          headers: {},
          body: { id: ACT, name: 'Secret Name Pte Ltd', currency: 'SGD', spend_cap: 12 },
        },
      },
    ]);
    const err = await c.getAccountInfo(ACT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaShapeError);
    expect(String(err)).toMatch(/timezone_name/);
    expect(String(err)).not.toContain('Secret Name');
  });
});
