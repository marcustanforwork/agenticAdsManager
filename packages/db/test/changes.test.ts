import { hashOf, type WriteOp } from '@ads/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/schema.ts';
import { NotFoundError, RefusedError } from '../src/errors.ts';
import {
  createUndoProposal,
  getChange,
  insertChange,
  listChanges,
  markReverted,
  newRevisionId,
  ulid,
} from '../src/repos/changes.ts';
import { createProposal, getProposal, transitionProposal } from '../src/repos/proposals.ts';
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

/** An applied change for `action`, with its stored undo, as the gateway would record it. */
async function applied(action: WriteOp, undo: WriteOp | null, before: unknown, after: unknown) {
  const p = await createProposal(t.db, {
    productId,
    origin: 'agent',
    action,
    undo,
    preconditionHash: null,
    preconditionFields: [],
    rationale: 'r',
    expectedEffect: 'e',
    expiresAt: IN_A_DAY(),
  });
  const revisionId = await insertChange(t.db, {
    productId,
    proposalId: p.id,
    action,
    undo,
    before,
    after,
    approvedBy: 'marcus',
    verified: true,
  });
  return { proposal: p, revisionId };
}

describe('revision ids', () => {
  it('are rev_ + a 26-character ULID that sorts by time', () => {
    const a = newRevisionId(1_700_000_000_000);
    const b = newRevisionId(1_700_000_000_001);
    expect(a).toMatch(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
    expect(ulid(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ');
  });
});

describe('the change log', () => {
  it('stores a change and reads it back with its action and undo validated', async () => {
    const { revisionId } = await applied(pauseOp(target), { action: 'resume_entity', target }, { s: 1 }, { s: 2 });
    const change = await getChange(t.db, revisionId);
    expect(change.action).toEqual(pauseOp(target));
    expect(change.undo).toEqual({ action: 'resume_entity', target });
    expect(change.before).toEqual({ s: 1 });
    expect((await listChanges(t.db, productId)).map((c) => c.revisionId)).toContain(revisionId);
    await expect(getChange(t.db, 'rev_missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('links a change to its reverting revision once', async () => {
    const first = await applied(pauseOp(target), { action: 'resume_entity', target }, {}, {});
    const second = await applied({ action: 'resume_entity', target }, pauseOp(target), {}, {});
    await markReverted(t.db, first.revisionId, second.revisionId);
    expect((await getChange(t.db, first.revisionId)).revertedByRevisionId).toBe(second.revisionId);
    await expect(markReverted(t.db, first.revisionId, second.revisionId)).rejects.toBeInstanceOf(RefusedError);
  });

  it('refuses a reverting revision that does not exist (foreign key)', async () => {
    const c = await applied(pauseOp(target), { action: 'resume_entity', target }, {}, {});
    await expectConstraint(
      markReverted(t.db, c.revisionId, 'rev_nope'),
      'change_log_reverted_by_revision_id_change_log_revision_id_fk',
    );
  });
});

describe('createUndoProposal', () => {
  it('builds the stored undo, fingerprinting the action’s fields (fingerprintFieldsFor) from the after state', async () => {
    const after = { status: 'paused', name: 'Campaign', dailyBudgetMicros: '20000000' };
    const { revisionId } = await applied(
      pauseOp(target),
      { action: 'resume_entity', target },
      { status: 'active' },
      after,
    );
    const { proposal, created } = await createUndoProposal(t.db, revisionId);
    expect(created).toBe(true);
    expect(proposal.action).toEqual({ action: 'resume_entity', target });
    expect(proposal.actionHash).toBe(hashOf({ action: 'resume_entity', target }));
    expect(proposal.undo).toEqual(pauseOp(target)); // the undo of the undo
    expect(proposal.revertsRevisionId).toBe(revisionId);
    expect(proposal.origin).toBe('operator');
    expect(proposal.status).toBe('pending');
    expect(proposal.cycleId).toBeNull();
    // The same fields the gateway re-reads for resume_entity, so the hash can match at apply time.
    expect(proposal.preconditionFields).toEqual(['status']);
    expect(proposal.preconditionHash).toBe(hashOf({ status: 'paused' }));
  });

  it('uses the given fieldsFor to choose the fingerprint fields', async () => {
    const after = { status: 'paused', name: 'Renamed elsewhere' };
    const { revisionId } = await applied(pauseOp(target), { action: 'resume_entity', target }, {}, after);
    const { proposal } = await createUndoProposal(t.db, revisionId, { fieldsFor: () => ['name', 'status'] });
    expect(proposal.preconditionFields).toEqual(['name', 'status']);
    expect(proposal.preconditionHash).toBe(hashOf(after));
  });

  it('works as agent_worker, which may only read the change log (the worker handles undo requests)', async () => {
    const { revisionId } = await applied(
      pauseOp(target),
      { action: 'resume_entity', target },
      {},
      { status: 'paused' },
    );
    const client = await t.pool.connect();
    try {
      await client.query('set role agent_worker');
      const workerDb = drizzle({ client, schema });
      const { proposal, created } = await createUndoProposal(workerDb, revisionId);
      expect(created).toBe(true);
      expect(proposal.revertsRevisionId).toBe(revisionId);
    } finally {
      await client.query('reset role');
      client.release();
    }
  });

  it('an adjust_budget undo goes back to the old amount, and its own undo returns to ours (72 h expiry)', async () => {
    const action: WriteOp = { action: 'adjust_budget', target, newDailyBudgetMicros: '15000000', netIncrease: false };
    const undo: WriteOp = { action: 'adjust_budget', target, newDailyBudgetMicros: '20000000', netIncrease: true };
    const now = new Date('2026-09-25T00:00:00Z');
    const { revisionId } = await applied(
      action,
      undo,
      { dailyBudgetMicros: '20000000' },
      { dailyBudgetMicros: '15000000' },
    );
    const { proposal } = await createUndoProposal(t.db, revisionId, { now });
    expect(proposal.action).toEqual(undo);
    expect(proposal.undo).toEqual({ ...action, netIncrease: false });
    expect(proposal.expiresAt.toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  it('an undone negative keyword can be re-added with the same text and match type', async () => {
    const action: WriteOp = { action: 'add_negative_keyword', target, text: 'free', matchType: 'PHRASE' };
    const undo: WriteOp = { action: 'remove_negative_keyword', target, criterionId: '123' };
    const { revisionId } = await applied(action, undo, {}, { exists: true });
    const { proposal } = await createUndoProposal(t.db, revisionId);
    expect(proposal.action).toEqual(undo);
    expect(proposal.undo).toEqual(action);
  });

  it('a mark_abandoned undo has no undo of its own (terminal)', async () => {
    const created = { ...target, type: 'ad' as const, externalId: 'new-ad' };
    const action: WriteOp = {
      action: 'create_entity_paused',
      parent: target,
      type: 'ad',
      spec: {},
      idempotencyTag: 'tag-1',
    };
    const { revisionId } = await applied(
      action,
      { action: 'mark_abandoned', target: created },
      {},
      { status: 'paused' },
    );
    const { proposal } = await createUndoProposal(t.db, revisionId);
    expect(proposal.action).toEqual({ action: 'mark_abandoned', target: created });
    expect(proposal.undo).toBeNull();
  });

  it('returns the open undo proposal instead of creating a second one', async () => {
    const { revisionId } = await applied(
      pauseOp(target),
      { action: 'resume_entity', target },
      {},
      { status: 'paused' },
    );
    const first = await createUndoProposal(t.db, revisionId);
    const again = await createUndoProposal(t.db, revisionId);
    expect(again.created).toBe(false);
    expect(again.proposal.id).toBe(first.proposal.id);
    // Once that one is rejected, a new undo proposal may be made.
    await transitionProposal(t.db, { proposalId: first.proposal.id, to: 'rejected' });
    expect((await createUndoProposal(t.db, revisionId)).created).toBe(true);
  });

  it('refuses a change with no undo, one already reverted, and one that does not exist', async () => {
    const upload: WriteOp = {
      action: 'upload_conversions',
      platform: 'google',
      accountId: target.accountId,
      destinationId: '1',
      events: [{ eventId: 'a:signup', stage: 'signup', occurredAt: '2026-09-25T00:00:00Z', ids: {} }],
    };
    const irreversible = await applied(upload, null, {}, {});
    await expect(createUndoProposal(t.db, irreversible.revisionId)).rejects.toThrow(/cannot be undone/);

    const a = await applied(pauseOp(target), { action: 'resume_entity', target }, {}, {});
    const b = await applied({ action: 'resume_entity', target }, pauseOp(target), {}, {});
    await markReverted(t.db, a.revisionId, b.revisionId);
    await expect(createUndoProposal(t.db, a.revisionId)).rejects.toThrow(/already reverted/);

    await expect(createUndoProposal(t.db, 'rev_nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the undo proposal is a normal proposal: it can be approved and applied', async () => {
    const { revisionId } = await applied(
      pauseOp(target),
      { action: 'resume_entity', target },
      {},
      { status: 'paused' },
    );
    const { proposal } = await createUndoProposal(t.db, revisionId);
    await transitionProposal(t.db, { proposalId: proposal.id, to: 'approved' });
    await transitionProposal(t.db, { proposalId: proposal.id, to: 'applying' });
    expect((await getProposal(t.db, proposal.id)).idempotencyKey).toBe(`${proposal.id}:1`);
  });
});
