// Evidence computation (M06a Build 2): ComputedEvidence from the database for any target and window, checked
// against sums worked out by hand over the rows below.
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FINDING_TYPES,
  allowsTarget,
  computeEvidence,
  daysWatched,
  evidenceWindowDays,
  judgeEvidence,
  windowEndingYesterday,
  type FindingTarget,
} from '../src/index.ts';
import { type AdWorld, NOW, S, TZ, makeAdWorld } from './support/adWorld.ts';
import type { AdEntity } from '@ads/db';

let t: TestDatabase;
let w: AdWorld;
const e: Record<string, AdEntity> = {};
const WINDOW = windowEndingYesterday(NOW, TZ, 14); // 2026-09-24 .. 2026-10-07

beforeAll(async () => {
  t = await createTestDatabase();
  w = await makeAdWorld(t.db);
  e.c1 = await w.entity('google', 'campaign', '101');
  e.ag1 = await w.entity('google', 'ad_group', '201', { parent: e.c1 });
  e.k1 = await w.entity('google', 'keyword', '201~301', { parent: e.ag1 });
  e.c2 = await w.entity('google', 'campaign', '102');
  e.c3 = await w.entity('google', 'campaign', '103', { firstSeen: '2026-10-05' }); // new, no data yet
  e.mc1 = await w.entity('meta', 'campaign', '501');
  e.as1 = await w.entity('meta', 'ad_group', '601', { parent: e.mc1 });
  e.ad1 = await w.entity('meta', 'ad', '701', { parent: e.as1 });

  await w.metrics(e.c1, '2026-09-01', 999, 99, S(99)); // before the window: only its first day counts
  await w.metrics(e.c1, '2026-10-01', 100, 10, S(5));
  await w.metrics(e.c1, '2026-10-05', 200, 5, S(2.5));
  await w.metrics(e.ag1, '2026-10-01', 80, 8, S(4));
  await w.metrics(e.k1, '2026-10-01', 50, 4, S(2));
  await w.metrics(e.c2, '2026-10-07', 10, 1, S(1));
  await w.metrics(e.mc1, '2026-10-06', 1000, 20, S(12.34));
  await w.metrics(e.mc1, '2026-10-08', 5, 0, 0n); // today: outside the window
  await w.metrics(e.as1, '2026-10-06', 900, 18, S(11));

  await w.outcome('o1', 'signup', '2026-10-02T03:00:00Z', e.c1, { ids: { googleAdGroupId: '201' } });
  await w.outcome('o2', 'signup', '2026-10-02T04:00:00Z', e.c1);
  await w.outcome('o3', 'signup', '2026-10-06T05:00:00Z', e.mc1, { ids: { metaAdSetId: '601', metaAdId: '701' } });
  await w.outcome('o4', 'signup', '2026-10-03T05:00:00Z', e.c1, { isTest: true }); // test traffic: never counted
  await w.outcome('o5', 'signup', '2026-10-03T06:00:00Z', null); // unattributed: the product's only
  await w.outcome('o6', 'pool_request', '2026-10-04T06:00:00Z', e.c2);
  await w.outcome('o7', 'signup', '2026-10-07T16:30:00Z', e.c1); // 2026-10-08 00:30 in Singapore: outside
  await w.outcome('o8', 'signup', '2026-09-23T16:30:00Z', e.c1); // 2026-09-24 00:30 in Singapore: inside
});
afterAll(async () => t.drop());

const evidenceOf = (target: FindingTarget) =>
  computeEvidence(t.db, { productId: w.productId, timeZone: TZ, target, window: WINDOW });
const entity = (key: string): FindingTarget => ({ kind: 'entity', entity: e[key] as AdEntity });

describe('computeEvidence', () => {
  it('sums a campaign over the window, with its attributed outcomes by local day', async () => {
    expect(await evidenceOf(entity('c1'))).toEqual({
      windowDays: 14,
      impressions: 300,
      clicks: 15,
      spendMicros: '7500000',
      outcomesByStage: { signup: 3 }, // o1, o2, o8 (o4 is test, o7 is outside)
      from: '2026-09-24',
      to: '2026-10-07',
      dataDays: 14, // data since 2026-09-01
    });
  });

  it('credits outcomes below campaign level only by platform id', async () => {
    expect(await evidenceOf(entity('ag1'))).toMatchObject({ impressions: 80, outcomesByStage: { signup: 1 } });
    expect(await evidenceOf(entity('as1'))).toMatchObject({ impressions: 900, outcomesByStage: { signup: 1 } });
    expect(await evidenceOf(entity('ad1'))).toMatchObject({ impressions: 0, outcomesByStage: { signup: 1 } });
    expect(await evidenceOf(entity('k1'))).toMatchObject({ impressions: 50, outcomesByStage: {} });
  });

  it('sums an account and the product from campaign rows only', async () => {
    expect(await evidenceOf({ kind: 'account', account: { id: w.accounts.google } as never })).toMatchObject({
      impressions: 310,
      clicks: 16,
      spendMicros: '8500000',
      outcomesByStage: { signup: 3, pool_request: 1 },
    });
    expect(await evidenceOf({ kind: 'account', account: { id: w.accounts.meta } as never })).toMatchObject({
      impressions: 1000,
      clicks: 20,
      spendMicros: '12340000',
      outcomesByStage: { signup: 1 },
    });
    expect(await evidenceOf({ kind: 'product' })).toMatchObject({
      impressions: 1310,
      clicks: 36,
      spendMicros: '20840000',
      outcomesByStage: { signup: 5, pool_request: 1 }, // o1, o2, o3, o5, o8; o6
    });
  });

  it('counts the days watched from the first data or first sighting', async () => {
    expect(await evidenceOf(entity('c3'))).toMatchObject({ impressions: 0, dataDays: 3 }); // 5, 6, 7 October
    expect((await evidenceOf(entity('c2'))).dataDays).toBe(14); // first seen long ago, data or not
    expect(daysWatched(WINDOW, null)).toBe(0);
    expect(daysWatched(WINDOW, '2026-10-08')).toBe(0);
  });

  it('keeps the rule figures it is given', async () => {
    const ev = await computeEvidence(t.db, {
      productId: w.productId,
      timeZone: TZ,
      target: { kind: 'product' },
      window: WINDOW,
      detail: { projectedMicros: '512000000' },
    });
    expect(ev.detail).toEqual({ projectedMicros: '512000000' });
  });
});

describe('the registry and the threshold', () => {
  it('lists every finding type with its targets', () => {
    expect(allowsTarget('tracking_gap', 'account')).toBe(true);
    expect(allowsTarget('wasteful_search_term', 'campaign')).toBe(false);
    expect(FINDING_TYPES.no_delivery.action).toBeNull();
    expect(FINDING_TYPES.zero_outcome_spend).toMatchObject({ action: 'pause_entity', proposalsFromPhase: 2 });
  });

  it("stretches a window to the pack's minDays", () => {
    const t14 = { minImpressions: 0, minClicks: 0, minSpendMicros: '0', minDays: 21 };
    expect(evidenceWindowDays('zero_outcome_spend', null)).toBe(14);
    expect(evidenceWindowDays('zero_outcome_spend', t14)).toBe(21);
  });

  it('judges computed evidence, and fails closed without a threshold', async () => {
    const ev = await evidenceOf(entity('c1'));
    const threshold = { minImpressions: 300, minClicks: 15, minSpendMicros: '7500000', minDays: 14 };
    expect(judgeEvidence(ev, threshold).met).toBe(true);
    expect(judgeEvidence(ev, { ...threshold, minDays: 15 }).unmet).toEqual(['minDays']);
    expect(judgeEvidence(ev, null).met).toBe(false);
  });
});
