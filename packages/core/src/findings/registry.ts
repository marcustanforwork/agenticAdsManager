// The finding-type registry (BLUEPRINT §3.7): for each finding type, the targets it may be about, the write action
// it maps to (or none), the parameters that action needs, the phase from which it may produce proposals, and the
// evidence window its rule looks at. The analyse stage (M06b) checks the AI's findings against it, and the draft
// stage (M08) takes the action from it: a type with no action produces a finding only.
import type { ActionType, EntityType, EvidenceThreshold, FindingTypeId } from '@ads/contracts';

/** An ad entity's type, an ad account, or the whole product (D-079). */
export type TargetKind = EntityType | 'account' | 'product';

export type FindingParam = 'negativeText' | 'negativeMatchType' | 'budgetChangePct';

export interface FindingTypeSpec {
  /** What a finding of this type may be about. */
  targets: readonly TargetKind[];
  /** The write action a proposal would carry, or null: the finding only diagnoses or explains. */
  action: ActionType | null;
  /** Parameters the action needs from the finding (all checked by core, never trusted). */
  requiredParams: readonly FindingParam[];
  /** The phase (PROPOSAL §12) from which the type may produce proposals; null when it never does. */
  proposalsFromPhase: number | null;
  /** The days of evidence the rule looks at, ending yesterday; at least the pack's `minDays`. */
  windowDays: number;
  /** Plain words for summaries and the digest. */
  label: string;
}

export const FINDING_TYPES: Readonly<Record<FindingTypeId, FindingTypeSpec>> = {
  zero_outcome_spend: {
    targets: ['campaign', 'ad_group', 'ad'],
    action: 'pause_entity',
    requiredParams: [],
    proposalsFromPhase: 2,
    windowDays: 14,
    label: 'Spend without outcomes',
  },
  wasteful_search_term: {
    targets: ['ad_group'],
    action: 'add_negative_keyword',
    requiredParams: ['negativeText'],
    proposalsFromPhase: 2,
    windowDays: 28,
    label: 'Costly search term',
  },
  no_delivery: {
    targets: ['campaign', 'ad_group'],
    action: null,
    requiredParams: [],
    proposalsFromPhase: null,
    windowDays: 3,
    label: 'No delivery',
  },
  tracking_gap: {
    targets: ['account'],
    action: null,
    requiredParams: [],
    proposalsFromPhase: null,
    windowDays: 7,
    label: 'Tracking gap',
  },
  cost_spike: {
    targets: ['campaign'],
    action: null,
    requiredParams: [],
    proposalsFromPhase: null,
    windowDays: 35, // this week and the four before it
    label: 'Cost spike',
  },
  pacing_risk: {
    targets: ['product', 'campaign', 'budget'],
    action: 'adjust_budget', // down, from Phase 3 (M14); before that a finding only
    requiredParams: [],
    proposalsFromPhase: 3,
    windowDays: 31, // the month to date; the rule sets its own window
    label: 'Pacing against the monthly ceiling',
  },
  budget_limited_efficient: {
    targets: ['campaign', 'ad_group', 'budget'],
    action: 'adjust_budget',
    requiredParams: [],
    proposalsFromPhase: 3,
    windowDays: 7,
    label: 'Limited by budget and efficient',
  },
  overspend_inefficient: {
    targets: ['campaign', 'ad_group', 'budget'],
    action: 'adjust_budget',
    requiredParams: [],
    proposalsFromPhase: 3,
    windowDays: 14,
    label: 'Overspending and inefficient',
  },
  copy_refresh: {
    targets: ['ad'],
    action: 'create_entity_paused',
    requiredParams: [],
    proposalsFromPhase: 4,
    windowDays: 21,
    label: 'Ad copy due for a refresh',
  },
};

export const findingTypeSpec = (type: FindingTypeId): FindingTypeSpec => FINDING_TYPES[type];

export const allowsTarget = (type: FindingTypeId, kind: TargetKind): boolean =>
  FINDING_TYPES[type].targets.includes(kind);

/** The evidence window for a type: its own, stretched to the pack's `minDays` so the threshold can be met. */
export const evidenceWindowDays = (type: FindingTypeId, threshold: EvidenceThreshold | null): number =>
  Math.max(FINDING_TYPES[type].windowDays, threshold?.minDays ?? 0);
