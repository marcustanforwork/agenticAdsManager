// The SnapPool pack's manifest: pure data and schemas, no I/O (BLUEPRINT §2 rule 4). The defaults follow
// docs/plan/SNAPPOOL-TRACKING.md §2; Marcus can change any of them in the product's settings without a deploy.
import { MicrosJson, type PackManifest } from '@ads/contracts';
import { z } from 'zod';

/** SnapPool's own pricing phases (its `pricing phase` setting). The beta signup window ends 2026-11-30. */
export const PRICING_PHASES = ['beta', 'promo', 'standard'] as const;

/** The fact base: what copy and the analyst may state about SnapPool. Plain shapes only (no refinements or
 *  transforms), so the JSON Schema published for the dashboard accepts exactly what this schema accepts. */
export const SnapPoolFacts = z.object({
  features: z.array(z.string().min(1).max(200)).min(1),
  eventTypes: z.array(z.string().min(1).max(60)).min(1),
  plans: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
      name: z.string().min(1).max(60),
      priceMicros: MicrosJson.nullable(), // null = free, or not on sale
      limits: z.object({
        guests: z.number().int().min(0).optional(),
        photos: z.number().int().min(0).optional(),
        retentionDays: z.number().int().min(0).optional(),
        concurrentEvents: z.number().int().min(0).optional(),
      }),
    }),
  ),
  pricing: z.object({
    phase: z.enum(PRICING_PHASES),
    currency: z.string().regex(/^[A-Z]{3}$/),
    notes: z.string().max(500).optional(),
  }),
});
export type SnapPoolFacts = z.infer<typeof SnapPoolFacts>;

/** Whole Singapore dollars as micros, in bigint (never a float for money). */
const money = (sgd: number): string => (BigInt(sgd) * 1_000_000n).toString();

export const manifest: PackManifest = {
  id: 'saas-snappool',
  version: '0.1.0',
  defaults: {
    outcomes: {
      stages: [
        { id: 'pool_request', label: 'Pool request (/start submitted)', tier: 'soft' },
        { id: 'signup', label: 'Signup (email link clicked)', tier: 'success' },
        { id: 'activated', label: 'Activated (first photo)', tier: 'success' },
        { id: 'paid', label: 'Paid (no checkout yet)', tier: 'hard' },
      ],
      primaryKpiStage: 'signup',
      // The destination ids come from setup tasks T4 (Meta dataset) and T11 (Google conversion action): null until
      // then, so nothing is uploaded on these routes yet (D-076).
      feedback: [
        { stage: 'pool_request', platform: 'meta', destinationId: null, eventName: 'Lead' },
        { stage: 'signup', platform: 'meta', destinationId: null, eventName: 'CompleteRegistration' },
        { stage: 'signup', platform: 'google', destinationId: null },
      ],
    },
    copy: {
      tier: 'fragments',
      requiredStrings: [],
      // Claims that would not match the product: free is a beta offer, and every plan has limits.
      bannedPhrases: ['free forever', 'unlimited'],
    },
  },
  phases: [
    {
      id: 'beta',
      label: 'Beta (free)',
      intent:
        'SnapPool is free while in beta: the signup window runs to 30 November 2026 and free plans are honoured ' +
        'to 1 January 2027. The goal is signups that turn into pools with photos, at a low cost per signup. ' +
        'There is no revenue yet, so spend stays within the monthly ceiling and changes follow evidence.',
      budgetPosture: 'steady',
    },
    {
      id: 'promo',
      label: 'Launch promotion',
      intent:
        'Paid plans are on sale with an introductory offer. Signups that go on to pay matter most; spend may ' +
        'grow where the cost per signup holds.',
      budgetPosture: 'push',
    },
    {
      id: 'standard',
      label: 'Standard pricing',
      intent: 'Normal pricing. Look for paying customers at a cost the plans can carry.',
      budgetPosture: 'steady',
    },
  ],
  facts: { schema: SnapPoolFacts, requiredForCopy: ['features', 'pricing'] },
  // Low click floors (signups are cheap, clicks are few at this spend) and high day floors (weekly rhythms and
  // event dates make short windows noisy).
  thresholds: {
    zero_outcome_spend: { minImpressions: 1000, minClicks: 25, minSpendMicros: money(30), minDays: 7 },
    wasteful_search_term: { minImpressions: 50, minClicks: 8, minSpendMicros: money(8), minDays: 14 },
    no_delivery: { minImpressions: 0, minClicks: 0, minSpendMicros: '0', minDays: 3 },
    tracking_gap: { minImpressions: 500, minClicks: 30, minSpendMicros: '0', minDays: 7 },
    cost_spike: { minImpressions: 1000, minClicks: 20, minSpendMicros: money(20), minDays: 14 },
    pacing_risk: { minImpressions: 0, minClicks: 0, minSpendMicros: '0', minDays: 3 },
    budget_limited_efficient: { minImpressions: 2000, minClicks: 40, minSpendMicros: money(50), minDays: 14 },
    overspend_inefficient: { minImpressions: 2000, minClicks: 40, minSpendMicros: money(50), minDays: 14 },
    copy_refresh: { minImpressions: 5000, minClicks: 30, minSpendMicros: money(30), minDays: 21 },
  },
  platformPolicy: {},
  // A starting draft for Marcus to edit: trusted guidance, shown to the analyst as is.
  analystContext: [
    'SnapPool (snappool.photos) gives an event one shared photo pool: guests scan a code and add photos to a ' +
      'gallery the host keeps. Hosts are people organising weddings, parties and similar events in Singapore.',
    'The funnel: a /start request (pool_request), the email link clicked (signup, the KPI during beta), and the ' +
      'first photo in the pool (activated). Activation usually happens on the event day, often weeks after the ' +
      'click, so judge ads on signups, not activations. There is no checkout yet, so "paid" has no data.',
    'Spend is about S$500 a month across Meta (first) and Google Search (second). Conversions reach the platforms ' +
      'only through the agent’s uploads, so platform-reported conversions stay at zero until uploads start.',
    'Seasonal peaks: the wedding season and the year-end party season (November and December) bring more ' +
      'searches; a dip after a peak is not a fault.',
  ].join('\n\n'),
};
