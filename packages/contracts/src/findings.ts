import { z } from 'zod';
import { IsoDate } from './hash.ts';
import { MicrosJson } from './money.ts';
import { EntityRef } from './platform.ts';

export const FindingTypeId = z.enum([
  'zero_outcome_spend', // → pause_entity                 (Phase 2)
  'wasteful_search_term', // → add_negative_keyword          (Phase 2, Google)
  'no_delivery', // → no action (diagnose)
  'tracking_gap', // → no action (diagnose)
  'cost_spike', // → no action (explain)
  'pacing_risk', // → no action; from Phase 3: adjust_budget (down)
  'budget_limited_efficient', // → adjust_budget (up)            (Phase 3)
  'overspend_inefficient', // → adjust_budget (down)          (Phase 3)
  'copy_refresh', // → create_entity_paused (ad variants, Phase 4)
]);
export type FindingTypeId = z.infer<typeof FindingTypeId>;
// The registry in core/findings maps each type to: allowed target types, the action it maps to (or none),
// required params, and the phase from which it may produce proposals.

/** What the AI returns. Nothing in here decides a number. */
export const AnalystFinding = z.object({
  type: FindingTypeId,
  target: EntityRef, // must exist in our DB and belong to this product (checked)
  fromCandidateId: z.string().nullable(), // the detector candidate it confirms; null = a new finding
  summary: z.string().max(400),
  whyNow: z.string().max(400),
  evidenceRefs: z.array(z.string()).max(20), // rows it looked at — shown to Marcus, never trusted
  params: z
    .object({
      budgetChangePct: z.number().min(-50).max(50).optional(), // a hint; core clamps it with the guards
      negativeText: z.string().max(80).optional(), // must equal a real search-term row (checked)
      negativeMatchType: z.enum(['EXACT', 'PHRASE']).optional(),
    })
    .optional(),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type AnalystFinding = z.infer<typeof AnalystFinding>;

export const AnalystOutput = z.object({
  findings: z.array(AnalystFinding).max(30),
  dismissed: z.array(z.object({ candidateId: z.string(), reason: z.string().max(300) })),
});
export type AnalystOutput = z.infer<typeof AnalystOutput>;

/** A figure a detector rule computed (money as a decimal string of micros), shown with the finding. */
export const EvidenceDetailValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Stored with each finding. Computed by core from the DB for the target and window — never taken from the AI. */
export const ComputedEvidence = z.object({
  windowDays: z.number().int(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  spendMicros: MicrosJson,
  outcomesByStage: z.record(z.string(), z.number().int()),
  // M06a (D-079):
  from: IsoDate, // the window's first and last day, the product's local days, inclusive
  to: IsoDate,
  /** Days of the window the target was watched: from its first day of data (or first sighting) on. The threshold
   *  engine's `minDays` is checked against this. */
  dataDays: z.number().int().min(0),
  /** The rule's own figures (e.g. projected month spend, the median cost per KPI), computed by core. */
  detail: z.record(z.string(), EvidenceDetailValue).optional(),
});
export type ComputedEvidence = z.infer<typeof ComputedEvidence>;
