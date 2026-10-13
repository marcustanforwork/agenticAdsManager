// Replay v0 (M08): scoring an answer against Marcus's decisions, over the three hand-written cases in
// cases/decisions/, and decision cases built from the database after real approvals and rejections.
import { type AnalystOutput, hashOf } from '@ads/contracts';
import { actorsFromEnv, submitRequest } from '@ads/core';
import {
  createProduct,
  createProposal,
  insertFinding,
  setAnalystRecord,
  startManual,
  upsertAccount,
  upsertAdEntity,
} from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DECISION_CASES_DIR, decisionCasesFromDb, loadDecisionCases, scoreReplay } from '../src/index.ts';

describe('scoring the hand-written cases', () => {
  it('reports precision and recall per finding type', async () => {
    const cases = await loadDecisionCases(DECISION_CASES_DIR);
    expect(cases.map((c) => c.id)).toEqual(['hand-0001', 'hand-0002', 'hand-0003']);
    const report = scoreReplay(cases);
    expect(report).toEqual({
      cases: 3,
      unjudged: 2, // hand-0001's no_delivery and hand-0002's cost_spike: nobody decided on them
      byType: [
        {
          type: 'wasteful_search_term',
          truePositives: 0,
          falsePositives: 1,
          falseNegatives: 0,
          precisionPct: 0,
          recallPct: null,
        },
        {
          type: 'zero_outcome_spend',
          truePositives: 3,
          falsePositives: 0,
          falseNegatives: 1,
          precisionPct: 100,
          recallPct: 75,
        },
      ],
      overall: { truePositives: 3, falsePositives: 1, falseNegatives: 1, precisionPct: 75, recallPct: 75 },
    });
  });

  it('scores another answer to the same cases (the M16a model comparison plugs in here)', async () => {
    const cases = await loadDecisionCases(DECISION_CASES_DIR);
    const silent: AnalystOutput = { findings: [], dismissed: [] };
    expect(scoreReplay(cases, () => silent).overall).toEqual({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 4,
      precisionPct: null,
      recallPct: 0,
    });
  });
});

describe('decision cases from the database', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => t.drop());

  it('groups the decisions of an analysed cycle with its recorded answer, and scores them', async () => {
    const product = await createProduct(t.db, {
      slug: 'replay',
      name: 'Replay',
      packId: 'test-pack',
      settings: TEST_SETTINGS,
    });
    const account = await upsertAccount(t.db, { productId: product.id, platform: 'google', externalId: '9990001' });
    const campaign = (externalId: string) =>
      upsertAdEntity(t.db, {
        productId: product.id,
        accountId: account.id,
        platform: 'google',
        type: 'campaign',
        externalId,
        name: `c${externalId}`,
        status: 'active',
        rawStatus: 'ENABLED',
      });
    const [c1, c2] = [await campaign('1'), await campaign('2')];
    const cycle = await startManual(t.db, { productId: product.id, cycleDate: '2026-10-08' });
    const ref = (externalId: string) => ({
      level: 'entity' as const,
      platform: 'google' as const,
      accountId: '9990001',
      type: 'campaign' as const,
      externalId,
    });
    const answer: AnalystOutput = {
      findings: ['1', '2'].map((id) => ({
        type: 'zero_outcome_spend' as const,
        target: ref(id),
        fromCandidateId: null,
        summary: 's',
        whyNow: 'w',
        evidenceRefs: [],
        confidence: 'high' as const,
      })),
      dismissed: [],
    };
    await setAnalystRecord(t.db, cycle.id, {
      promptVersion: 'analyst-v1',
      model: 'test',
      prompt: '## DATA',
      output: answer,
    });

    const ctx = { actors: actorsFromEnv('cli:marcus'), packs: createRegistry([]) };
    for (const [entity, decision] of [
      [c1, 'approve'],
      [c2, 'reject'],
    ] as const) {
      const finding = await insertFinding(t.db, {
        productId: product.id,
        cycleId: cycle.id,
        type: 'zero_outcome_spend',
        source: 'detector',
        targetEntityId: entity.id,
        analystVerdict: 'confirmed',
        summary: 's',
        evidence: {
          windowDays: 14,
          impressions: 1,
          clicks: 1,
          spendMicros: '1',
          outcomesByStage: {},
          from: '2026-09-24',
          to: '2026-10-07',
          dataDays: 14,
        },
        passedThreshold: true,
      });
      const target = {
        platform: 'google' as const,
        accountId: '9990001',
        type: 'campaign' as const,
        externalId: entity.externalId,
      };
      const action = { action: 'pause_entity' as const, target };
      const p = await createProposal(t.db, {
        productId: product.id,
        cycleId: cycle.id,
        findingId: finding.id,
        origin: 'agent',
        action,
        undo: { action: 'resume_entity', target },
        preconditionHash: 'h',
        preconditionFields: ['status'],
        rationale: 'r',
        expectedEffect: 'e',
      });
      const request =
        decision === 'approve'
          ? { kind: 'approve' as const, proposalId: p.id, version: 1, actionHash: hashOf(action) }
          : { kind: 'reject' as const, proposalId: p.id, version: 1, reason: 'still learning' };
      expect((await submitRequest(t.db, { request, actor: 'cli:marcus', channel: 'cli' }, ctx)).outcome.status).toBe(
        'done',
      );
    }

    const cases = await decisionCasesFromDb(t.db, product);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      source: 'decisions',
      cycleId: cycle.id,
      prompt: '## DATA',
      expected: [{ type: 'zero_outcome_spend', target: 'google:9990001:campaign:1' }],
      rejected: [{ type: 'zero_outcome_spend', target: 'google:9990001:campaign:2', reason: 'still learning' }],
    });
    expect(scoreReplay(cases).overall).toMatchObject({ truePositives: 1, falsePositives: 1, precisionPct: 50 });
  });
});
