import type { ActionType } from './settings.ts';
import type { EntityRef } from './platform.ts';
import type { WriteOp } from './writes.ts';

/** One row of the undo table (BLUEPRINT §3.6). The gateway stores the undo when it applies an action. */
export interface UndoRule {
  /** The action that undoes it, or null when there is none. */
  undo: ActionType | null;
  /** The undo only runs if this still holds (checked by the gateway against a fresh read). */
  onlyIf: string | null;
  kind: 'reversible' | 'irreversible' | 'terminal';
  notes: string;
}

export const UNDO_TABLE: Readonly<Record<ActionType, UndoRule>> = {
  pause_entity: {
    undo: 'resume_entity',
    onlyIf: 'the entity is still paused',
    kind: 'reversible',
    notes: 'Re-enables spend, so the ceilings are checked',
  },
  add_negative_keyword: {
    undo: 'remove_negative_keyword',
    onlyIf: 'the criterion we created still exists',
    kind: 'reversible',
    notes: 'Removal is allowed only for negatives we added',
  },
  adjust_budget: {
    undo: 'adjust_budget',
    onlyIf: 'the budget still equals the amount we set',
    kind: 'reversible',
    notes: 'The ceilings are checked if the undo raises spend',
  },
  create_entity_paused: {
    undo: 'mark_abandoned',
    onlyIf: 'the entity is still paused',
    kind: 'reversible',
    notes: 'Stays paused and gets a label or name suffix; never deleted',
  },
  upload_conversions: {
    undo: null,
    onlyIf: null,
    kind: 'irreversible',
    notes: 'Safeguards in PROPOSAL §8',
  },
  resume_entity: {
    undo: 'pause_entity',
    onlyIf: 'the entity is still active',
    kind: 'reversible',
    notes: 'An undo of an undo',
  },
  remove_negative_keyword: {
    undo: 'add_negative_keyword',
    onlyIf: 'no equal negative exists on the target',
    kind: 'reversible',
    notes: 'An undo of an undo',
  },
  mark_abandoned: { undo: null, onlyIf: null, kind: 'terminal', notes: 'Terminal' },
};

/** What the gateway learned when applying `op`, needed to build its undo. */
export interface ApplyContext {
  /** adjust_budget: the daily budget before the change (from the pre-apply snapshot). */
  previousDailyBudgetMicros?: string;
  /** add_negative_keyword: the criterion the platform created. */
  createdCriterionId?: string;
  /** create_entity_paused: the entity the platform created. */
  createdRef?: EntityRef;
  /** remove_negative_keyword: the text and match type of the negative that was removed. */
  removedNegative?: { text: string; matchType: 'EXACT' | 'PHRASE' };
}

export class UndoContextError extends Error {
  constructor(action: ActionType, missing: keyof ApplyContext) {
    super(`cannot build the undo of ${action}: ${missing} is missing`);
    this.name = 'UndoContextError';
  }
}

/** The stored undo of an applied action, or null when UNDO_TABLE says it has none. */
export function undoFor(op: WriteOp, ctx: ApplyContext = {}): WriteOp | null {
  switch (op.action) {
    case 'pause_entity':
      return { action: 'resume_entity', target: op.target };
    case 'resume_entity':
      return { action: 'pause_entity', target: op.target };
    case 'add_negative_keyword':
      if (ctx.createdCriterionId === undefined) throw new UndoContextError(op.action, 'createdCriterionId');
      return { action: 'remove_negative_keyword', target: op.target, criterionId: ctx.createdCriterionId };
    case 'remove_negative_keyword':
      if (ctx.removedNegative === undefined) throw new UndoContextError(op.action, 'removedNegative');
      return { action: 'add_negative_keyword', target: op.target, ...ctx.removedNegative };
    case 'adjust_budget': {
      const previous = ctx.previousDailyBudgetMicros;
      if (previous === undefined) throw new UndoContextError(op.action, 'previousDailyBudgetMicros');
      return {
        action: 'adjust_budget',
        target: op.target,
        newDailyBudgetMicros: previous,
        netIncrease: BigInt(previous) > BigInt(op.newDailyBudgetMicros),
      };
    }
    case 'create_entity_paused':
      if (ctx.createdRef === undefined) throw new UndoContextError(op.action, 'createdRef');
      return { action: 'mark_abandoned', target: ctx.createdRef };
    case 'upload_conversions':
    case 'mark_abandoned':
      return null;
  }
}
