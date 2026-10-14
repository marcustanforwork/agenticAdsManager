import { hashOf, ProposalStatus, type WriteOp } from '@ads/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IllegalTransitionError, RefusedError, StaleVersionError } from '../src/errors.ts';
import {
  PROPOSAL_TRANSITIONS,
  TERMINAL_STATUSES,
  agreeRateCounts,
  canTransition,
  createProposal,
  findOpenProposalByAction,
  defaultExpiry,
  expireDue,
  findProposalByShortId,
  getCurrentApproval,
  getProposal,
  listApplying,
  listProposalVersions,
  listProposals,
  newShortId,
  newVersion,
  recordDecision,
  transitionProposal,
  type NewProposal,
} from '../src/repos/proposals.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { IN_A_DAY, expectConstraint, makeCampaign, pauseOp } from './helpers.ts';

let t: TestDatabase;
let productId: string;
let target: Parameters<typeof pauseOp>[0];

beforeAll(async () => {
  t = await createTestDatabase();
  const c = await makeCampaign(t.db);
  productId = c.product.id;
  target = c.ref;
});
afterAll(async () => t.drop());

const budgetOp = (micros: string): WriteOp => ({
  action: 'adjust_budget',
  target,
  newDailyBudgetMicros: micros,
  netIncrease: false,
});

function draft(overrides: Partial<NewProposal> = {}): NewProposal {
  return {
    productId,
    origin: 'agent',
    action: pauseOp(target),
    undo: { action: 'resume_entity', target },
    preconditionHash: hashOf({ status: 'active' }),
    preconditionFields: ['status'],
    rationale: 'Spent with no outcomes',
    expectedEffect: 'Stops the spend',
    expiresAt: IN_A_DAY(),
    ...overrides,
  };
}

const setStatus = (id: string, status: string) =>
  t.pool.query('update proposals set status = $2 where id = $1', [id, status]);

describe('the §3.9 transition table', () => {
  const statuses = ProposalStatus.options;
  const pairs = statuses.flatMap((from) => statuses.map((to) => [from, to] as const));

  it('lists exactly the edges of the state diagram', () => {
    const edges = pairs.filter(([f, to]) => canTransition(f, to)).map(([f, to]) => `${f}→${to}`);
    expect(edges.sort()).toEqual(
      [
        'pending→approved',
        'pending→rejected',
        'pending→expired',
        'approved→expired',
        'approved→blocked',
        'approved→stale',
        'approved→applying',
        'applying→applied',
        'applying→failed',
        'applying→rolled_back',
        'applying→needs_attention',
        'needs_attention→applied',
        'needs_attention→failed',
        'applied→reverted',
      ].sort(),
    );
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      ['rejected', 'expired', 'blocked', 'stale', 'failed', 'rolled_back', 'reverted'].sort(),
    );
    expect(Object.keys(PROPOSAL_TRANSITIONS).sort()).toEqual([...statuses].sort());
  });

  it.each(pairs)('%s → %s is allowed only if the table says so', async (from, to) => {
    const p = await createProposal(t.db, draft());
    await setStatus(p.id, from);
    const attempt = transitionProposal(t.db, { proposalId: p.id, to });
    if (canTransition(from, to)) {
      expect((await attempt).status).toBe(to);
    } else {
      await expect(attempt).rejects.toBeInstanceOf(IllegalTransitionError);
      expect((await getProposal(t.db, p.id)).status).toBe(from);
    }
  });

  it('refuses when the proposal is no longer in the expected `from` status', async () => {
    const p = await createProposal(t.db, draft());
    await setStatus(p.id, 'approved');
    await expect(transitionProposal(t.db, { proposalId: p.id, from: 'pending', to: 'expired' })).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it('sets the idempotency key and applying_since on entering applying, and stores status detail', async () => {
    const p = await createProposal(t.db, draft());
    await setStatus(p.id, 'approved');
    const applying = await transitionProposal(t.db, { proposalId: p.id, to: 'applying' });
    expect(applying.idempotencyKey).toBe(`${p.id}:1`);
    expect(applying.applyingSince).toBeInstanceOf(Date);
    expect((await listApplying(t.db)).map((x) => x.id)).toContain(p.id);
    const failed = await transitionProposal(t.db, {
      proposalId: p.id,
      to: 'failed',
      detail: { errors: ['rejected by the platform'] },
    });
    expect(failed.statusDetail).toEqual({ errors: ['rejected by the platform'] });
  });

  it('the database itself rejects an unknown status', async () => {
    const p = await createProposal(t.db, draft());
    await expectConstraint(setStatus(p.id, 'done'), 'proposals_status_check');
  });
});

describe('creating and editing proposals', () => {
  it('creates version 1 with the action hash, a short id and a version row', async () => {
    const p = await createProposal(t.db, draft());
    expect(p.status).toBe('pending');
    expect(p.version).toBe(1);
    expect(p.actionHash).toBe(hashOf(pauseOp(target)));
    expect(p.shortId).toMatch(/^[a-z2-9]{8}$/);
    expect((await findProposalByShortId(t.db, p.shortId))?.id).toBe(p.id);
    const versions = await listProposalVersions(t.db, p.id);
    expect(versions.map((v) => [v.version, v.actionHash])).toEqual([[1, p.actionHash]]);
  });

  it('rejects an action that does not match the WriteOp contract', async () => {
    const bad = { action: 'delete_everything', target } as unknown as WriteOp;
    await expect(createProposal(t.db, draft({ action: bad }))).rejects.toThrow();
  });

  it('defaults the expiry for every action type: 72 h for budgets, 7 days for the rest', () => {
    const at = new Date('2026-10-13T00:00:00Z');
    const ops: WriteOp[] = [
      pauseOp(target),
      { action: 'resume_entity', target },
      { action: 'mark_abandoned', target },
      { action: 'add_negative_keyword', target, text: 'free', matchType: 'EXACT' },
      { action: 'remove_negative_keyword', target, criterionId: 'c1' },
      budgetOp('1000000'),
      { action: 'create_entity_paused', parent: target, type: 'ad', spec: {}, idempotencyTag: 't' },
      {
        action: 'upload_conversions',
        platform: 'meta',
        accountId: 'act_1',
        destinationId: 'd',
        events: [{ eventId: 's:signup', stage: 'signup', occurredAt: '2026-10-12T00:00:00Z', ids: {} }],
      },
    ];
    expect(new Set(ops.map((o) => o.action)).size).toBe(8); // every WriteOp action
    for (const op of ops) {
      const hours = (defaultExpiry(op, at).getTime() - at.getTime()) / 3_600_000;
      expect(hours, op.action).toBe(op.action === 'adjust_budget' ? 72 : 168);
    }
  });

  it('defaults the expiry: 72 h for budgets, 7 days otherwise', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    expect(defaultExpiry(budgetOp('1000000'), now).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(defaultExpiry(pauseOp(target), now).toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('short ids use only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) expect(newShortId()).toMatch(/^[a-km-np-z2-9]{8}$/);
  });

  it('newVersion bumps the version, keeps the old one, and changes the hash', async () => {
    const p = await createProposal(t.db, draft({ action: budgetOp('10000000'), undo: null }));
    const edited = await newVersion(t.db, {
      proposalId: p.id,
      baseVersion: 1,
      action: budgetOp('12000000'),
      undo: null,
      preconditionHash: 'h2',
    });
    expect(edited.version).toBe(2);
    expect(edited.status).toBe('pending');
    expect(edited.actionHash).toBe(hashOf(budgetOp('12000000')));
    const versions = await listProposalVersions(t.db, p.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]?.actionHash).toBe(p.actionHash);
  });

  it('newVersion refuses a stale base and a proposal that is no longer pending', async () => {
    const p = await createProposal(t.db, draft());
    const edit = { proposalId: p.id, action: pauseOp(target), undo: null, preconditionHash: null };
    await newVersion(t.db, { ...edit, baseVersion: 1 });
    await expect(newVersion(t.db, { ...edit, baseVersion: 1 })).rejects.toBeInstanceOf(StaleVersionError);
    await setStatus(p.id, 'approved');
    await expect(newVersion(t.db, { ...edit, baseVersion: 2 })).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('lists a product’s proposals, optionally by status', async () => {
    const p = await createProposal(t.db, draft());
    expect((await listProposals(t.db, productId)).map((x) => x.id)).toContain(p.id);
    expect((await listProposals(t.db, productId, ['rolled_back'])).map((x) => x.id)).not.toContain(p.id);
  });
});

describe('expiry', () => {
  it('expires pending and approved proposals past expires_at, and nothing else', async () => {
    const past = new Date(Date.now() - 1000);
    const pending = await createProposal(t.db, draft({ expiresAt: past }));
    const approved = await createProposal(t.db, draft({ expiresAt: past }));
    const applying = await createProposal(t.db, draft({ expiresAt: past }));
    const fresh = await createProposal(t.db, draft());
    await setStatus(approved.id, 'approved');
    await setStatus(applying.id, 'applying');
    const expired = await expireDue(t.db);
    expect(expired).toEqual(expect.arrayContaining([pending.id, approved.id]));
    expect(expired).not.toContain(applying.id);
    expect(expired).not.toContain(fresh.id);
    expect((await getProposal(t.db, applying.id)).status).toBe('applying');
  });
});

describe('decisions and approvals', () => {
  const approve = (p: { id: string; version: number; actionHash: string }) => ({
    proposalId: p.id,
    version: p.version,
    actionHash: p.actionHash,
    decision: 'approve' as const,
    actor: 'marcus',
    channel: 'telegram' as const,
  });

  it('approves: stores the approval and moves the proposal to approved', async () => {
    const p = await createProposal(t.db, draft());
    const { approval, duplicate } = await recordDecision(t.db, approve(p));
    expect(duplicate).toBe(false);
    expect(approval.proposalVersion).toBe(1);
    expect((await getProposal(t.db, p.id)).status).toBe('approved');
    expect((await getCurrentApproval(t.db, p.id))?.id).toBe(approval.id);
  });

  it('is unique per version: a double tap returns the stored decision', async () => {
    const p = await createProposal(t.db, draft());
    const first = await recordDecision(t.db, approve(p));
    const second = await recordDecision(t.db, approve(p));
    expect(second.duplicate).toBe(true);
    expect(second.approval.id).toBe(first.approval.id);
  });

  it('refuses a conflicting second decision on the same version', async () => {
    const p = await createProposal(t.db, draft());
    await recordDecision(t.db, approve(p));
    await expect(
      recordDecision(t.db, { ...approve(p), decision: 'reject', reason: 'changed my mind' }),
    ).rejects.toBeInstanceOf(RefusedError);
  });

  it('the database enforces one decision per version', async () => {
    const p = await createProposal(t.db, draft());
    const { approval } = await recordDecision(t.db, approve(p));
    await expectConstraint(
      t.pool.query(
        `insert into approvals (product_id, proposal_id, proposal_version, action_hash, decision, actor, channel)
         values ($1, $2, 1, $3, 'approve', 'x', 'web')`,
        [productId, p.id, approval.actionHash],
      ),
      'approvals_proposal_id_proposal_version_unique',
    );
  });

  it('concurrent approvals of one version produce one approval', async () => {
    const p = await createProposal(t.db, draft());
    const results = await Promise.all([recordDecision(t.db, approve(p)), recordDecision(t.db, approve(p))]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.approval.id)).size).toBe(1);
  });

  it('refuses a stale version, a changed action hash, an expired or a non-pending proposal', async () => {
    const p = await createProposal(t.db, draft());
    const v2 = await newVersion(t.db, {
      proposalId: p.id,
      baseVersion: 1,
      action: budgetOp('9000000'),
      undo: null,
      preconditionHash: null,
    });
    await expect(recordDecision(t.db, approve(p))).rejects.toBeInstanceOf(StaleVersionError);
    await expect(recordDecision(t.db, { ...approve(v2), actionHash: p.actionHash })).rejects.toThrow(/action changed/);
    const old = await createProposal(t.db, draft({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(recordDecision(t.db, approve(old))).rejects.toThrow(/expired/);
    const blocked = await createProposal(t.db, draft());
    await setStatus(blocked.id, 'blocked');
    await expect(recordDecision(t.db, approve(blocked))).rejects.toThrow(/not pending/);
  });

  it('a rejection needs a reason, in code and in the database', async () => {
    const p = await createProposal(t.db, draft());
    await expect(recordDecision(t.db, { ...approve(p), decision: 'reject', reason: '  ' })).rejects.toThrow(/reason/);
    const { approval } = await recordDecision(t.db, { ...approve(p), decision: 'reject', reason: 'not now' });
    expect(approval.reason).toBe('not now');
    expect((await getProposal(t.db, p.id)).status).toBe('rejected');
    const q = await createProposal(t.db, draft());
    await expectConstraint(
      t.pool.query(
        `insert into approvals (product_id, proposal_id, proposal_version, action_hash, decision, actor, channel)
         values ($1, $2, 1, 'h', 'reject', 'x', 'web')`,
        [productId, q.id],
      ),
      'approvals_reject_reason_check',
    );
  });

  it('an approval of an old version is not the current approval', async () => {
    const p = await createProposal(t.db, draft());
    await t.pool.query(
      `insert into approvals (product_id, proposal_id, proposal_version, action_hash, decision, actor, channel)
       values ($1, $2, 1, $3, 'approve', 'x', 'web')`,
      [productId, p.id, p.actionHash],
    );
    await newVersion(t.db, {
      proposalId: p.id,
      baseVersion: 1,
      action: pauseOp(target),
      undo: null,
      preconditionHash: null,
    });
    expect(await getCurrentApproval(t.db, p.id)).toBeNull();
  });
});

describe('the agree rate counts (PROPOSAL §12)', () => {
  it('counts agent proposals by their decision; expired undecided ones apart; operator ones not at all', async () => {
    const own = await makeCampaign(t.db);
    const base = { ...draft(), productId: own.product.id, action: pauseOp(own.ref) };
    const decide = async (decision: 'approve' | 'reject') => {
      const p = await createProposal(t.db, base);
      await recordDecision(t.db, {
        proposalId: p.id,
        version: 1,
        actionHash: p.actionHash,
        decision,
        reason: decision === 'reject' ? 'not now' : null,
        actor: 'cli:marcus',
        channel: 'cli',
      });
      return p;
    };
    const approved = await decide('approve');
    await decide('approve');
    await decide('reject');
    // An approved proposal that expires (Phase 1 applies nothing) still counts as agreed.
    await transitionProposal(t.db, { proposalId: approved.id, to: 'expired' });
    const lapsed = await createProposal(t.db, base);
    await transitionProposal(t.db, { proposalId: lapsed.id, to: 'expired' });
    await createProposal(t.db, base); // still pending
    await createProposal(t.db, { ...base, origin: 'operator' }); // Marcus's own: excluded

    const window = { productId: own.product.id, from: new Date(Date.now() - 86_400_000), to: IN_A_DAY() };
    expect(await agreeRateCounts(t.db, window)).toEqual({ total: 5, approved: 2, rejected: 1, expired: 1, pending: 1 });
    expect(
      await agreeRateCounts(t.db, { ...window, from: IN_A_DAY(), to: new Date(Date.now() + 2 * 86_400_000) }),
    ).toEqual({ total: 0, approved: 0, rejected: 0, expired: 0, pending: 0 });
  });

  it('finds an open proposal with the same action, and none once it is decided against', async () => {
    const own = await makeCampaign(t.db);
    const p = await createProposal(t.db, { ...draft(), productId: own.product.id, action: pauseOp(own.ref) });
    const query = { productId: own.product.id, actionHash: p.actionHash };
    expect((await findOpenProposalByAction(t.db, query))?.id).toBe(p.id);
    await recordDecision(t.db, {
      proposalId: p.id,
      version: 1,
      actionHash: p.actionHash,
      decision: 'reject',
      reason: 'no',
      actor: 'cli:marcus',
      channel: 'cli',
    });
    expect(await findOpenProposalByAction(t.db, query)).toBeNull();
  });

  it('still finds an open proposal by the action of an earlier version (an edit before approval, M09a)', async () => {
    const own = await makeCampaign(t.db);
    const first = {
      action: 'adjust_budget' as const,
      target: own.ref,
      newDailyBudgetMicros: '80000000',
      netIncrease: false,
    };
    const p = await createProposal(t.db, { ...draft(), productId: own.product.id, action: first, undo: null });
    const edited = await newVersion(t.db, {
      proposalId: p.id,
      baseVersion: 1,
      action: { ...first, newDailyBudgetMicros: '90000000' },
      undo: null,
      preconditionHash: null,
    });
    expect(edited.actionHash).not.toBe(p.actionHash);
    for (const actionHash of [p.actionHash, edited.actionHash]) {
      expect((await findOpenProposalByAction(t.db, { productId: own.product.id, actionHash }))?.id).toBe(p.id);
    }
    await transitionProposal(t.db, { proposalId: p.id, to: 'expired' });
    expect(await findOpenProposalByAction(t.db, { productId: own.product.id, actionHash: p.actionHash })).toBeNull();
  });
});
