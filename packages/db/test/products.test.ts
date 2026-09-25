import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaleVersionError } from '../src/errors.ts';
import {
  createProduct,
  ensureOffering,
  findOffering,
  findProductBySlug,
  getPackManifest,
  getProduct,
  getProductDoc,
  getSettingsHistory,
  listOfferings,
  publishPackManifest,
  putOfferingFacts,
  putProductDoc,
  setProductStatus,
  updateSettings,
} from '../src/repos/products.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { SETTINGS, expectConstraint, makeProduct, uniq } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe('products and settings', () => {
  it('creates a product at settings version 1 and records it in the history', async () => {
    const p = await makeProduct(t.db);
    expect(p.settingsVersion).toBe(1);
    expect(p.status).toBe('active');
    expect(p.currency).toBe('SGD');
    expect(p.timezone).toBe('Asia/Singapore');
    const history = await getSettingsHistory(t.db, p.id);
    expect(history.map((h) => [h.version, h.requestId])).toEqual([[1, null]]);
    expect((await findProductBySlug(t.db, p.slug))?.id).toBe(p.id);
  });

  it('rejects invalid settings on write', async () => {
    const bad = { ...SETTINGS, outcomes: { ...SETTINGS.outcomes, primaryKpiStage: 'nope' } };
    await expect(createProduct(t.db, { slug: uniq('p'), name: 'x', packId: 'x', settings: bad })).rejects.toThrow();
  });

  it('rejects a bad slug in the database too', async () => {
    await expectConstraint(
      createProduct(t.db, { slug: 'Bad Slug', name: 'x', packId: 'x', settings: SETTINGS }),
      'products_slug_check',
    );
  });

  it('validates settings on read: a corrupted document throws', async () => {
    const p = await makeProduct(t.db);
    await t.pool.query(`update products set settings = '{"spend": 1}' where id = $1`, [p.id]);
    await expect(getProduct(t.db, p.id)).rejects.toThrow();
  });

  it('updates settings with optimistic concurrency and keeps every version', async () => {
    const p = await makeProduct(t.db);
    const next = { ...SETTINGS, agent: { ...SETTINGS.agent, analystLookupBudget: 5 } };
    const requestId = '00000000-0000-4000-8000-000000000001';
    expect(await updateSettings(t.db, { productId: p.id, baseVersion: 1, settings: next, requestId })).toBe(2);
    const reread = await getProduct(t.db, p.id);
    expect(reread.settingsVersion).toBe(2);
    expect(reread.settings.agent.analystLookupBudget).toBe(5);
    const history = await getSettingsHistory(t.db, p.id);
    expect(history.map((h) => [h.version, h.settings.agent.analystLookupBudget, h.requestId])).toEqual([
      [1, 20, null],
      [2, 5, requestId],
    ]);
  });

  it('refuses a stale baseVersion and changes nothing', async () => {
    const p = await makeProduct(t.db);
    await updateSettings(t.db, { productId: p.id, baseVersion: 1, settings: SETTINGS });
    const attempt = updateSettings(t.db, { productId: p.id, baseVersion: 1, settings: SETTINGS });
    await expect(attempt).rejects.toBeInstanceOf(StaleVersionError);
    await expect(attempt).rejects.toMatchObject({ expected: 1, actual: 2 });
    expect((await getSettingsHistory(t.db, p.id)).length).toBe(2);
  });

  it('lets only one of two concurrent updates on the same base win', async () => {
    const p = await makeProduct(t.db);
    const results = await Promise.allSettled([
      updateSettings(t.db, { productId: p.id, baseVersion: 1, settings: SETTINGS }),
      updateSettings(t.db, { productId: p.id, baseVersion: 1, settings: SETTINGS }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getProduct(t.db, p.id)).settingsVersion).toBe(2);
  });

  it('sets the product status, and the database rejects unknown ones', async () => {
    const p = await makeProduct(t.db);
    await setProductStatus(t.db, p.id, 'halted');
    expect((await getProduct(t.db, p.id)).status).toBe('halted');
    await expectConstraint(
      t.pool.query(`update products set status = 'gone' where id = $1`, [p.id]),
      'products_status_check',
    );
  });
});

describe('product documents', () => {
  it('versions each document and refuses a stale base', async () => {
    const p = await makeProduct(t.db);
    expect(await getProductDoc(t.db, p.id, 'strategy')).toBeNull();
    expect(await putProductDoc(t.db, { productId: p.id, doc: 'strategy', baseVersion: 0, markdown: '# v1' })).toBe(1);
    expect(await putProductDoc(t.db, { productId: p.id, doc: 'strategy', baseVersion: 1, markdown: '# v2' })).toBe(2);
    await expect(
      putProductDoc(t.db, { productId: p.id, doc: 'strategy', baseVersion: 1, markdown: '# late' }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect((await getProductDoc(t.db, p.id, 'strategy'))?.markdown).toBe('# v2');
    expect(await putProductDoc(t.db, { productId: p.id, doc: 'playbook', baseVersion: 0, markdown: 'p' })).toBe(1);
  });
});

describe('offerings', () => {
  it('ensures an offering once, and keeps its facts on a repeat', async () => {
    const p = await makeProduct(t.db);
    const o = await ensureOffering(t.db, { productId: p.id, kind: 'project', key: 'k', name: 'K' });
    expect(o.facts).toEqual({});
    expect(await putOfferingFacts(t.db, { productId: p.id, key: 'k', facts: { units: 3 } })).toBe(2);
    const again = await ensureOffering(t.db, { productId: p.id, kind: 'project', key: 'k', name: 'K' });
    expect(again.id).toBe(o.id);
    expect(again.facts).toEqual({ units: 3 });
    expect((await findOffering(t.db, p.id, 'k'))?.factsVersion).toBe(2);
    expect((await listOfferings(t.db, p.id)).map((x) => x.key)).toEqual(['k']);
  });
});

describe('pack manifests', () => {
  it('publishes and re-publishes a manifest version', async () => {
    await publishPackManifest(t.db, { packId: 'test-pack', version: '1.0.0', manifest: { a: 1 } });
    await publishPackManifest(t.db, { packId: 'test-pack', version: '1.0.0', manifest: { a: 2 } });
    expect((await getPackManifest(t.db, 'test-pack', '1.0.0'))?.manifest).toEqual({ a: 2 });
  });
});
