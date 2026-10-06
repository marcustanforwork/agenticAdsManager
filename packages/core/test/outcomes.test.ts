// Reading a product's outcomes through its pack (M05a), and the outcome_source_fresh trust check.
import type { OutcomeAdapter, OutcomeEvent, ProductPack } from '@ads/contracts';
import { getProduct, listOutcomes, outcomeSourceOf, setOutcomeSource } from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTCOME_LOOKBACK_DAYS, outcomeSourceFresh, syncOutcomes } from '../src/index.ts';
import { NOW, TEST_PACKS, type World, makeWorld } from './support/world.ts';

const HOUR = 3_600_000;
const testPack = TEST_PACKS.get('test-pack');
const withAdapter = (adapter: Partial<OutcomeAdapter> | (() => never)): ProductPack => ({
  manifest: testPack.manifest,
  runtime: {
    ...testPack.runtime,
    outcomeAdapter:
      typeof adapter === 'function'
        ? adapter
        : () => ({
            fetchSince: () => Promise.resolve([]),
            healthcheck: () => Promise.resolve({ ok: true, latestActivityAt: NOW }),
            ...adapter,
          }),
  },
});

describe('syncOutcomes', () => {
  let t: TestDatabase;
  let world: World;
  beforeEach(async () => {
    t = await createTestDatabase();
    world = await makeWorld(t.db, { slug: 'outcomes' });
  });
  afterEach(async () => t.drop());
  const deps = (packs = TEST_PACKS, now = NOW) => ({ db: t.db, packs, env: {}, now: () => now });
  const product = () => getProduct(t.db, world.productId);
  const stored = async () =>
    listOutcomes(t.db, { productId: world.productId, from: new Date('2026-01-01'), to: NOW, includeTest: true });

  it('stores what the adapter read, keeps test traffic flagged, and records the read', async () => {
    const summary = await syncOutcomes(deps(), await product());
    expect(summary).toMatchObject({ outcome: 'read', events: 2, new: 2, skipped: 0, testFlagChanged: 0 });
    expect(summary.since).toBe(new Date(NOW.getTime() - OUTCOME_LOOKBACK_DAYS * 86_400_000).toISOString());
    expect((await stored()).map((o) => [o.sourceId, o.isTest])).toEqual([
      ['w1', false],
      ['w2', true],
    ]);
    expect(outcomeSourceOf(await product())).toMatchObject({
      checkedAt: NOW.toISOString(),
      ok: true,
      latestActivityAt: new Date(NOW.getTime() - HOUR).toISOString(),
      read: { events: 2, new: 2, skipped: 0 },
    });
    // A second read stores nothing new; a read already made in this cycle is skipped.
    expect(await syncOutcomes(deps(), await product())).toMatchObject({ outcome: 'read', new: 0 });
    expect(await syncOutcomes(deps(), await product(), { readSince: new Date(NOW.getTime() - HOUR) })).toEqual({
      outcome: 'skipped',
      detail: 'already read in this cycle',
    });
  });

  it('keeps outcomes the source no longer has, and follows the source on the test flag', async () => {
    let events: OutcomeEvent[] = [
      { sourceId: 'a', stage: 'signup', occurredAt: '2026-09-28T00:00:00Z', isTest: false, ids: {} },
      { sourceId: 'b', stage: 'signup', occurredAt: '2026-09-28T01:00:00Z', isTest: false, ids: {} },
    ];
    const packs = createRegistry([withAdapter({ fetchSince: () => Promise.resolve(events) })]);
    await syncOutcomes(deps(packs), await product());
    // The source deleted `a` (a pending request after 30 days) and marked `b` as test traffic.
    events = [{ ...events[1], isTest: true } as OutcomeEvent];
    expect(await syncOutcomes(deps(packs), await product())).toMatchObject({ new: 0, testFlagChanged: 1 });
    expect((await stored()).map((o) => [o.sourceId, o.isTest])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('leaves out events for stages the settings lack, and malformed ones', async () => {
    const events = [
      { sourceId: 'x', stage: 'signup', occurredAt: '2026-09-28T00:00:00Z', isTest: false, ids: {} },
      { sourceId: 'y', stage: 'purchase', occurredAt: '2026-09-28T00:00:00Z', isTest: false, ids: {} },
      { sourceId: 'z', stage: 'signup', occurredAt: 'yesterday', isTest: false, ids: {} },
    ] as OutcomeEvent[];
    const packs = createRegistry([withAdapter({ fetchSince: () => Promise.resolve(events) })]);
    expect(await syncOutcomes(deps(packs), await product())).toMatchObject({ events: 3, new: 1, skipped: 2 });
  });

  it('reads page after page from the last time it saw', async () => {
    const all: OutcomeEvent[] = Array.from({ length: 5 }, (_, i) => ({
      sourceId: `p${i}`,
      stage: 'signup',
      occurredAt: new Date(Date.UTC(2026, 8, 20 + i)).toISOString(),
      isTest: false,
      ids: {},
    }));
    const calls: string[] = [];
    const packs = createRegistry([
      withAdapter({
        fetchSince: (since, limit = 2) => {
          calls.push(since.toISOString());
          return Promise.resolve(all.filter((e) => Date.parse(e.occurredAt) >= since.getTime()).slice(0, limit));
        },
      }),
    ]);
    expect(await syncOutcomes(deps(packs), await product(), { pageSize: 2 })).toMatchObject({ new: 5 });
    // Each next page starts at the last time seen (inclusive: a repeated row is stored once).
    expect(calls.slice(1)).toEqual([1, 2, 3, 4].map((i) => all[i]?.occurredAt));
  });

  it('fails the read, instead of silently stopping, when a full page cannot move on', async () => {
    const same = '2026-09-28T00:00:00.000Z';
    const page: OutcomeEvent[] = ['a', 'b'].map((id) => ({
      sourceId: id,
      stage: 'signup',
      occurredAt: same,
      isTest: false,
      ids: {},
    }));
    const packs = createRegistry([withAdapter({ fetchSince: () => Promise.resolve(page) })]);
    const first = await syncOutcomes(deps(packs), await product(), { pageSize: 2 });
    // The first page moved from the window's start to `same`; the second starts at `same` and can't move.
    expect(first.outcome).toBe('error');
    expect(first.detail).toMatch(/paging stopped/);
    expect(outcomeSourceOf(await product())).toMatchObject({ ok: false });
  });

  it('treats a bad activity time from the adapter as unknown, not as a crash', async () => {
    const packs = createRegistry([
      withAdapter({ healthcheck: () => Promise.resolve({ ok: true, latestActivityAt: new Date('nonsense') }) }),
    ]);
    expect(await syncOutcomes(deps(packs), await product())).toMatchObject({ outcome: 'read', latestActivityAt: null });
    expect(outcomeSourceOf(await product())).toMatchObject({ ok: true, latestActivityAt: null });
  });

  it('records a source that is unhealthy, throws, or cannot start, without throwing', async () => {
    const cases: [ProductPack, RegExp][] = [
      [withAdapter({ healthcheck: () => Promise.resolve({ ok: false, detail: 'DB_URL is not set' }) }), /DB_URL/],
      [withAdapter({ fetchSince: () => Promise.reject(new Error('connection reset')) }), /reading outcomes failed/],
      [
        withAdapter(() => {
          throw new Error('bad env');
        }),
        /could not start: bad env/,
      ],
    ];
    for (const [pack, detail] of cases) {
      const summary = await syncOutcomes(deps(createRegistry([pack])), await product());
      expect(summary.outcome).toBe('error');
      expect(summary.detail).toMatch(detail);
      expect(outcomeSourceOf(await product())).toMatchObject({ ok: false, latestActivityAt: null });
    }
    const none = await syncOutcomes(deps(createRegistry([])), await product());
    expect(none.outcome).toBe('error');
    expect(none.detail).toMatch(/no pack "test-pack"/);
  });

  it('records a read that never finished as not read: the trust check fails on it', async () => {
    await setOutcomeSource(t.db, world.productId, {
      checkedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
      ok: true,
      latestActivityAt: NOW.toISOString(),
    });
    const state = outcomeSourceOf(await product());
    expect(outcomeSourceFresh({ state, now: NOW, maxStalenessHours: 48 }).result).toBe('fail');
  });
});

describe('outcome_source_fresh (table)', () => {
  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  const check = (state: Parameters<typeof outcomeSourceFresh>[0]['state']) =>
    outcomeSourceFresh({ state, now: NOW, maxStalenessHours: 48 });

  it.each([
    ['never read', null, 'fail'],
    ['unreadable', { checkedAt: at(1), ok: false, latestActivityAt: null, detail: 'x' }, 'fail'],
    ['read 26 hours ago', { checkedAt: at(26), ok: true, latestActivityAt: at(27) }, 'fail'],
    ['healthy, no activity yet', { checkedAt: at(1), ok: true, latestActivityAt: null }, 'warn'],
    ['healthy but quiet', { checkedAt: at(1), ok: true, latestActivityAt: at(48.1) }, 'warn'],
    ['healthy, active within 48 hours', { checkedAt: at(25.9), ok: true, latestActivityAt: at(48) }, 'pass'],
  ] as const)('%s → %s', (_name, state, result) => {
    expect(check(state).result).toBe(result);
  });
});
