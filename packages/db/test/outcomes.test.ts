import type { OutcomeEvent } from '@ads/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countFedBackSince,
  countOutcomesByStage,
  insertOutcomes,
  listOutcomes,
  listUnattributed,
  markFedBack,
  setAttribution,
  upsertOutcomes,
} from '../src/repos/outcomes.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { makeCampaign } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const event = (sourceId: string, overrides: Partial<OutcomeEvent> = {}): OutcomeEvent => ({
  sourceId,
  stage: 'signup',
  occurredAt: '2026-09-20T03:00:00Z',
  isTest: false,
  ids: { gclid: 'g-1', utmSource: 'google' },
  hashedContact: { emailSha256: 'a'.repeat(64) },
  ...overrides,
});

describe('outcomes', () => {
  it('inserts new outcomes once per (product, source id, stage)', async () => {
    const { product } = await makeCampaign(t.db);
    expect(await insertOutcomes(t.db, product.id, [event('r1'), event('r2', { valueMicros: '5000000' })])).toBe(2);
    expect(await insertOutcomes(t.db, product.id, [event('r1'), event('r1', { stage: 'activated' })])).toBe(1);
    const rows = await listOutcomes(t.db, {
      productId: product.id,
      from: new Date('2026-09-01'),
      to: new Date('2026-10-01'),
    });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.sourceId === 'r2')?.valueMicros).toBe(5_000_000n);
    expect(rows[0]?.ids).toEqual({ gclid: 'g-1', utmSource: 'google' });
  });

  it('rejects an event that breaks the contract (e.g. a raw email instead of a hash)', async () => {
    const { product } = await makeCampaign(t.db);
    const bad = event('r9', { hashedContact: { emailSha256: 'someone@example.com' } });
    await expect(insertOutcomes(t.db, product.id, [bad])).rejects.toThrow();
  });

  it('leaves test outcomes out of listings unless asked', async () => {
    const { product } = await makeCampaign(t.db);
    await insertOutcomes(t.db, product.id, [event('real'), event('test', { isTest: true })]);
    const range = { productId: product.id, from: new Date('2026-09-01'), to: new Date('2026-10-01') };
    expect((await listOutcomes(t.db, range)).map((r) => r.sourceId)).toEqual(['real']);
    expect(await listOutcomes(t.db, { ...range, includeTest: true })).toHaveLength(2);
  });

  it('attributes outcomes and marks uploads once per platform', async () => {
    const { product, campaign } = await makeCampaign(t.db);
    await insertOutcomes(t.db, product.id, [event('a'), event('b')]);
    const unattributed = await listUnattributed(t.db, product.id);
    expect(unattributed).toHaveLength(2);
    const [first, second] = unattributed;
    if (!first || !second) throw new Error('expected two outcomes');
    await setAttribution(t.db, { outcomeId: first.id, entityId: campaign.id, method: 'gclid_lookup' });
    await setAttribution(t.db, { outcomeId: second.id, entityId: null, method: 'none' });
    expect(await listUnattributed(t.db, product.id)).toHaveLength(0);

    expect(await markFedBack(t.db, 'google', [first.id, second.id])).toBe(2);
    expect(await markFedBack(t.db, 'google', [first.id])).toBe(0); // already uploaded
    expect(await markFedBack(t.db, 'meta', [first.id])).toBe(1); // the other platform is separate

    const since = new Date(Date.now() - 60_000);
    const count = (platform: 'google' | 'meta', stage = 'signup', from = since) =>
      countFedBackSince(t.db, { productId: product.id, platform, stage, since: from });
    expect(await count('google')).toBe(2);
    expect(await count('meta')).toBe(1);
    expect(await count('google', 'activated')).toBe(0);
    expect(await count('google', 'signup', new Date(Date.now() + 60_000))).toBe(0);
  });
});

describe('upsertOutcomes (M05a)', () => {
  it('inserts new outcomes with their web context, and on a re-read refreshes only is_test', async () => {
    const { product } = await makeCampaign(t.db);
    const web = { userAgent: 'Mozilla/5.0', pageUrl: 'https://example.com/start' };
    expect(await upsertOutcomes(t.db, product.id, [event('u1', { web }), event('u2'), event('u2')])).toEqual({
      inserted: 2,
      testFlagChanged: 0,
    });
    // Re-read: u1 is now test traffic (a domain was added) and its ids changed at the source; u3 is new.
    const again = [event('u1', { isTest: true, ids: { fbclid: 'other' }, web: undefined }), event('u2'), event('u3')];
    expect(await upsertOutcomes(t.db, product.id, again)).toEqual({ inserted: 1, testFlagChanged: 1 });
    const rows = await listOutcomes(t.db, {
      productId: product.id,
      from: new Date('2026-09-01'),
      to: new Date('2026-10-01'),
      includeTest: true,
    });
    const u1 = rows.find((r) => r.sourceId === 'u1');
    expect(u1).toMatchObject({ isTest: true, ids: { gclid: 'g-1', utmSource: 'google' }, web });
    expect(rows.map((r) => r.sourceId).sort()).toEqual(['u1', 'u2', 'u3']);
    expect(await upsertOutcomes(t.db, product.id, [])).toEqual({ inserted: 0, testFlagChanged: 0 });
  });

  it('counts outcomes by stage in a window, test traffic apart', async () => {
    const { product } = await makeCampaign(t.db);
    await upsertOutcomes(t.db, product.id, [
      event('c1'),
      event('c2', { isTest: true }),
      event('c1', { stage: 'activated' }),
      event('c3', { occurredAt: '2026-08-01T00:00:00Z' }),
    ]);
    expect(
      await countOutcomesByStage(t.db, {
        productId: product.id,
        from: new Date('2026-09-01'),
        to: new Date('2026-10-01'),
      }),
    ).toEqual([
      { stage: 'activated', outcomes: 1, test: 0 },
      { stage: 'signup', outcomes: 1, test: 1 },
    ]);
  });
});
