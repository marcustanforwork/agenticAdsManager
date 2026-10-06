import { replayFetch } from '@ads/connector-testing';
import type { AccountTrustSignals } from '@ads/contracts';
import {
  getProduct,
  insertOutcomes,
  listOutcomes,
  listTrustChecks,
  markAccountSynced,
  markFedBack,
  setAccountStatus,
  startManual,
} from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dataFresh,
  spendCapHeadroom,
  syncStage,
  timezoneMatch,
  trackingActive,
  trustResultOf,
  trustStage,
} from '../src/index.ts';
import { NOW, type World, googleCassettes, makeWorld, metaCassettes, tokenFetch } from './support/world.ts';

const HOUR = 3_600_000;

describe('trust-check tables', () => {
  it('data_fresh: the last successful sync must be under 26 hours old', () => {
    const at = (hoursAgo: number) => ({
      lastSyncedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
      lastSyncError: null,
      now: NOW,
    });
    expect(dataFresh(at(1)).result).toBe('pass');
    expect(dataFresh(at(25.9)).result).toBe('pass');
    expect(dataFresh(at(26)).result).toBe('fail');
    expect(dataFresh({ lastSyncedAt: null, lastSyncError: null, now: NOW })).toEqual({
      result: 'fail',
      detail: { lastSyncedAt: null },
    });
    // A failed attempt after an earlier success: the age decides, and the error is shown.
    expect(dataFresh({ ...at(2), lastSyncError: 'token expired' })).toMatchObject({
      result: 'pass',
      detail: { ageHours: 2, lastSyncError: 'token expired' },
    });
  });

  it('timezone_match: a mismatch is a fail', () => {
    expect(timezoneMatch({ accountTimezone: 'Asia/Singapore', productTimezone: 'Asia/Singapore' }).result).toBe('pass');
    expect(timezoneMatch({ accountTimezone: 'America/Los_Angeles', productTimezone: 'Asia/Singapore' })).toEqual({
      result: 'fail',
      detail: { accountTimezone: 'America/Los_Angeles', productTimezone: 'Asia/Singapore' },
    });
    expect(timezoneMatch({ accountTimezone: null, productTimezone: 'Asia/Singapore' }).result).toBe('fail');
  });

  it('tracking_active: low volume is no_signal, not fail; upload-only platforms judge only after uploads', () => {
    const base = { clicks: 50, platformConversions: 0, minClicks: 30, routedByUploads: false, uploads: 0 };
    const cases: [Partial<typeof base>, string][] = [
      [{ platformConversions: 2 }, 'pass'],
      [{ platformConversions: 0.5, clicks: 3 }, 'pass'], // any recorded conversion passes, whatever the volume
      [{ clicks: 29 }, 'no_signal'], // too few clicks to judge
      [{ clicks: 30 }, 'fail'],
      [{}, 'fail'],
      // D-075: conversions reach the platform only through our uploads, and none were uploaded yet.
      [{ routedByUploads: true }, 'no_signal'],
      [{ routedByUploads: true, uploads: 4 }, 'fail'], // we uploaded, the platform shows none: broken
      [{ routedByUploads: true, uploads: 4, platformConversions: 3 }, 'pass'],
      [{ routedByUploads: true, clicks: 10 }, 'no_signal'],
    ];
    for (const [overrides, expected] of cases) {
      expect([overrides, trackingActive({ ...base, ...overrides }).result]).toEqual([overrides, expected]);
    }
    expect(trackingActive({ ...base, clicks: 10 }).detail).toMatchObject({ reason: 'too few clicks' });
  });

  it('spend_cap_headroom: unset or 80% used warns; never fails', () => {
    const cap = (spendCapMicros: string | null, amountSpentMicros: string | null) =>
      spendCapHeadroom({ spendCapMicros, amountSpentMicros });
    expect(cap(null, '0')).toMatchObject({ result: 'warn', detail: { reason: 'no spending limit is set' } });
    expect(cap('500000000', '399000000')).toMatchObject({ result: 'pass', detail: { usedPct: 79.8 } });
    expect(cap('500000000', '400000000')).toMatchObject({ result: 'warn', detail: { usedPct: 80 } });
    expect(cap('500000000', '650000000')).toMatchObject({ result: 'warn', detail: { usedPct: 130 } });
    expect(cap('500000000', null)).toMatchObject({ result: 'pass', detail: { amountSpentMicros: '0', usedPct: 0 } });
    // Exact in bigint: one micro under 80% of a huge limit still passes.
    expect(cap('9000000000000000001', '7200000000000000000').result).toBe('pass');
  });

  it('the cycle result: fail beats warn beats pass; no_signal alone is ok', () => {
    expect(trustResultOf(['pass', 'no_signal'])).toBe('ok');
    expect(trustResultOf(['pass', 'warn', 'no_signal'])).toBe('degraded');
    expect(trustResultOf(['warn', 'fail'])).toBe('fail');
    expect(trustResultOf([])).toBe('ok');
  });
});

describe('trustStage', () => {
  let t: TestDatabase;
  let world: World;
  beforeEach(async () => {
    t = await createTestDatabase();
    world = await makeWorld(t.db, { slug: 'trust' });
  });
  afterEach(async () => t.drop());

  const signals = (overrides: Partial<AccountTrustSignals> = {}): AccountTrustSignals => ({
    clicks: 50,
    platformConversions: 3,
    spendMicros: '20000000',
    spendCapMicros: '500000000',
    amountSpentMicros: '100000000',
    range: { from: '2026-09-25', to: '2026-10-01' },
    readAt: NOW.toISOString(),
    ...overrides,
  });
  async function synced(accountId: string, overrides: Partial<AccountTrustSignals> = {}, at = NOW) {
    await markAccountSynced(t.db, accountId, { at, trustSignals: signals(overrides) });
    await t.pool.query(`update accounts set timezone = 'Asia/Singapore' where id = $1`, [accountId]);
  }
  async function run(now = NOW) {
    const product = await getProduct(t.db, world.productId);
    const cycle = await startManual(t.db, { productId: world.productId, cycleDate: '2026-10-01' });
    const result = await trustStage(t.db, { product, cycleId: cycle.id, now });
    const table = result.checks.map((c) => [(c.detail as { account?: string }).account ?? null, c.checkId, c.result]);
    return { ...result, cycle, table };
  }

  it('after a real sync of both platforms: everything passes except the Meta limit at 82% (degraded)', async () => {
    const product = await getProduct(t.db, world.productId);
    await syncStage(
      {
        db: t.db,
        masterKey: world.masterKey,
        process: 'cli',
        fetch: replayFetch([...metaCassettes(NOW), ...googleCassettes(NOW)]).fetch,
        tokenFetch,
        now: () => NOW,
      },
      product,
    );
    const { result, table, checks, cycle } = await run();
    expect(table).toEqual([
      ['google:1234567890', 'data_fresh', 'pass'],
      ['google:1234567890', 'timezone_match', 'pass'],
      ['google:1234567890', 'tracking_active', 'pass'],
      ['meta:act_1234567890', 'data_fresh', 'pass'],
      ['meta:act_1234567890', 'timezone_match', 'pass'],
      ['meta:act_1234567890', 'tracking_active', 'pass'],
      ['meta:act_1234567890', 'spend_cap_headroom', 'warn'],
      [null, 'outcome_source_fresh', 'pass'],
    ]);
    expect(result).toBe('degraded');
    expect(checks.at(-2)?.detail).toMatchObject({ spendCapMicros: '500000000', amountSpentMicros: '412340000' });
    // Stored for the cycle; a re-run replaces them instead of adding more.
    expect(await listTrustChecks(t.db, cycle.id)).toHaveLength(8);
    await trustStage(t.db, { product, cycleId: cycle.id, now: NOW });
    expect(await listTrustChecks(t.db, cycle.id)).toHaveLength(8);
  });

  it('fails on stale data and on a timezone mismatch; paused accounts are not checked', async () => {
    await synced(world.metaAccountId, {}, new Date(NOW.getTime() - 30 * HOUR));
    await synced(world.googleAccountId);
    await t.pool.query(`update accounts set timezone = 'America/Los_Angeles' where id = $1`, [world.googleAccountId]);
    const { result, table } = await run();
    expect(result).toBe('fail');
    expect(table.filter((r) => r[2] === 'fail')).toEqual([
      ['google:1234567890', 'timezone_match', 'fail'],
      ['meta:act_1234567890', 'data_fresh', 'fail'],
    ]);

    await setAccountStatus(t.db, world.metaAccountId, 'paused');
    const again = await run();
    expect(again.table.every((r) => r[0] === 'google:1234567890' || r[1] === 'outcome_source_fresh')).toBe(true);
  });

  it('no_signal for low volume and for upload-only conversions before any upload; fail once uploads go unseen', async () => {
    await synced(world.metaAccountId, { clicks: 12, platformConversions: 0 });
    await synced(world.googleAccountId, { clicks: 80, platformConversions: 0 });
    let r = await run();
    expect(r.table.filter((x) => x[1] === 'tracking_active')).toEqual([
      ['google:1234567890', 'tracking_active', 'no_signal'],
      ['meta:act_1234567890', 'tracking_active', 'no_signal'],
    ]);
    expect(r.result).toBe('ok'); // no_signal never degrades a cycle (the Meta limit is at 20%)

    // A signup uploaded to Google in the window that Google doesn't show: tracking is broken.
    await insertOutcomes(t.db, world.productId, [
      { sourceId: 'r1', stage: 'signup', occurredAt: '2026-09-29T03:00:00Z', isTest: false, ids: {} },
    ]);
    const [outcome] = await listOutcomes(t.db, { productId: world.productId, from: new Date('2026-09-01'), to: NOW });
    if (!outcome) throw new Error('no outcome');
    await markFedBack(t.db, 'google', [outcome.id], new Date(NOW.getTime() - 24 * HOUR));
    r = await run();
    expect(r.table.find((x) => x[0] === 'google:1234567890' && x[1] === 'tracking_active')?.[2]).toBe('fail');
    expect(r.result).toBe('fail');
  });

  it('warns when the Meta spending limit is unset; no linked account at all is a fail', async () => {
    await synced(world.metaAccountId, { spendCapMicros: null });
    await synced(world.googleAccountId);
    const r = await run();
    expect(r.table.find((x) => x[1] === 'spend_cap_headroom')?.[2]).toBe('warn');
    expect(r.result).toBe('degraded');

    await setAccountStatus(t.db, world.metaAccountId, 'disconnected');
    await setAccountStatus(t.db, world.googleAccountId, 'paused');
    const none = await run();
    expect(none.table).toEqual([
      [null, 'data_fresh', 'fail'],
      [null, 'outcome_source_fresh', 'pass'],
    ]);
    expect(none.result).toBe('fail');
  });
});
