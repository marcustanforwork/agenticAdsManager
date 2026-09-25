import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DuplicateCycleError, RefusedError } from '../src/errors.ts';
import {
  advance,
  finish,
  getCycle,
  insertFinding,
  listCycles,
  listFindings,
  listTrustChecks,
  listUnfinishedCycles,
  recordTrustCheck,
  setAnalystVerdict,
  startManual,
  startScheduled,
} from '../src/repos/cycles.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { makeCampaign, makeProduct, pauseOp } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe('cycles', () => {
  it('refuses a second scheduled cycle of the same kind on the same day', async () => {
    const p = await makeProduct(t.db);
    const first = await startScheduled(t.db, { productId: p.id, kind: 'daily', cycleDate: '2026-09-25' });
    expect(first.stageReached).toBe('started');
    await expect(
      startScheduled(t.db, { productId: p.id, kind: 'daily', cycleDate: '2026-09-25' }),
    ).rejects.toBeInstanceOf(DuplicateCycleError);
    // A different kind, a different day, or a manual cycle is fine.
    await startScheduled(t.db, { productId: p.id, kind: 'weekly', cycleDate: '2026-09-25' });
    await startScheduled(t.db, { productId: p.id, kind: 'daily', cycleDate: '2026-09-26' });
    await startManual(t.db, { productId: p.id, cycleDate: '2026-09-25' });
    await startManual(t.db, { productId: p.id, cycleDate: '2026-09-25' });
    expect(await listCycles(t.db, p.id)).toHaveLength(5);
  });

  it('refuses the duplicate even when two starts race', async () => {
    const p = await makeProduct(t.db);
    const input = { productId: p.id, kind: 'daily' as const, cycleDate: '2026-09-25' };
    const results = await Promise.allSettled([startScheduled(t.db, input), startScheduled(t.db, input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(DuplicateCycleError);
  });

  it('a refused start inside a transaction leaves that transaction usable', async () => {
    const p = await makeProduct(t.db);
    const input = { productId: p.id, kind: 'daily' as const, cycleDate: '2026-09-25' };
    await startScheduled(t.db, input);
    await t.db.transaction(async (tx) => {
      await expect(startScheduled(tx, input)).rejects.toBeInstanceOf(DuplicateCycleError);
      await startManual(tx, { productId: p.id, cycleDate: '2026-09-25' });
    });
    expect(await listCycles(t.db, p.id)).toHaveLength(2);
  });

  it('advances only forward, adds cost and look-ups, and finishes once', async () => {
    const p = await makeProduct(t.db);
    const c = await startScheduled(t.db, { productId: p.id, kind: 'daily', cycleDate: '2026-09-25' });
    await advance(t.db, c.id, 'synced');
    await advance(t.db, c.id, 'trust_checked', { trustResult: 'degraded' });
    await advance(t.db, c.id, 'analysed', { addModelCostMicros: 1_500n, addLookups: 3 });
    const again = await advance(t.db, c.id, 'analysed', { addModelCostMicros: 500n, addLookups: 1 }); // resume re-run
    expect(again.stageReached).toBe('analysed');
    expect(again.modelCostMicros).toBe(2_000n);
    expect(again.lookups).toBe(4);
    expect(again.trustResult).toBe('degraded');
    await expect(advance(t.db, c.id, 'synced')).rejects.toBeInstanceOf(RefusedError);
    expect((await listUnfinishedCycles(t.db)).map((x) => x.id)).toContain(c.id);
    const done = await finish(t.db, c.id);
    expect(done.stageReached).toBe('done');
    expect(done.finishedAt).toBeInstanceOf(Date);
    expect((await listUnfinishedCycles(t.db)).map((x) => x.id)).not.toContain(c.id);
    await expect(finish(t.db, c.id)).rejects.toBeInstanceOf(RefusedError);
    await expect(advance(t.db, c.id, 'done')).rejects.toBeInstanceOf(RefusedError);
  });

  it('a failed cycle keeps the stage it reached and records the error', async () => {
    const p = await makeProduct(t.db);
    const c = await startManual(t.db, { productId: p.id, cycleDate: '2026-09-25' });
    await advance(t.db, c.id, 'synced');
    const failed = await finish(t.db, c.id, { error: 'Google quota' });
    expect(failed.stageReached).toBe('synced');
    expect(failed.error).toBe('Google quota');
    expect((await getCycle(t.db, c.id)).finishedAt).not.toBeNull();
  });
});

describe('trust checks and findings', () => {
  it('records trust checks per cycle', async () => {
    const { product, account } = await makeCampaign(t.db);
    const c = await startManual(t.db, { productId: product.id, cycleDate: '2026-09-25' });
    await recordTrustCheck(t.db, { productId: product.id, cycleId: c.id, checkId: 'timezone', result: 'pass' });
    await recordTrustCheck(t.db, {
      productId: product.id,
      cycleId: c.id,
      accountId: account.id,
      checkId: 'tracking',
      result: 'no_signal',
      detail: { clicks: 3 },
    });
    const checks = await listTrustChecks(t.db, c.id);
    expect(checks.map((x) => [x.checkId, x.result])).toEqual([
      ['timezone', 'pass'],
      ['tracking', 'no_signal'],
    ]);
  });

  it('stores findings with their evidence and proposed action, and the analyst verdict', async () => {
    const { product, campaign, ref } = await makeCampaign(t.db);
    const c = await startManual(t.db, { productId: product.id, cycleDate: '2026-09-25' });
    const evidence = { windowDays: 14, impressions: 1000, clicks: 40, spendMicros: '55000000', outcomesByStage: {} };
    const f = await insertFinding(t.db, {
      productId: product.id,
      cycleId: c.id,
      type: 'zero_outcome_spend',
      source: 'detector',
      targetEntityId: campaign.id,
      summary: 'Spent S$55 with no signups',
      evidence,
      passedThreshold: true,
      proposedAction: pauseOp(ref),
    });
    expect(f.evidence).toEqual(evidence);
    expect(f.evidenceRefs).toEqual([]);
    await setAnalystVerdict(t.db, f.id, 'dismissed', 'Launch week');
    const [stored] = await listFindings(t.db, c.id);
    expect(stored?.analystVerdict).toBe('dismissed');
    expect(stored?.dismissedReason).toBe('Launch week');
    expect(stored?.proposedAction).toEqual(pauseOp(ref));
  });
});
