import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ActionType,
  UNDO_TABLE,
  UndoContextError,
  undoFor,
  type ApplyContext,
  type EntityRef,
  type WriteOp,
} from '../src/index.ts';

/** A tiny in-memory model of one ad entity, enough to prove that apply-then-undo restores the snapshot.
 *  The real proof per platform lives in the write connectors (M12, M13); this pins the table's logic. */
interface Snapshot {
  status: 'active' | 'paused';
  dailyBudgetMicros: string;
  negatives: Record<string, { text: string; matchType: 'EXACT' | 'PHRASE' }>; // criterionId → negative
  children: Record<string, { status: 'paused' | 'active'; abandoned: boolean }>; // externalId → created entity
}

const target: EntityRef = { platform: 'google', accountId: '123', type: 'campaign', externalId: '42' };
let nextId = 0;

function apply(s: Snapshot, op: WriteOp): { state: Snapshot; ctx: ApplyContext } {
  const state = structuredClone(s);
  switch (op.action) {
    case 'pause_entity':
      state.status = 'paused';
      return { state, ctx: {} };
    case 'resume_entity':
      state.status = 'active';
      return { state, ctx: {} };
    case 'adjust_budget': {
      const previous = state.dailyBudgetMicros;
      state.dailyBudgetMicros = op.newDailyBudgetMicros;
      return { state, ctx: { previousDailyBudgetMicros: previous } };
    }
    case 'add_negative_keyword': {
      const id = `c${nextId++}`;
      state.negatives[id] = { text: op.text, matchType: op.matchType };
      return { state, ctx: { createdCriterionId: id } };
    }
    case 'remove_negative_keyword': {
      const removed = state.negatives[op.criterionId];
      if (!removed) throw new Error('criterion not found');
      delete state.negatives[op.criterionId];
      return { state, ctx: { removedNegative: removed } };
    }
    case 'create_entity_paused': {
      const id = `e${nextId++}`;
      state.children[id] = { status: 'paused', abandoned: false };
      return { state, ctx: { createdRef: { ...op.parent, type: op.type, externalId: id } } };
    }
    case 'mark_abandoned': {
      const child = state.children[op.target.externalId];
      if (!child) throw new Error('entity not found');
      child.abandoned = true;
      return { state, ctx: {} };
    }
    case 'upload_conversions':
      return { state, ctx: {} };
  }
}

/** Negatives compared by content: an undo-of-undo re-creates the criterion under a new id. */
const normalise = (s: Snapshot) => ({
  ...s,
  negatives: Object.values(s.negatives)
    .map((n) => `${n.matchType}:${n.text}`)
    .sort(),
});

const micros = fc.bigInt({ min: 1_000_000n, max: 10n ** 10n }).map(String);
const snapshot: fc.Arbitrary<Snapshot> = fc.record({
  status: fc.constantFrom('active' as const, 'paused' as const),
  dailyBudgetMicros: micros,
  negatives: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 4 }).map((s) => `n${s}`),
    fc.record({
      text: fc.string({ minLength: 1, maxLength: 20 }),
      matchType: fc.constantFrom('EXACT' as const, 'PHRASE' as const),
    }),
    { maxKeys: 3 },
  ),
  children: fc.constant({}),
});

/** A reversible op that is valid in `s` (the gateway's preconditions exclude no-op pauses and resumes). */
const reversibleOp = (s: Snapshot): fc.Arbitrary<WriteOp> =>
  fc.oneof(
    fc.constant<WriteOp>(
      s.status === 'active' ? { action: 'pause_entity', target } : { action: 'resume_entity', target },
    ),
    micros.map<WriteOp>((m) => ({
      action: 'adjust_budget',
      target,
      newDailyBudgetMicros: m,
      netIncrease: BigInt(m) > BigInt(s.dailyBudgetMicros),
    })),
    fc
      .record({
        text: fc.string({ minLength: 1, maxLength: 80 }),
        matchType: fc.constantFrom('EXACT' as const, 'PHRASE' as const),
      })
      .map<WriteOp>((n) => ({ action: 'add_negative_keyword', target, ...n })),
    ...(Object.keys(s.negatives).length > 0
      ? [
          fc
            .constantFrom(...Object.keys(s.negatives))
            .map<WriteOp>((id) => ({ action: 'remove_negative_keyword', target, criterionId: id })),
        ]
      : []),
  );

describe('undo table', () => {
  it('covers every action type', () => {
    expect(Object.keys(UNDO_TABLE).sort()).toEqual([...ActionType.options].sort());
    for (const [action, rule] of Object.entries(UNDO_TABLE)) {
      expect(rule.kind === 'reversible', action).toBe(rule.undo !== null);
    }
    expect(UNDO_TABLE.upload_conversions.kind).toBe('irreversible');
    expect(UNDO_TABLE.mark_abandoned.kind).toBe('terminal');
  });

  it('apply-then-undo restores the snapshot for every reversible action (property)', () => {
    fc.assert(
      fc.property(
        snapshot.chain((s) => fc.tuple(fc.constant(s), reversibleOp(s))),
        ([before, op]) => {
          const applied = apply(before, op);
          const undo = undoFor(op, applied.ctx);
          expect(undo).not.toBeNull();
          expect(undo!.action).toBe(UNDO_TABLE[op.action].undo);
          const restored = apply(applied.state, undo!).state;
          expect(normalise(restored)).toEqual(normalise(before));
        },
      ),
    );
  });

  it('the undo of a budget change raises spend only when the change lowered it', () => {
    const op: WriteOp = { action: 'adjust_budget', target, newDailyBudgetMicros: '8000000', netIncrease: false };
    expect(undoFor(op, { previousDailyBudgetMicros: '10000000' })).toEqual({
      action: 'adjust_budget',
      target,
      newDailyBudgetMicros: '10000000',
      netIncrease: true,
    });
  });

  it('create_entity_paused is undone by marking the entity abandoned: it stays paused and is never deleted', () => {
    const before: Snapshot = { status: 'active', dailyBudgetMicros: '1000000', negatives: {}, children: {} };
    const op: WriteOp = { action: 'create_entity_paused', parent: target, type: 'ad', spec: {}, idempotencyTag: 't1' };
    const applied = apply(before, op);
    const undo = undoFor(op, applied.ctx);
    expect(undo?.action).toBe('mark_abandoned');
    const after = apply(applied.state, undo!).state;
    expect(Object.values(after.children)).toEqual([{ status: 'paused', abandoned: true }]);
  });

  it('irreversible and terminal actions have no undo', () => {
    const upload: WriteOp = {
      action: 'upload_conversions',
      platform: 'meta',
      accountId: 'act_1',
      destinationId: 'd1',
      events: [{ eventId: 's1:signup', stage: 'signup', occurredAt: '2026-09-25T00:00:00Z', ids: {} }],
    };
    expect(undoFor(upload)).toBeNull();
    expect(undoFor({ action: 'mark_abandoned', target })).toBeNull();
  });

  it('refuses to build an undo without what the apply learned', () => {
    expect(() => undoFor({ action: 'add_negative_keyword', target, text: 'free', matchType: 'EXACT' })).toThrow(
      UndoContextError,
    );
    expect(() => undoFor({ action: 'adjust_budget', target, newDailyBudgetMicros: '1', netIncrease: false })).toThrow(
      UndoContextError,
    );
  });
});
