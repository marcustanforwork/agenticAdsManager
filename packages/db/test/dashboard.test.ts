// The dashboard's review reads (M10b), each run under the dashboard's role: outcomes come through the view, spend
// from campaign rows only, and the histories carry who asked.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertAdEntity, upsertMetricsDaily } from '../src/repos/adData.ts';
import { addModelCost, recordTrustCheck, startManual } from '../src/repos/cycles.ts';
import {
  attributionByStage,
  entitiesByRef,
  listCycleHistory,
  listDecisions,
  listDriftEvents,
  listProductDocVersions,
  outcomesByDay,
  spendByDay,
  sumModelCost,
} from '../src/repos/dashboard.ts';
import { insertOutcomes, setAttribution } from '../src/repos/outcomes.ts';
import { recordDrift, recordOperatorRequest } from '../src/repos/plumbing.ts';
import { putProductDoc } from '../src/repos/products.ts';
import { createProposal, recordDecision } from '../src/repos/proposals.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { IN_A_DAY, makeCampaign, pauseOp } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

type Tx = Parameters<Parameters<TestDatabase['db']['transaction']>[0]>[0];
/** Runs `fn` as the dashboard's role. */
const asDashboard = <T>(fn: (tx: Tx) => Promise<T>) =>
  t.db.transaction(async (tx) => {
    await tx.execute(sql`set local role agent_dashboard`);
    return fn(tx);
  });

const metrics = (productId: string, adEntityId: string, date: string, spend: bigint) => ({
  productId,
  adEntityId,
  date,
  impressions: 100,
  clicks: 10,
  spendMicros: spend,
  platformConversions: '0',
});

describe('spendByDay', () => {
  it('sums campaign rows per day, never the levels below, within the window', async () => {
    const { product, account, campaign } = await makeCampaign(t.db);
    const adGroup = await upsertAdEntity(t.db, {
      productId: product.id,
      accountId: account.id,
      platform: 'google',
      type: 'ad_group',
      externalId: 'ag-1',
      parentId: campaign.id,
      name: 'Group',
      status: 'active',
      rawStatus: 'ENABLED',
    });
    await upsertMetricsDaily(t.db, [
      metrics(product.id, campaign.id, '2026-10-01', 5_000_000n),
      metrics(product.id, campaign.id, '2026-10-02', 7_500_000n),
      metrics(product.id, campaign.id, '2026-10-05', 1_000_000n),
      metrics(product.id, adGroup.id, '2026-10-01', 5_000_000n),
    ]);
    expect(
      await asDashboard((db) => spendByDay(db, { productId: product.id, from: '2026-10-01', to: '2026-10-04' })),
    ).toEqual([
      { day: '2026-10-01', spendMicros: 5_000_000n },
      { day: '2026-10-02', spendMicros: 7_500_000n },
    ]);
  });
});

describe('outcomes through the view', () => {
  it('counts per local day and stage without test traffic, and per attribution method with it apart', async () => {
    const { product, campaign } = await makeCampaign(t.db);
    const ev = (sourceId: string, stage: string, occurredAt: string, isTest = false) => ({
      sourceId,
      stage,
      occurredAt,
      isTest,
      ids: {},
    });
    await insertOutcomes(t.db, product.id, [
      ev('a', 'signup', '2026-10-01T15:59:00Z'), // 23:59 in Singapore: 1 October
      ev('b', 'signup', '2026-10-01T16:01:00Z'), // 00:01 in Singapore: 2 October
      ev('c', 'paid', '2026-10-02T03:00:00Z'),
      ev('t', 'signup', '2026-10-02T03:00:00Z', true),
    ]);
    const [a] = (await t.pool.query(`select id from outcomes where source_id = 'a' and product_id = $1`, [product.id]))
      .rows as { id: string }[];
    await setAttribution(t.db, { outcomeId: a!.id, entityId: campaign.id, method: 'utm' });

    const window = { productId: product.id, from: '2026-10-01', to: '2026-10-31', timeZone: 'Asia/Singapore' };
    expect(await asDashboard((db) => outcomesByDay(db, window))).toEqual([
      { day: '2026-10-01', stage: 'signup', outcomes: 1 },
      { day: '2026-10-02', stage: 'paid', outcomes: 1 },
      { day: '2026-10-02', stage: 'signup', outcomes: 1 },
    ]);
    expect(await asDashboard((db) => attributionByStage(db, window))).toEqual([
      { stage: 'paid', method: null, outcomes: 1, test: 0 },
      { stage: 'signup', method: 'utm', outcomes: 1, test: 0 },
      { stage: 'signup', method: null, outcomes: 1, test: 1 },
    ]);
  });
});

describe('cycles: trust checks and AI cost', () => {
  it('lists the latest cycles newest first with their checks, and sums the AI cost since a time', async () => {
    const { product, account } = await makeCampaign(t.db);
    const first = await startManual(t.db, { productId: product.id, cycleDate: '2026-10-01' });
    const second = await startManual(t.db, { productId: product.id, cycleDate: '2026-10-02' });
    await recordTrustCheck(t.db, { productId: product.id, cycleId: first.id, checkId: 'freshness', result: 'pass' });
    await recordTrustCheck(t.db, {
      productId: product.id,
      cycleId: second.id,
      accountId: account.id,
      checkId: 'spend_reconcile',
      result: 'warn',
      detail: { diffPct: 3 },
    });
    await addModelCost(t.db, second.id, 12_345n);

    const history = await asDashboard((db) => listCycleHistory(db, product.id));
    expect(history.map((h) => [h.cycle.cycleDate, h.checks.map((c) => `${c.checkId}:${c.result}`)])).toEqual([
      ['2026-10-02', ['spend_reconcile:warn']],
      ['2026-10-01', ['freshness:pass']],
    ]);
    expect(await asDashboard((db) => sumModelCost(db, { productId: product.id, since: new Date(0) }))).toEqual({
      costMicros: 12_345n,
      cycles: 1,
    });
    expect(
      await asDashboard((db) => sumModelCost(db, { productId: product.id, since: new Date(Date.now() + 60_000) })),
    ).toEqual({ costMicros: 0n, cycles: 0 });
  });
});

describe('drift, entities, decisions and documents', () => {
  it('reads drift with its entity, entities by ref, decisions with who made them, and document versions', async () => {
    const { product, campaign, ref } = await makeCampaign(t.db);
    await recordDrift(t.db, {
      productId: product.id,
      adEntityId: campaign.id,
      field: 'status',
      expected: 'active',
      observed: 'paused',
    });
    const drift = await asDashboard((db) => listDriftEvents(db, product.id));
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      field: 'status',
      expected: { value: 'active' },
      observed: { value: 'paused' },
      acknowledgedAt: null,
      entity: { platform: 'google', accountId: ref.accountId, type: 'campaign', externalId: ref.externalId },
    });

    const other = { ...ref, externalId: 'not-synced' };
    const names = await asDashboard((db) => entitiesByRef(db, product.id, [ref, other]));
    expect([...names.values()]).toEqual([{ name: 'Campaign', status: 'active' }]);
    expect(await asDashboard((db) => entitiesByRef(db, product.id, []))).toEqual(new Map());

    const proposal = await createProposal(t.db, {
      productId: product.id,
      origin: 'agent',
      action: pauseOp(ref),
      undo: null,
      preconditionHash: null,
      preconditionFields: [],
      rationale: 'r',
      expectedEffect: 'e',
      expiresAt: IN_A_DAY(),
    });
    await recordDecision(t.db, {
      proposalId: proposal.id,
      version: 1,
      actionHash: proposal.actionHash,
      decision: 'reject',
      reason: 'not yet',
      actor: 'web:marcus@example.com',
      channel: 'web',
      requestId: null,
    });
    expect(await asDashboard((db) => listDecisions(db, product.id))).toMatchObject([
      { shortId: proposal.shortId, decision: 'reject', reason: 'not yet', actor: 'web:marcus@example.com' },
    ]);

    await putProductDoc(t.db, { productId: product.id, doc: 'strategy', baseVersion: 0, markdown: '# One' });
    const request = await recordOperatorRequest(t.db, {
      request: {
        kind: 'product_doc_put',
        productId: product.id,
        doc: 'strategy',
        baseVersion: 1,
        markdown: '# Two',
      },
      actor: 'web:marcus@example.com',
      channel: 'web',
    });
    await putProductDoc(t.db, {
      productId: product.id,
      doc: 'strategy',
      baseVersion: 1,
      markdown: '# Two',
      requestId: request.id,
    });
    expect(
      await asDashboard((db) => listProductDocVersions(db, { productId: product.id, doc: 'strategy' })),
    ).toMatchObject([
      { version: 2, markdown: '# Two', actor: 'web:marcus@example.com', channel: 'web' },
      { version: 1, markdown: '# One', actor: null, channel: null },
    ]);
  });
});
