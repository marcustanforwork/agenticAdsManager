// The seed, run with the real products/seed.json. Expectations are read from that file, so this shared
// package names no product (hard rule 2).
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getFlag } from '../src/repos/plumbing.ts';
import { findProductBySlug, listOfferings, updateSettings } from '../src/repos/products.ts';
import { SeedSpec, seed } from '../src/seed.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let t: TestDatabase;
let raw: unknown;
let spec: SeedSpec;
beforeAll(async () => {
  t = await createTestDatabase();
  raw = JSON.parse(await readFile(new URL('../../../products/seed.json', import.meta.url), 'utf8'));
  spec = SeedSpec.parse(raw);
});
afterAll(async () => t.drop());

describe('the seed (products/seed.json)', () => {
  it('seeds two products, one active and one dormant, and the write switch off', () => {
    expect(spec.products.map((p) => p.status).sort()).toEqual(['active', 'dormant']);
    expect(spec.flags).toEqual({ writes_enabled: false });
  });

  it('creates every product with its status, settings and offerings (facts empty)', async () => {
    const report = await seed(t.db, raw);
    expect(report.productsCreated.sort()).toEqual(spec.products.map((p) => p.slug).sort());
    expect(report.flagsCreated).toEqual(['writes_enabled']);
    for (const p of spec.products) {
      const stored = await findProductBySlug(t.db, p.slug);
      expect(stored?.status).toBe(p.status);
      expect(stored?.packId).toBe(p.packId);
      expect(stored?.settings).toEqual(p.settings);
      const offerings = await listOfferings(t.db, stored?.id ?? '');
      expect(offerings.map((o) => [o.key, o.facts])).toEqual(p.offerings.map((o) => [o.key, {}]));
    }
    expect(await getFlag(t.db, 'writes_enabled')).toBe(false);
  });

  it('is idempotent and never overwrites later changes', async () => {
    const first = spec.products[0];
    if (!first) throw new Error('empty seed');
    const product = await findProductBySlug(t.db, first.slug);
    if (!product) throw new Error('seeded product missing');
    const changed = { ...product.settings, agent: { ...product.settings.agent, analystLookupBudget: 7 } };
    await updateSettings(t.db, { productId: product.id, baseVersion: 1, settings: changed });

    const report = await seed(t.db, raw);
    expect(report.productsCreated).toEqual([]);
    expect(report.flagsCreated).toEqual([]);
    const after = await findProductBySlug(t.db, first.slug);
    expect(after?.settingsVersion).toBe(2);
    expect(after?.settings.agent.analystLookupBudget).toBe(7);
    const { rows } = await t.pool.query<{ n: number }>('select count(*)::int as n from offerings');
    expect(rows[0]?.n).toBe(spec.products.flatMap((p) => p.offerings).length);
  });

  it('rejects a seed file with invalid settings', async () => {
    await expect(
      seed(t.db, { products: [{ slug: 'x', name: 'x', packId: 'x', status: 'active', settings: {} }] }),
    ).rejects.toThrow();
  });
});
