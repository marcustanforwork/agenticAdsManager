import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DuplicateCycleError, RefusedError } from '../src/errors.ts';
import {
  advance,
  findScheduledCycle,
  finish,
  getCycle,
  insertFinding,
  listCycles,
  listFindings,
  listTrustChecks,
  listUnfinishedCycles,
  recordTrustCheck,
  replaceDetectorFindings,
  replaceTrustChecks,
  setAnalystVerdict,
  startManual,
  startScheduled,
} from '../src/repos/cycles.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { expectConstraint, makeCampaign, makeProduct, pauseOp } from './helpers.ts';

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
    expect((await findScheduledCycle(t.db, { productId: p.id, kind: 'daily', cycleDate: '2026-09-25' }))?.id).toBe(
      first.id,
    );
    expect(await findScheduledCycle(t.db, { productId: p.id, kind: 'daily', cycleDate: '2026-09-27' })).toBeNull();
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
  it("replaces a cycle's trust checks as a whole (a re-run never duplicates them)", async () => {
    const p = await makeProduct(t.db);
    const cycle = await startManual(t.db, { productId: p.id, cycleDate: '2026-09-25' });
    const check = (checkId: string, result: 'pass' | 'warn') => ({ accountId: null, checkId, result, detail: {} });
    await replaceTrustChecks(t.db, {
      productId: p.id,
      cycleId: cycle.id,
      checks: [check('a', 'pass'), check('b', 'warn')],
    });
    await replaceTrustChecks(t.db, { productId: p.id, cycleId: cycle.id, checks: [check('a', 'warn')] });
    expect((await listTrustChecks(t.db, cycle.id)).map((c) => [c.checkId, c.result])).toEqual([['a', 'warn']]);
  });

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
    const evidence = {
      windowDays: 14,
      impressions: 1000,
      clicks: 40,
      spendMicros: '55000000',
      outcomesByStage: {},
      from: '2026-09-11',
      to: '2026-09-24',
      dataDays: 14,
    };
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

describe('finding targets (D-079)', () => {
  const evidence = {
    windowDays: 7,
    impressions: 600,
    clicks: 40,
    spendMicros: '20000000',
    outcomesByStage: {},
    from: '2026-09-18',
    to: '2026-09-24',
    dataDays: 7,
  };

  it('stores account- and product-level findings, never both targets at once', async () => {
    const { product, account, campaign } = await makeCampaign(t.db);
    const c = await startManual(t.db, { productId: product.id, cycleDate: '2026-09-25' });
    const base = { productId: product.id, cycleId: c.id, source: 'detector' as const, evidence, passedThreshold: true };
    const onAccount = await insertFinding(t.db, {
      ...base,
      type: 'tracking_gap',
      targetEntityId: null,
      targetAccountId: account.id,
      summary: 'No conversions recorded',
    });
    const onProduct = await insertFinding(t.db, {
      ...base,
      type: 'pacing_risk',
      targetEntityId: null,
      summary: 'Pacing',
    });
    expect([onAccount.targetAccountId, onAccount.targetEntityId]).toEqual([account.id, null]);
    expect([onProduct.targetAccountId, onProduct.targetEntityId]).toEqual([null, null]);
    await expectConstraint(
      insertFinding(t.db, {
        ...base,
        type: 'tracking_gap',
        targetEntityId: campaign.id,
        targetAccountId: account.id,
        summary: 'both',
      }),
      'findings_one_target_check',
    );
  });

  it('refuses evidence that is not ComputedEvidence', async () => {
    const { product, campaign } = await makeCampaign(t.db);
    const c = await startManual(t.db, { productId: product.id, cycleDate: '2026-09-25' });
    await expect(
      insertFinding(t.db, {
        productId: product.id,
        cycleId: c.id,
        type: 'zero_outcome_spend',
        source: 'analyst',
        targetEntityId: campaign.id,
        summary: 's',
        evidence: { ...evidence, spendMicros: 12.5 } as never, // money is never a float
        passedThreshold: true,
      }),
    ).rejects.toThrow();
  });

  it("replaces a cycle's detector findings on a rerun, and leaves the analyst's alone", async () => {
    const { product, campaign } = await makeCampaign(t.db);
    const c = await startManual(t.db, { productId: product.id, cycleDate: '2026-09-25' });
    const candidate = {
      type: 'no_delivery',
      targetEntityId: campaign.id,
      summary: 'No delivery',
      evidence,
      passedThreshold: true,
    };
    await replaceDetectorFindings(t.db, { productId: product.id, cycleId: c.id, findings: [candidate, candidate] });
    await insertFinding(t.db, { ...candidate, productId: product.id, cycleId: c.id, source: 'analyst' });
    const again = await replaceDetectorFindings(t.db, { productId: product.id, cycleId: c.id, findings: [candidate] });
    expect(again).toHaveLength(1);
    const all = await listFindings(t.db, c.id);
    expect(all.map((f) => f.source).sort()).toEqual(['analyst', 'detector']);
    await replaceDetectorFindings(t.db, { productId: product.id, cycleId: c.id, findings: [] });
    expect((await listFindings(t.db, c.id)).map((f) => f.source)).toEqual(['analyst']);
  });
});
