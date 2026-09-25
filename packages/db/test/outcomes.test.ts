import type { OutcomeEvent } from '@ads/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertOutcomes, listOutcomes, listUnattributed, markFedBack, setAttribution } from '../src/repos/outcomes.ts';
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
  });
});
