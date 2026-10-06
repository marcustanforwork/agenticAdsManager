// Settings (M05a): defaults from the pack, the pack's guard layer, the one validator (settings_patch), invalid
// stored settings stopping the cycle with an alert, version history, seeding and manifest publishing.
import { type ProductSettings, type ProductPack } from '@ads/contracts';
import {
  createProduct,
  getPackManifest,
  getProduct,
  getOperatorRequest,
  listCycles,
  listUnsentNotifications,
  type Product,
} from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { UnknownPackError, createRegistry } from '@ads/pack-sdk';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actorsFromEnv,
  changedPaths,
  publishPackManifests,
  runCycle,
  seedSpecFromPacks,
  settingsFromPack,
  settingsHistory,
  submitRequest,
  type RequestContext,
} from '../src/index.ts';
import { NOW, TEST_PACKS } from './support/world.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const testPack = TEST_PACKS.get('test-pack');
/** A pack that tightens a guard: products on it may only tighten further. */
const strictPack: ProductPack = {
  manifest: { ...testPack.manifest, id: 'strict-pack', guardOverrides: { cooldownDays: 10 } },
  runtime: testPack.runtime,
};
const packs = createRegistry([testPack, strictPack]);
const ctx: RequestContext = { actors: actorsFromEnv('cli:marcus'), packs };

const makeProduct = (packId = 'test-pack', settings: ProductSettings = settingsFromPack(testPack.manifest)) =>
  createProduct(t.db, { slug: `s-${randomBytes(4).toString('hex')}`, name: 'S', packId, settings });

const patch = (product: Product, body: Record<string, unknown>, baseVersion = product.settingsVersion) =>
  submitRequest(
    t.db,
    {
      request: { kind: 'settings_patch', productId: product.id, baseVersion, patch: body },
      actor: 'cli:marcus',
      channel: 'cli',
    },
    ctx,
  );

const corrupt = (product: Product, json: string) =>
  t.pool.query(`update products set settings = settings || $2::jsonb where id = $1`, [product.id, json]);

describe('settings from the pack', () => {
  it("are the core defaults with the pack's outcomes and copy", () => {
    const s = settingsFromPack(testPack.manifest);
    expect(s.outcomes).toEqual(testPack.manifest.defaults.outcomes);
    expect(s.copy).toEqual(testPack.manifest.defaults.copy);
    expect(s.spend).toEqual({ dailyCeilingMicros: null, monthlyCeilingMicros: null, autoPauseOnMonthlyBreach: false });
    expect(s.testTraffic.emailDomains).toEqual([]);
    expect(s.guardOverrides).toEqual({});
  });

  it('fill a seed file’s missing settings; listed settings are kept; an unknown pack is an error', () => {
    const own = settingsFromPack(testPack.manifest);
    const spec = seedSpecFromPacks(
      {
        products: [
          { slug: 'a', name: 'A', packId: 'strict-pack', status: 'active' },
          { slug: 'b', name: 'B', packId: 'other', status: 'dormant', settings: own },
        ],
        flags: { writes_enabled: false },
      },
      packs,
    );
    expect(spec.products[0]?.settings).toEqual(settingsFromPack(strictPack.manifest));
    expect(spec.products[1]?.settings).toBe(own);
    expect(spec.flags).toEqual({ writes_enabled: false });
    expect(() =>
      seedSpecFromPacks({ products: [{ slug: 'c', name: 'C', packId: 'nope', status: 'active' }] }, packs),
    ).toThrow(UnknownPackError);
  });
});

describe('settings_patch (the one validator)', () => {
  it('applies a valid patch as a new version; an unknown KPI stage is rejected', async () => {
    const p = await makeProduct();
    const ok = await patch(p, {
      spend: { monthlyCeilingMicros: '500000000' },
      testTraffic: { emailDomains: ['example.com'] },
    });
    expect(ok.outcome).toEqual({ status: 'done', result: { version: 2 } });
    const after = await getProduct(t.db, p.id);
    expect(after.settings.spend.monthlyCeilingMicros).toBe('500000000');

    const bad = await patch(after, { outcomes: { primaryKpiStage: 'purchase' } });
    expect(bad.outcome.status).toBe('refused');
    expect(bad.outcome.result['reason']).toContain('outcomes.primaryKpiStage: must be one of the stage ids');
    expect((await getProduct(t.db, p.id)).settingsVersion).toBe(2);
  });

  it('refuses a stale baseVersion and changes nothing', async () => {
    const p = await makeProduct();
    await patch(p, { notifications: { digest: 'always' } });
    const stale = await patch(p, { notifications: { digest: 'off' } }, 1);
    expect(stale.outcome).toMatchObject({ status: 'refused' });
    expect(String(stale.outcome.result['reason'])).toMatch(/stale|version/i);
    expect((await getProduct(t.db, p.id)).settings.notifications.digest).toBe('always');
  });

  it("checks guard overrides against the pack's layer too", async () => {
    const p = await makeProduct('strict-pack');
    const looser = await patch(p, { guardOverrides: { cooldownDays: 8 } }); // tighter than core (7), looser than the pack (10)
    expect(looser.outcome.status).toBe('refused');
    expect(String(looser.outcome.result['reason'])).toContain('cooldownDays');
    expect((await patch(p, { guardOverrides: { cooldownDays: 12 } })).outcome.status).toBe('done');
  });

  it('can repair a stored document that fails validation, and refuses a patch that leaves it invalid', async () => {
    const p = await makeProduct();
    await corrupt(p, '{"notifications": {"digest": "sometimes"}}');
    const still = await patch(p, { spend: { dailyCeilingMicros: '20000000' } });
    expect(still.outcome.status).toBe('refused');
    expect(String(still.outcome.result['reason'])).toContain('notifications.digest');
    expect((await getOperatorRequest(t.db, still.id)).status).toBe('refused');
    const fixed = await patch(p, { notifications: { digest: 'auto' } });
    expect(fixed.outcome).toEqual({ status: 'done', result: { version: 2 } });
    expect((await getProduct(t.db, p.id)).settings.notifications.digest).toBe('auto');
  });

  it('keeps every version, with what each one changed', async () => {
    const p = await makeProduct();
    await patch(p, { spend: { monthlyCeilingMicros: '500000000' } });
    const v2 = await getProduct(t.db, p.id);
    await patch(v2, { outcomes: { primaryKpiStage: 'signup' }, testTraffic: { emailDomains: ['example.com'] } });
    const history = await settingsHistory(t.db, p.id);
    expect(history.map((h) => [h.version, h.changed])).toEqual([
      [1, []],
      [2, ['spend.monthlyCeilingMicros']],
      [3, ['testTraffic.emailDomains']],
    ]);
    expect(history[1]?.requestId).not.toBeNull();
    expect(changedPaths({ a: [1], b: { c: 1 } }, { a: [1, 2], b: { c: 1, d: 2 } })).toEqual(['a', 'b.d']);
  });
});

describe('invalid stored settings stop the cycle with an alert', () => {
  const deps = { lockUrl: '', masterKey: undefined as never, process: 'worker' as const, now: () => NOW, packs };

  it('a bad stored value is detected on read: nothing runs, an alert is queued', async () => {
    const p = await makeProduct();
    await corrupt(p, '{"spend": {"dailyCeilingMicros": 12.5}}');
    const summary = await runCycle({ ...deps, db: t.db, lockUrl: t.url }, { productId: p.id, kind: 'daily' });
    expect(summary).toMatchObject({ product: p.slug, outcome: 'blocked', cycleId: null });
    expect(summary.detail).toContain('spend');
    expect(await listCycles(t.db, p.id)).toHaveLength(0);
    const alerts = (await listUnsentNotifications(t.db, 500)).filter((n) => n.productId === p.id);
    expect(alerts.map((a) => [a.kind, (a.payload as { alert: string }).alert])).toEqual([
      ['alert', 'invalid_settings'],
    ]);
  });

  it('queues one alert, not one per attempt; a product that is not active is skipped without one', async () => {
    const p = await makeProduct();
    await corrupt(p, '{"spend": 1}');
    for (let i = 0; i < 3; i++) {
      expect((await runCycle({ ...deps, db: t.db, lockUrl: t.url }, { productId: p.id, kind: 'manual' })).outcome).toBe(
        'blocked',
      );
    }
    const mine = async () => (await listUnsentNotifications(t.db, 500)).filter((n) => n.productId === p.id);
    expect(await mine()).toHaveLength(1);

    const paused = await makeProduct();
    await corrupt(paused, '{"spend": 1}');
    await t.pool.query(`update products set status = 'dormant' where id = $1`, [paused.id]);
    const summary = await runCycle({ ...deps, db: t.db, lockUrl: t.url }, { productId: paused.id, kind: 'daily' });
    expect(summary).toMatchObject({ outcome: 'skipped', detail: 'product is dormant' });
    expect((await listUnsentNotifications(t.db, 500)).filter((n) => n.productId === paused.id)).toHaveLength(0);
  });

  it("a stored guard override looser than the pack's (after a pack update) is invalid too", async () => {
    // Stored while the product used the test pack, then moved to the strict one.
    const p = await makeProduct('test-pack', {
      ...settingsFromPack(testPack.manifest),
      guardOverrides: { cooldownDays: 8 },
    });
    await t.pool.query(`update products set pack_id = 'strict-pack' where id = $1`, [p.id]);
    const summary = await runCycle({ ...deps, db: t.db, lockUrl: t.url }, { productId: p.id, kind: 'daily' });
    expect(summary).toMatchObject({ outcome: 'blocked' });
    expect(summary.detail).toContain('guardOverrides.cooldownDays');
  });

  it('halt still works on a product whose settings are broken', async () => {
    const p = await makeProduct();
    await corrupt(p, '{"spend": 1}');
    const halted = await submitRequest(
      t.db,
      { request: { kind: 'halt', productId: p.id }, actor: 'cli:marcus', channel: 'cli' },
      ctx,
    );
    expect(halted.outcome).toEqual({ status: 'done', result: { halted: [p.slug] } });
  });
});

describe('publishPackManifests', () => {
  it('publishes each installed pack, with its fact schema as JSON Schema', async () => {
    expect(await publishPackManifests(t.db, packs)).toEqual(['strict-pack@1.0.0', 'test-pack@1.0.0']);
    const row = await getPackManifest(t.db, 'strict-pack', '1.0.0');
    expect(row?.manifest).toMatchObject({
      id: 'strict-pack',
      guardOverrides: { cooldownDays: 10 },
      facts: { jsonSchema: { type: 'object' } },
    });
  });
});
