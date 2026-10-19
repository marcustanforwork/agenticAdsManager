// A fixture database for the review views (M10b): one product with a bit of everything the screens show. Written
// with the repositories as the worker and gateway would (superuser in tests); the views then read it as the
// dashboard's role. Fixed clock: `NOW` is 16 October 2026, 12:00 in Singapore, so "yesterday" is the 15th.
import type { EntityRef, ProductSettings, WriteOp } from '@ads/contracts';
import {
  type DbOrTx,
  addModelCost,
  createProduct,
  createProposal,
  insertBrief,
  insertChange,
  insertFinding,
  insertOutcomes,
  markAccountSynced,
  putProductDoc,
  recordDecision,
  recordDrift,
  recordTrustCheck,
  setAttribution,
  startScheduled,
  transitionProposal,
  upsertAccount,
  upsertAdEntity,
  upsertMetricsDaily,
} from '@ads/db';
import { TEST_SETTINGS } from '@ads/db/testing';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

export const NOW = new Date('2026-10-16T04:00:00Z');
const LATER = new Date('2026-10-23T04:00:00Z');

export const SETTINGS: ProductSettings = {
  ...TEST_SETTINGS,
  spend: { dailyCeilingMicros: '25000000', monthlyCeilingMicros: '400000000', autoPauseOnMonthlyBreach: false },
  outcomes: {
    stages: [
      { id: 'signup', label: 'Signup', tier: 'success' },
      { id: 'paid', label: 'Paid', tier: 'success' },
    ],
    primaryKpiStage: 'signup',
    feedback: [],
  },
};

const days = (from: number, to: number, month = '10') =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${month}-${String(from + i).padStart(2, '0')}`);

export async function seedWorld(db: DbOrTx) {
  const slug = `rv-${randomBytes(4).toString('hex')}`;
  const product = await createProduct(db, { slug, name: 'Review Pool', packId: 'test-pack', settings: SETTINGS });
  const account = await upsertAccount(db, {
    productId: product.id,
    platform: 'google',
    externalId: String(1_000_000_000 + randomBytes(3).readUIntBE(0, 3)),
    name: 'Main account',
  });
  await markAccountSynced(db, account.id, { at: new Date('2026-10-16T00:30:00Z') });
  const entity = (type: 'campaign' | 'ad_group', externalId: string, name: string, parentId: string | null = null) =>
    upsertAdEntity(db, {
      productId: product.id,
      accountId: account.id,
      platform: 'google',
      type,
      externalId,
      parentId,
      name,
      status: 'active',
      rawStatus: 'ENABLED',
      dailyBudgetMicros: type === 'campaign' ? 20_000_000n : null,
    });
  const campaign = await entity('campaign', '111', 'Pool <b>Search</b>');
  const adGroup = await entity('ad_group', '222', 'Pool group', campaign.id);
  const ref = (e: { externalId: string; type: EntityRef['type'] }): EntityRef => ({
    platform: 'google',
    accountId: account.externalId,
    type: e.type,
    externalId: e.externalId,
  });
  const campaignRef = ref(campaign);
  const adGroupRef = ref(adGroup);

  // S$10 a day from 1 to 15 October (S$150 month to date), and S$12 on 20 September (inside the 28 days).
  const metric = (date: string, spendMicros: bigint, adEntityId = campaign.id) => ({
    productId: product.id,
    adEntityId,
    date,
    impressions: 1000,
    clicks: 50,
    spendMicros,
    platformConversions: '1',
  });
  await upsertMetricsDaily(db, [
    ...days(1, 15).map((d) => metric(d, 10_000_000n)),
    metric('2026-09-20', 12_000_000n),
    metric('2026-10-15', 99_000_000n, adGroup.id), // a lower level: never added to the campaign's
  ]);

  // Signups on 2, 10 and 15 October (one credited by UTM), one paid, and one test signup.
  const outcome = (sourceId: string, stage: string, occurredAt: string, isTest = false) => ({
    sourceId,
    stage,
    occurredAt,
    isTest,
    ids: {},
  });
  await insertOutcomes(db, product.id, [
    outcome('s1', 'signup', '2026-10-02T03:00:00Z'),
    outcome('s2', 'signup', '2026-10-10T03:00:00Z'),
    outcome('s3', 'signup', '2026-10-15T03:00:00Z'),
    outcome('s3', 'paid', '2026-10-15T05:00:00Z'),
    outcome('t1', 'signup', '2026-10-15T06:00:00Z', true),
  ]);
  const { rows } = await db.execute<{ id: string }>(
    sql`select id from outcomes where product_id = ${product.id} and source_id = 's1' and stage = 'signup'`,
  );
  await setAttribution(db, { outcomeId: rows[0]!.id, entityId: campaign.id, method: 'utm' });

  // A weekly cycle with a warning, its AI cost, and a finding behind an agent proposal.
  const cycle = await startScheduled(db, { productId: product.id, kind: 'weekly', cycleDate: '2026-10-12' });
  await recordTrustCheck(db, { productId: product.id, cycleId: cycle.id, checkId: 'freshness', result: 'pass' });
  await recordTrustCheck(db, {
    productId: product.id,
    cycleId: cycle.id,
    accountId: account.id,
    checkId: 'id_capture',
    result: 'warn',
    detail: { capturedPct: 40 },
  });
  await addModelCost(db, cycle.id, 23_400n);
  const finding = await insertFinding(db, {
    productId: product.id,
    cycleId: cycle.id,
    type: 'zero_outcome_spend',
    source: 'detector',
    targetEntityId: adGroup.id,
    summary: 'Spend without signups',
    evidence: {
      windowDays: 7,
      impressions: 600,
      clicks: 40,
      spendMicros: '20000000',
      outcomesByStage: {},
      from: '2026-10-05',
      to: '2026-10-11',
      dataDays: 7,
    },
    passedThreshold: true,
  });

  await recordDrift(db, {
    productId: product.id,
    adEntityId: campaign.id,
    field: 'daily_budget',
    expected: '20000000',
    observed: '30000000',
  });

  const propose = (action: WriteOp, extra: { undo?: WriteOp | null; findingId?: string; cycleId?: string } = {}) =>
    createProposal(db, {
      productId: product.id,
      origin: 'agent',
      cycleId: extra.cycleId ?? cycle.id,
      findingId: extra.findingId ?? null,
      action,
      undo: extra.undo ?? null,
      preconditionHash: null,
      preconditionFields: [],
      rationale: 'Spent S$20 with no signups in 7 days.',
      expectedEffect: 'Saves about S$20 a week.',
      expiresAt: LATER,
    });
  const pausePending = await propose(
    { action: 'pause_entity', target: adGroupRef },
    { findingId: finding.id, undo: { action: 'resume_entity', target: adGroupRef } },
  );
  const budgetPending = await propose(
    { action: 'adjust_budget', target: campaignRef, newDailyBudgetMicros: '15000000', netIncrease: false },
    {
      undo: { action: 'adjust_budget', target: campaignRef, newDailyBudgetMicros: '20000000', netIncrease: true },
    },
  );
  const negativePending = await propose({
    action: 'add_negative_keyword',
    target: campaignRef,
    text: 'free pool',
    matchType: 'PHRASE',
  });
  const rejected = await propose({ action: 'pause_entity', target: campaignRef });
  await recordDecision(db, {
    proposalId: rejected.id,
    version: 1,
    actionHash: rejected.actionHash,
    decision: 'reject',
    reason: 'still learning',
    actor: 'telegram:1001',
    channel: 'telegram',
  });
  const applied = await propose(
    { action: 'add_negative_keyword', target: adGroupRef, text: 'jobs', matchType: 'EXACT' },
    { undo: { action: 'remove_negative_keyword', target: adGroupRef, criterionId: '999' } },
  );
  await recordDecision(db, {
    proposalId: applied.id,
    version: 1,
    actionHash: applied.actionHash,
    decision: 'approve',
    actor: 'web:marcus@example.com',
    channel: 'web',
  });
  await transitionProposal(db, { proposalId: applied.id, from: 'approved', to: 'applying' });
  await transitionProposal(db, { proposalId: applied.id, from: 'applying', to: 'applied' });
  const revisionId = await insertChange(db, {
    productId: product.id,
    proposalId: applied.id,
    action: applied.action,
    undo: applied.undo,
    before: {},
    after: { criterionId: '999' },
    approvedBy: 'web:marcus@example.com',
    verified: true,
  });

  // Created the day before the fixed clock (the agree rate counts proposals created in its window).
  await db.execute(sql`update proposals set created_at = '2026-10-15T00:00:00Z' where product_id = ${product.id}`);

  const brief = await insertBrief(db, {
    productId: product.id,
    cycleId: cycle.id,
    kind: 'weekly',
    numbers: {},
    markdown: '**Review Pool · week to 2026-10-11**\n- Spend S$70\n- <script>alert(1)</script> is just text',
  });
  await putProductDoc(db, { productId: product.id, doc: 'strategy', baseVersion: 0, markdown: '# Strategy\nGrow.' });

  return {
    product,
    account,
    campaign,
    adGroup,
    cycle,
    finding,
    proposals: { pausePending, budgetPending, negativePending, rejected, applied },
    revisionId,
    brief,
  };
}

export type World = Awaited<ReturnType<typeof seedWorld>>;
