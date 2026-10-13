// The finding → action step of drafting (BLUEPRINT §3.7, §5.11): which write action a confirmed finding becomes,
// with every value taken from the database. The registry names the action and the phase from which it is
// proposed; the product may remove actions; the target must be in a state the action can change.
import {
  type EntityRef,
  type FindingTypeId,
  type GuardConfig,
  type ProductSettings,
  type WriteOp,
  fingerprintFieldsFor,
  fingerprintOf,
  microsToJson,
} from '@ads/contracts';
import type { AdEntity, Finding } from '@ads/db';
import { FINDING_TYPES } from '../findings/registry.ts';
import { budgetChange } from './budget.ts';

/** What the action builder needs besides the finding: all from the database or settings, never from the AI. */
export interface ActionContext {
  phase: number;
  settings: Pick<ProductSettings, 'disabledActions'>;
  /** The finding's target entity and its account's external id, when it targets an entity. */
  target: { entity: AdEntity; accountExternalId: string } | null;
  guardsFor: (platform: AdEntity['platform']) => GuardConfig;
  /** True when `term` is a real search term of the ad group in the finding's evidence window. */
  isRealSearchTerm: (adGroupEntityId: string, term: string) => Promise<boolean>;
}

export type DraftableAction =
  { ok: true; action: WriteOp; entity: AdEntity } | { ok: false; reason: string; notYet?: boolean };

const no = (reason: string, notYet = false): DraftableAction => ({ ok: false, reason, ...(notYet ? { notYet } : {}) });

const refOf = (entity: AdEntity, accountExternalId: string): EntityRef => ({
  platform: entity.platform,
  accountId: accountExternalId,
  type: entity.type,
  externalId: entity.externalId,
});

/** The direction each budget type may move a budget. */
const BUDGET_DIRECTION: Partial<Record<FindingTypeId, 1 | -1>> = {
  budget_limited_efficient: 1,
  overspend_inefficient: -1,
  pacing_risk: -1,
};

interface FindingParams {
  negativeText?: unknown;
  negativeMatchType?: unknown;
  budgetChangePct?: unknown;
}

export async function actionForFinding(
  finding: Pick<Finding, 'type' | 'params'>,
  ctx: ActionContext,
): Promise<DraftableAction> {
  const type = finding.type as FindingTypeId;
  const spec = FINDING_TYPES[type] as (typeof FINDING_TYPES)[FindingTypeId] | undefined;
  if (spec === undefined) return no(`unknown finding type ${finding.type}`);
  if (spec.action === null || spec.proposalsFromPhase === null) return no('this type never makes a proposal');
  if (spec.proposalsFromPhase > ctx.phase) {
    return no(`proposed from phase ${spec.proposalsFromPhase}; the system is in phase ${ctx.phase}`, true);
  }
  if (ctx.settings.disabledActions.includes(spec.action)) return no(`the product disabled ${spec.action}`);
  if (ctx.target === null) return no('the finding has no ad entity to act on');
  const { entity, accountExternalId } = ctx.target;
  const target = refOf(entity, accountExternalId);
  const params = (finding.params ?? {}) as FindingParams;

  switch (spec.action) {
    case 'pause_entity':
      if (entity.status !== 'active') return no(`the ${entity.type} is ${entity.status}, not active`);
      return { ok: true, action: { action: 'pause_entity', target }, entity };

    case 'add_negative_keyword': {
      // The registry targets ad groups: search terms (and so the real-term check) are per ad group.
      if (entity.platform !== 'google' || entity.type !== 'ad_group') return no('negatives go on a Google ad group');
      if (entity.status === 'removed') return no(`the ${entity.type} is removed`);
      const text = params.negativeText;
      if (typeof text !== 'string' || text.trim() === '' || text.length > 80) return no('no usable negative text');
      // Only a real search term, and only EXACT or PHRASE: a BROAD negative could block far more than intended.
      const matchType = params.negativeMatchType === 'PHRASE' ? 'PHRASE' : 'EXACT';
      if (!(await ctx.isRealSearchTerm(entity.id, text))) return no('the negative text is not a real search term');
      return { ok: true, action: { action: 'add_negative_keyword', target, text, matchType }, entity };
    }

    case 'adjust_budget': {
      if (entity.budgetShared) return no('a shared budget is never changed by this system');
      if (entity.dailyBudgetMicros === null) return no(`the ${entity.type} has no daily budget of its own`);
      const pct = params.budgetChangePct;
      if (typeof pct !== 'number' || !Number.isFinite(pct)) return no('no budget change asked for');
      const direction = BUDGET_DIRECTION[type];
      if (direction !== undefined && Math.sign(pct) !== direction) {
        return no(`a ${type} finding may only move the budget ${direction > 0 ? 'up' : 'down'}`);
      }
      const change = budgetChange({
        currentMicros: entity.dailyBudgetMicros,
        pct,
        guards: ctx.guardsFor(entity.platform),
        platform: entity.platform,
      });
      if (!change.ok) return no(change.reason);
      return {
        ok: true,
        action: {
          action: 'adjust_budget',
          target,
          newDailyBudgetMicros: microsToJson(change.newDailyBudgetMicros),
          netIncrease: change.netIncrease,
        },
        entity,
      };
    }

    default:
      return no(`drafting ${spec.action} is not built yet`, true); // create_entity_paused: M15b
  }
}

/** The entity state the fingerprint is taken from: the synced, normalised fields. The gateway builds the same
 *  state from its fresh read (M11a); `parentStatus` is the status of the entity a negative goes on. */
export function entityState(entity: AdEntity): Record<string, unknown> {
  return {
    status: entity.status,
    dailyBudgetMicros: entity.dailyBudgetMicros === null ? null : microsToJson(entity.dailyBudgetMicros),
    budgetShared: entity.budgetShared,
    parentStatus: entity.status,
  };
}

/** The precondition stored with a proposal: the fingerprint over the action's fields that the synced state holds.
 *  The ones it doesn't hold yet (a negative list's hash, a budget's type) are left out of `fields`, so the gateway
 *  hashes exactly the listed ones. */
export function preconditionOf(action: WriteOp, entity: AdEntity): { hash: string | null; fields: string[] } {
  const state = entityState(entity);
  const fields = fingerprintFieldsFor(action.action).filter((f) => f in state);
  return fields.length === 0 ? { hash: null, fields } : { hash: fingerprintOf(state, fields), fields };
}
