// Marcus's edit of a pending proposal (BLUEPRINT §3.8 `EditSpec`, M09a): one field of the action changes; the
// target and the action type never do. Pure, so every surface's edits are judged the same way and the edit grammar's
// property test can check that each parsed edit gives a valid WriteOp.
import { type EditSpec, type GuardConfig, WriteOp, hashOf, microsToJson } from '@ads/contracts';
import { BUDGET_UNIT_MICROS } from '../draft/budget.ts';

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

export interface EditContext {
  /** The budget before the change (the proposal's planned undo holds it), for a budget edit. */
  previousDailyBudgetMicros: bigint | null;
  guards: Pick<GuardConfig, 'maxBudgetChangePct'>;
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** The action with the edit applied, validated as a WriteOp. Throws EditError when the edit doesn't fit the action,
 *  breaks a limit, or changes nothing. */
export function applyEdit(action: WriteOp, edit: EditSpec, ctx: EditContext): WriteOp {
  const next = editedAction(action, edit, ctx);
  const parsed = WriteOp.safeParse(next);
  if (!parsed.success) throw new EditError(`the edited change is not valid: ${parsed.error.issues[0]?.message ?? ''}`);
  if (hashOf(parsed.data) === hashOf(action)) throw new EditError('the edit changes nothing');
  return parsed.data;
}

function editedAction(action: WriteOp, edit: EditSpec, ctx: EditContext): unknown {
  switch (edit.field) {
    case 'budget': {
      if (action.action !== 'adjust_budget')
        throw new EditError(`a budget edit needs a budget change, not ${action.action}`);
      const next = BigInt(edit.newDailyBudgetMicros);
      const unit = BUDGET_UNIT_MICROS[action.target.platform];
      if (next <= 0n) throw new EditError('the new budget must be more than 0');
      if (next % unit !== 0n)
        throw new EditError(`the new budget must be in steps of ${microsToJson(unit)} micros (0.01)`);
      const previous = ctx.previousDailyBudgetMicros;
      if (previous === null || previous <= 0n) throw new EditError('the budget before the change is not known');
      if (next === previous) throw new EditError('the new budget is the current budget');
      // Basis points, so no float touches money (invariant 6): |next − previous| ≤ previous × max%.
      const maxBasisPoints = BigInt(Math.trunc(ctx.guards.maxBudgetChangePct * 100));
      if (abs(next - previous) * 10_000n > previous * maxBasisPoints) {
        throw new EditError(`a budget may change by at most ${ctx.guards.maxBudgetChangePct}% at a time`);
      }
      return { ...action, newDailyBudgetMicros: microsToJson(next), netIncrease: next > previous };
    }
    case 'negative_text': {
      if (action.action !== 'add_negative_keyword') {
        throw new EditError(`a keyword edit needs a negative keyword, not ${action.action}`);
      }
      const text = edit.text.trim().replaceAll(/\s+/g, ' ');
      if (text === '') throw new EditError('the keyword is empty');
      return { ...action, text };
    }
    case 'match_type':
      if (action.action !== 'add_negative_keyword') {
        throw new EditError(`a match type edit needs a negative keyword, not ${action.action}`);
      }
      return { ...action, matchType: edit.matchType };
  }
}
