// The dashboard's round trip (M10a): it records a request under its own role (it can't process it), the worker
// processes it, and the dashboard reads the verdict. The actor is bound to who inserted the row (D-068).
import type { OperatorRequest } from '@ads/contracts';
import {
  createProduct,
  ensureOffering,
  getProduct,
  getRequestStatus,
  recordWebRequest,
  type Db,
  type RequestStatus,
} from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  actorsFromEnv,
  processQueuedRequests,
  processRequest,
  type RequestContext,
} from '../src/requests/processor.ts';
import { TEST_PACKS } from './support/world.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const EMAIL = 'marcus@example.com';
const base = TEST_PACKS.get('test-pack');
const packs = createRegistry([
  base,
  {
    runtime: base.runtime,
    manifest: {
      ...base.manifest,
      id: 'facts-pack',
      facts: {
        schema: z.object({ district: z.string().regex(/^D\d{2}$/), units: z.number().int().min(0).optional() }),
        requiredForCopy: [],
      },
    },
  },
]);
const ctx: RequestContext = { actors: actorsFromEnv(`web:${EMAIL},telegram:1001`), packs };

const makeProduct = (packId = 'test-pack', status: 'active' | 'dormant' = 'active') =>
  createProduct(t.db, {
    slug: `w-${randomBytes(4).toString('hex')}`,
    name: 'Web',
    packId,
    status,
    settings: TEST_SETTINGS,
  });

/** Runs `fn` as the dashboard's role. */
const asDashboard = <T>(fn: (db: Db) => Promise<T>): Promise<T> =>
  t.db.transaction(async (tx) => {
    await tx.execute(sql`set local role agent_dashboard`);
    return fn(tx as unknown as Db);
  });

/** Records as the dashboard, lets the worker process it, and reads the verdict as the dashboard. */
async function roundTrip(request: OperatorRequest, email = EMAIL): Promise<RequestStatus> {
  const id = await asDashboard((db) => recordWebRequest(db, { request, email }));
  expect(await asDashboard((db) => getRequestStatus(db, id))).toMatchObject({ status: 'queued' });
  await processRequest(t.db, id, ctx);
  return asDashboard((db) => getRequestStatus(db, id));
}

/** A raw row from the dashboard's role, with any actor and channel it likes. */
async function dashboardRow(actor: string, channel: string, request: OperatorRequest): Promise<string> {
  return asDashboard(async (db) => {
    const { rows } = await db.execute<{ id: string }>(
      sql`insert into operator_requests (kind, payload, actor, channel)
          values (${request.kind}, ${JSON.stringify(request)}::jsonb, ${actor}, ${channel}) returning id`,
    );
    return rows[0]?.id ?? '';
  });
}

describe('round trips (M10a)', () => {
  it('a valid settings patch comes back done, with the new version', async () => {
    const p = await makeProduct();
    const status = await roundTrip({
      kind: 'settings_patch',
      productId: p.id,
      baseVersion: 1,
      patch: { spend: { dailyCeilingMicros: '20000000' } },
    });
    expect(status).toMatchObject({ status: 'done', result: { version: 2 } });
    expect((await getProduct(t.db, p.id)).settings.spend.dailyCeilingMicros).toBe('20000000');
  });

  it('a looser guard override is refused, with the reason', async () => {
    const p = await makeProduct();
    const status = await roundTrip({
      kind: 'settings_patch',
      productId: p.id,
      baseVersion: 1,
      patch: { guardOverrides: { maxBudgetChangePct: 50 } },
    });
    expect(status.status).toBe('refused');
    expect(status.result?.['reason']).toMatch(/loosens maxBudgetChangePct/);
    expect((await getProduct(t.db, p.id)).settingsVersion).toBe(1);
  });

  it('a stale baseVersion is refused', async () => {
    const p = await makeProduct();
    await roundTrip({
      kind: 'settings_patch',
      productId: p.id,
      baseVersion: 1,
      patch: { notifications: { digest: 'off' } },
    });
    const stale = await roundTrip({
      kind: 'settings_patch',
      productId: p.id,
      baseVersion: 1,
      patch: { notifications: { digest: 'always' } },
    });
    expect(stale).toMatchObject({ status: 'refused', result: { reason: 'settings: stale version 1, current is 2' } });
  });

  it("facts the pack's schema rejects are refused, naming them; valid facts are stored", async () => {
    const p = await makeProduct('facts-pack');
    await ensureOffering(t.db, { productId: p.id, kind: 'project', key: 'one', name: 'One' });
    const bad = await roundTrip({ kind: 'facts_put', productId: p.id, offeringKey: 'one', facts: { district: 'X1' } });
    expect(bad.status).toBe('refused');
    expect(bad.result?.['reason']).toMatch(/invalid facts: district/);
    const good = await roundTrip({
      kind: 'facts_put',
      productId: p.id,
      offeringKey: 'one',
      facts: { district: 'D09' },
    });
    expect(good).toMatchObject({ status: 'done', result: { offering: 'one', factsVersion: 2 } });
  });

  it('an email that is not an operator is refused as an unknown actor', async () => {
    const p = await makeProduct();
    const status = await roundTrip({ kind: 'halt', productId: p.id }, 'someone@example.com');
    expect(status).toMatchObject({ status: 'refused', result: { reason: 'unknown actor' } });
  });

  it('the worker drains dashboard rows too', async () => {
    const p = await makeProduct();
    const id = await asDashboard((db) =>
      recordWebRequest(db, { request: { kind: 'halt', productId: p.id }, email: EMAIL }),
    );
    expect(await processQueuedRequests(t.db, ctx)).toBeGreaterThanOrEqual(1);
    expect(await getRequestStatus(t.db, id)).toMatchObject({ status: 'done', result: { halted: [p.slug] } });
  });
});

describe('actor binding (D-068)', () => {
  const refusedReason = 'a request recorded by the dashboard must be a web request with a web: actor';

  it('a row the dashboard role inserts with a telegram: actor, or on the telegram channel, is refused', async () => {
    const p = await makeProduct();
    const halt: OperatorRequest = { kind: 'halt', productId: p.id };
    const ids = [
      await dashboardRow('telegram:1001', 'telegram', halt),
      await dashboardRow('telegram:1001', 'web', halt),
      await dashboardRow(`web:${EMAIL}`, 'telegram', halt),
      await dashboardRow('cli:marcus', 'cli', halt),
    ];
    for (const id of ids) {
      await processRequest(t.db, id, ctx);
      expect(await getRequestStatus(t.db, id)).toMatchObject({ status: 'refused', result: { reason: refusedReason } });
    }
    expect((await getProduct(t.db, p.id)).status).toBe('active');
  });

  it('the worker and the owner may record any channel', async () => {
    const p = await makeProduct();
    const { rows } = await t.db.execute<{ id: string }>(
      sql`insert into operator_requests (kind, payload, actor, channel)
          values ('halt', ${JSON.stringify({ kind: 'halt', productId: p.id })}::jsonb, 'telegram:1001', 'telegram')
          returning id`,
    );
    const owner = rows[0]?.id ?? '';
    await processRequest(t.db, owner, ctx);
    expect(await getRequestStatus(t.db, owner)).toMatchObject({ status: 'done' });

    const viaWorker = await t.db.transaction(async (tx) => {
      await tx.execute(sql`set local role agent_worker`);
      const r = await tx.execute<{ id: string }>(
        sql`insert into operator_requests (kind, payload, actor, channel)
            values ('resume_agent', ${JSON.stringify({ kind: 'resume_agent', productId: p.id })}::jsonb,
                    'telegram:1001', 'telegram') returning id`,
      );
      return r.rows[0]?.id ?? '';
    });
    await processRequest(t.db, viaWorker, ctx);
    expect(await getRequestStatus(t.db, viaWorker)).toMatchObject({ status: 'done' });
  });

  it('a row whose inserting role no longer exists is treated as the dashboard', async () => {
    const p = await makeProduct();
    const { rows } = await t.db.execute<{ id: string }>(
      sql`insert into operator_requests (kind, payload, actor, channel, inserted_by)
          values ('halt', ${JSON.stringify({ kind: 'halt', productId: p.id })}::jsonb, 'telegram:1001', 'telegram',
                  'gone_role') returning id`,
    );
    const id = rows[0]?.id ?? '';
    await processRequest(t.db, id, ctx);
    expect(await getRequestStatus(t.db, id)).toMatchObject({ status: 'refused', result: { reason: refusedReason } });
  });
});

describe('set_product_status (M10a)', () => {
  it('makes a product dormant and active again; an unknown product is refused', async () => {
    const p = await makeProduct();
    expect(await roundTrip({ kind: 'set_product_status', productId: p.id, status: 'dormant' })).toMatchObject({
      status: 'done',
      result: { product: p.slug, from: 'active', to: 'dormant' },
    });
    expect((await getProduct(t.db, p.id)).status).toBe('dormant');
    expect(await roundTrip({ kind: 'set_product_status', productId: p.id, status: 'active' })).toMatchObject({
      status: 'done',
      result: { from: 'dormant', to: 'active' },
    });
    const unknown = await t.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into operator_requests (kind, payload, actor, channel) values ('set_product_status',
            ${JSON.stringify({ kind: 'set_product_status', productId: '00000000-0000-4000-8000-000000000000', status: 'dormant' })}::jsonb,
            ${`web:${EMAIL}`}, 'web') returning id`,
      );
      return r.rows[0]?.id ?? '';
    });
    await processRequest(t.db, unknown, ctx);
    expect(await getRequestStatus(t.db, unknown)).toMatchObject({ status: 'refused' });
  });
});
