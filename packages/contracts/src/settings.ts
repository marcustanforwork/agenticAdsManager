import { z } from 'zod';
import { MicrosJson } from './money.ts';
import { Platform } from './platform.ts';

export const ActionType = z.enum([
  'pause_entity',
  'add_negative_keyword',
  'adjust_budget',
  'create_entity_paused',
  'upload_conversions',
  'resume_entity',
  'remove_negative_keyword',
  'mark_abandoned', // undo-only (BLUEPRINT §3.6)
]);
export type ActionType = z.infer<typeof ActionType>;

export const OutcomeStage = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/), // 'signup', 'form_fill', …
  label: z.string(),
  tier: z.enum(['soft', 'success', 'hard']),
  valueMicros: MicrosJson.optional(), // optional value per stage, for value-based feedback
});
export type OutcomeStage = z.infer<typeof OutcomeStage>;

/** One conversion upload route: this stage goes to this platform destination (D-060).
 *  A stage may have routes to both platforms, and a platform may take several stages. */
export const FeedbackRoute = z.object({
  stage: z.string(),
  platform: Platform,
  destinationId: z.string(), // Meta dataset (pixel) id, or Google conversion action id
  eventName: z.string().optional(), // Meta event name, e.g. 'Lead', 'CompleteRegistration'
});
export type FeedbackRoute = z.infer<typeof FeedbackRoute>;

export const OutcomeConfig = z
  .object({
    stages: z.array(OutcomeStage).min(1),
    primaryKpiStage: z.string(), // the KPI is "cost per <this stage>"
    feedback: z.array(FeedbackRoute), // which stages are uploaded where; empty = no uploads
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set(cfg.stages.map((s) => s.id));
    if (ids.size !== cfg.stages.length) {
      ctx.addIssue({ code: 'custom', path: ['stages'], message: 'stage ids must be unique' });
    }
    if (!ids.has(cfg.primaryKpiStage)) {
      ctx.addIssue({ code: 'custom', path: ['primaryKpiStage'], message: 'must be one of the stage ids' });
    }
    cfg.feedback.forEach((route, i) => {
      if (!ids.has(route.stage)) {
        ctx.addIssue({ code: 'custom', path: ['feedback', i, 'stage'], message: 'must be one of the stage ids' });
      }
    });
  });
export type OutcomeConfig = z.infer<typeof OutcomeConfig>;

export const GuardConfig = z.object({
  maxBudgetChangePct: z.number().positive().max(100), // core 30; Meta platform default 20
  minBudgetDeltaMicros: MicrosJson, // core "5000000" (SGD 5)
  minBudgetDeltaPct: z.number().min(0), // core 5
  cooldownDays: z.number().int().min(0), // core 7
  budgetNeutralByDefault: z.boolean(), // core true
  maxAppliedPerDay: z.number().int().min(0), // core 10
});
export type GuardConfig = z.infer<typeof GuardConfig>;
export const GuardOverrides = GuardConfig.partial();
export type GuardOverrides = z.infer<typeof GuardOverrides>;

export const CORE_GUARD_DEFAULTS: GuardConfig = {
  maxBudgetChangePct: 30,
  minBudgetDeltaMicros: '5000000',
  minBudgetDeltaPct: 5,
  cooldownDays: 7,
  budgetNeutralByDefault: true,
  maxAppliedPerDay: 10,
};

export const PLATFORM_GUARD_DEFAULTS: Record<Platform, GuardOverrides> = {
  google: {},
  meta: { maxBudgetChangePct: 20 },
};

/** For each guard: which direction is stricter. */
const STRICTER: { [K in keyof GuardConfig]: (candidate: GuardConfig[K], current: GuardConfig[K]) => boolean } = {
  maxBudgetChangePct: (a, b) => a <= b,
  minBudgetDeltaMicros: (a, b) => BigInt(a) >= BigInt(b),
  minBudgetDeltaPct: (a, b) => a >= b,
  cooldownDays: (a, b) => a >= b,
  budgetNeutralByDefault: (a, b) => a || !b,
  maxAppliedPerDay: (a, b) => a <= b,
};

export class GuardLoosenedError extends Error {
  readonly field: keyof GuardConfig;
  readonly layer: number;
  constructor(field: keyof GuardConfig, layer: number, attempted: unknown, current: unknown) {
    super(
      `guard override loosens ${field}: layer ${layer} sets ${String(attempted)}, stricter value is ${String(current)}`,
    );
    this.name = 'GuardLoosenedError';
    this.field = field;
    this.layer = layer;
  }
}

/** Effective guards = the STRICTEST of: core defaults, platform default, pack override, product override.
 *  Pass the layers in that order; the first must be complete. A looser value in a later layer throws
 *  GuardLoosenedError: when saving settings it is a validation error, never silently ignored. */
export function mergeGuardsTightenOnly(...layers: GuardOverrides[]): GuardConfig {
  const [base, ...rest] = layers;
  const merged: GuardConfig = GuardConfig.parse(base);
  rest.forEach((layer, i) => {
    const parsed = GuardOverrides.parse(layer);
    for (const field of Object.keys(parsed) as (keyof GuardConfig)[]) {
      const value = parsed[field];
      if (value === undefined) continue;
      const stricter = STRICTER[field] as (a: unknown, b: unknown) => boolean;
      if (!stricter(value, merged[field])) throw new GuardLoosenedError(field, i + 1, value, merged[field]);
      (merged as Record<keyof GuardConfig, unknown>)[field] = value;
    }
  });
  return merged;
}

export const TrustSettings = z.object({
  minClicksToJudgeTracking: z.number().int().min(1), // default 30 (fewer clicks → 'no_signal', not 'fail')
  maxOutcomeStalenessHours: z.number().int().min(1), // default 48
  maxAttributionGapPct: z.number().min(0), // default 50
  minOutcomesForGap: z.number().int().min(1), // default 10
  minIdCapturePct: z.number().min(0).max(100), // default 60 (warn below)
});
export type TrustSettings = z.infer<typeof TrustSettings>;

export const CopySettings = z.object({
  tier: z.enum(['fragments', 'reword']), // PROPOSAL §6.12
  requiredStrings: z.array(z.string().min(1)),
  bannedPhrases: z.array(z.string().min(1)),
});
export type CopySettings = z.infer<typeof CopySettings>;

/** ONE validated document per product (products.settings), with full version history. */
export const ProductSettings = z.object({
  spend: z.object({
    dailyCeilingMicros: MicrosJson.nullable(), // null = unset → budget increases and creates are blocked
    monthlyCeilingMicros: MicrosJson.nullable(),
    autoPauseOnMonthlyBreach: z.boolean(), // default false
  }),
  outcomes: OutcomeConfig,
  trust: TrustSettings,
  agent: z.object({
    analystLookupBudget: z.number().int().min(0), // default 20 read-only look-ups per cycle
    autoApproveFeedback: z.boolean(), // default false; Marcus turns on after the Phase 2 gate
    feedbackDailyCap: z.number().int().min(0), // default 200 events per platform per day
  }),
  notifications: z.object({ digest: z.enum(['auto', 'always', 'off']) }), // auto = only while spending
  copy: CopySettings,
  testTraffic: z.object({
    // D-059: outcomes from these are never uploaded or counted
    emailDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)), // kept in the DB, not the repo
  }),
  guardOverrides: GuardOverrides, // tighten-only
  disabledActions: z.array(ActionType), // may only remove actions
});
export type ProductSettings = z.infer<typeof ProductSettings>;
