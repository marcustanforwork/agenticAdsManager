// The dashboard's round trip (M10a): it records a request under its own role (it can't process it), the worker
// processes it, and the dashboard reads the verdict. The actor is bound to who inserted the row (D-068).
import type { OperatorRequest } from '@ads/contracts';
import {
  createProduct,
  createProposal,
  ensureOffering,
  getBrief,
  getProductDoc,
  getProposal,
  insertBrief,
  insertChange,
  listDecisions,
  getProduct,
  getRequestStatus,
  recordWebRequest,
  type DbOrTx,
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
const asDashboard = <T>(fn: (db: DbOrTx) => Promise<T>): Promise<T> =>
  t.db.transaction(async (tx) => {
    await tx.execute(sql`set local role agent_dashboard`);
    return fn(tx);
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

  it('a patch that changes nothing makes no new version', async () => {
    const p = await makeProduct();
    const same = await roundTrip({
      kind: 'settings_patch',
      productId: p.id,
      baseVersion: 1,
      patch: { notifications: { digest: TEST_SETTINGS.notifications.digest } },
    });
    expect(same).toMatchObject({ status: 'done', result: { version: 1, unchanged: true } });
    expect((await getProduct(t.db, p.id)).settingsVersion).toBe(1);
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

  it('a role with the dashboard’s privileges is never trusted, even if it can also update requests', async () => {
    await t.db.execute(sql`drop role if exists ads_test_broad`);
    await t.db.execute(sql`create role ads_test_broad nologin in role agent_dashboard, agent_worker`);
    const p = await makeProduct();
    const id = await t.db.transaction(async (tx) => {
      await tx.execute(sql`set local role ads_test_broad`);
      const r = await tx.execute<{ id: string }>(
        sql`insert into operator_requests (kind, payload, actor, channel)
            values ('halt', ${JSON.stringify({ kind: 'halt', productId: p.id })}::jsonb, 'telegram:1001', 'telegram')
            returning id`,
      );
      return r.rows[0]?.id ?? '';
    });
    await processRequest(t.db, id, ctx);
    expect(await getRequestStatus(t.db, id)).toMatchObject({ status: 'refused', result: { reason: refusedReason } });
    await t.db.execute(sql`delete from operator_requests where inserted_by = 'ads_test_broad'`);
    await t.db.execute(sql`drop role ads_test_broad`);
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
    // A halted product is refused: only resume_agent un-halts it.
    await roundTrip({ kind: 'halt', productId: p.id });
    for (const status of ['active', 'dormant'] as const) {
      expect(await roundTrip({ kind: 'set_product_status', productId: p.id, status })).toMatchObject({
        status: 'refused',
        result: { reason: `${p.slug} is halted: resume the agent first (resume_agent)` },
      });
    }
    expect((await getProduct(t.db, p.id)).status).toBe('halted');
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

describe('review actions from the dashboard (M10b)', () => {
  const ref = { platform: 'google' as const, accountId: '1234567890', type: 'campaign' as const, externalId: '11' };
  const propose = (productId: string, action: Parameters<typeof createProposal>[1]['action']) =>
    createProposal(t.db, {
      productId,
      origin: 'agent',
      action,
      undo: null,
      preconditionHash: null,
      preconditionFields: [],
      rationale: 'r',
      expectedEffect: 'e',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

  it('approve, reject and edit_approve record the decision as web, by the signed-in email', async () => {
    const product = await makeProduct();
    const a = await propose(product.id, { action: 'pause_entity', target: ref });
    const r = await propose(product.id, { action: 'pause_entity', target: { ...ref, externalId: '12' } });
    const e = await propose(product.id, {
      action: 'add_negative_keyword',
      target: ref,
      text: 'free',
      matchType: 'PHRASE',
    });
    expect(await roundTrip({ kind: 'approve', proposalId: a.id, version: 1, actionHash: a.actionHash })).toMatchObject({
      status: 'done',
      result: { decision: 'approve' },
    });
    expect(await roundTrip({ kind: 'reject', proposalId: r.id, version: 1, reason: 'too early' })).toMatchObject({
      status: 'done',
      result: { decision: 'reject' },
    });
    expect(
      await roundTrip({
        kind: 'edit_approve',
        proposalId: e.id,
        version: 1,
        edit: { field: 'match_type', matchType: 'EXACT' },
      }),
    ).toMatchObject({ status: 'done' });
    expect((await getProposal(t.db, e.id)).action).toMatchObject({ matchType: 'EXACT' });
    const decisions = await listDecisions(t.db, product.id);
    expect(decisions.map((d) => [d.shortId, d.decision, d.actor, d.channel]).sort()).toEqual(
      [
        [a.shortId, 'approve', `web:${EMAIL}`, 'web'],
        [r.shortId, 'reject', `web:${EMAIL}`, 'web'],
        [e.shortId, 'approve', `web:${EMAIL}`, 'web'],
      ].sort(),
    );
    // A decision on a version the screen no longer shows is refused.
    expect(await roundTrip({ kind: 'reject', proposalId: e.id, version: 1, reason: 'changed my mind' })).toMatchObject({
      status: 'refused',
    });
  });

  it('undo returns the stored undo once, brief feedback is stored, a document becomes its next version', async () => {
    const product = await makeProduct();
    const p = await propose(product.id, { action: 'pause_entity', target: ref });
    const revisionId = await insertChange(t.db, {
      productId: product.id,
      proposalId: p.id,
      action: p.action,
      undo: { action: 'resume_entity', target: ref },
      before: {},
      after: {},
      approvedBy: `web:${EMAIL}`,
      verified: true,
    });
    expect(await roundTrip({ kind: 'undo', revisionId })).toMatchObject({
      status: 'done',
      result: { revisionId, undo: { action: 'resume_entity' } },
    });
    expect(await roundTrip({ kind: 'undo', revisionId: 'rev_unknown' })).toMatchObject({ status: 'refused' });

    const brief = await insertBrief(t.db, { productId: product.id, kind: 'weekly', numbers: {}, markdown: 'b' });
    expect(await roundTrip({ kind: 'brief_feedback', briefId: brief.id, useful: true, newInfo: false })).toMatchObject({
      status: 'done',
    });
    expect(await getBrief(t.db, brief.id)).toMatchObject({ feedbackUseful: true, feedbackNewInfo: false });

    const doc = { kind: 'product_doc_put' as const, productId: product.id, doc: 'learnings' as const };
    expect(await roundTrip({ ...doc, baseVersion: 0, markdown: '# One' })).toMatchObject({
      status: 'done',
      result: { version: 1 },
    });
    expect(await roundTrip({ ...doc, baseVersion: 0, markdown: '# Stale' })).toMatchObject({ status: 'refused' });
    expect(await getProductDoc(t.db, product.id, 'learnings')).toMatchObject({ version: 1, markdown: '# One' });
  });
});
