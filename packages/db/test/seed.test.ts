import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listOfferings, findProductBySlug, updateSettings } from '../src/repos/products.ts';
import { getFlag } from '../src/repos/plumbing.ts';
import { seed } from '../src/seed.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let t: TestDatabase;
let spec: unknown;
beforeAll(async () => {
  t = await createTestDatabase();
  spec = JSON.parse(await readFile(new URL('../../../products/seed.json', import.meta.url), 'utf8'));
});
afterAll(async () => t.drop());

describe('the seed (products/seed.json)', () => {
  it('creates both products, the offering and the write switch (off)', async () => {
    const report = await seed(t.db, spec);
    expect(report.productsCreated.sort()).toEqual(['property-sg', 'snappool']);
    expect(report.flagsCreated).toEqual(['writes_enabled']);
    const snappool = await findProductBySlug(t.db, 'snappool');
    const property = await findProductBySlug(t.db, 'property-sg');
    expect(snappool?.status).toBe('active');
    expect(snappool?.settings.outcomes.primaryKpiStage).toBe('signup');
    expect(property?.status).toBe('dormant');
    const offerings = await listOfferings(t.db, property?.id ?? '');
    expect(offerings.map((o) => [o.key, o.facts])).toEqual([['sora-at-lakeside', {}]]);
    expect(await getFlag(t.db, 'writes_enabled')).toBe(false);
  });

  it('is idempotent and never overwrites later changes', async () => {
    const snappool = await findProductBySlug(t.db, 'snappool');
    if (!snappool) throw new Error('seeded product missing');
    const changed = { ...snappool.settings, agent: { ...snappool.settings.agent, analystLookupBudget: 7 } };
    await updateSettings(t.db, { productId: snappool.id, baseVersion: 1, settings: changed });

    const report = await seed(t.db, spec);
    expect(report.productsCreated).toEqual([]);
    expect(report.flagsCreated).toEqual([]);
    const after = await findProductBySlug(t.db, 'snappool');
    expect(after?.settingsVersion).toBe(2);
    expect(after?.settings.agent.analystLookupBudget).toBe(7);
    const { rows } = await t.pool.query<{ n: number }>('select count(*)::int as n from offerings');
    expect(rows[0]?.n).toBe(2);
  });

  it('rejects a seed file with invalid settings', async () => {
    await expect(
      seed(t.db, { products: [{ slug: 'x', name: 'x', packId: 'x', status: 'active', settings: {} }] }),
    ).rejects.toThrow();
  });
});
