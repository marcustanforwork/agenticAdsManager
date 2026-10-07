// The Property SG pack's manifest: pure data and schemas, no I/O (BLUEPRINT §2 rule 4). New-launch condominium
// projects in Singapore, sold by Marcus as the licensed agent (PROPOSAL §4). Every default here is a starting
// point that Marcus can change in the product's settings without a deploy.
import { MicrosJson, type PackManifest } from '@ads/contracts';
import { z } from 'zod';

/** A project's launch phases, in order. `detectPhase` (runtime.ts) picks one from the offering's launch dates. */
export const LAUNCH_PHASES = ['teaser', 'vvip', 'booking', 'clearing'] as const;
export type LaunchPhase = (typeof LAUNCH_PHASES)[number];

/** A calendar day, `YYYY-MM-DD`, in Singapore time. A plain pattern, so the published JSON Schema checks exactly
 *  what zod checks. */
const Day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

/** The fact base for one project (an offering): what ads and the analyst may state about it. Claims and prices
 *  come only from here and from Marcus's source copy (PROPOSAL §4, compliance). Plain shapes only (no
 *  refinements or transforms), so the JSON Schema published for the dashboard accepts exactly what this accepts. */
export const PropertyFacts = z.object({
  /** The postal district, D01 to D28. */
  district: z.string().regex(/^D(0[1-9]|1\d|2[0-8])$/),
  /** Nearby MRT stations, with the walk in minutes when it's published. */
  mrt: z
    .array(
      z.object({
        station: z.string().min(1).max(80),
        walkMinutes: z.number().int().min(0).max(60).optional(),
      }),
    )
    .max(6)
    .optional(),
  /** The price band per square foot, in micros of SGD (S$2,150 psf = "2150000000"). Absent until prices are out. */
  psfBand: z.object({ minMicros: MicrosJson, maxMicros: MicrosJson }).optional(),
  /** The unit types on sale, e.g. "2-bedroom" or "3-bedroom + study". */
  unitMix: z
    .array(
      z.object({
        type: z.string().min(1).max(40),
        units: z.number().int().min(0).optional(),
        sizeSqftMin: z.number().int().min(1).optional(),
        sizeSqftMax: z.number().int().min(1).optional(),
      }),
    )
    .max(20)
    .optional(),
  developer: z.string().min(1).max(120),
  /** The expected TOP (Temporary Occupation Permit): a year, or a year and month. */
  top: z
    .string()
    .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/)
    .optional(),
  /** The day each launch phase starts, when known. */
  launchDates: z.object({
    teaser: Day.optional(),
    vvip: Day.optional(),
    booking: Day.optional(),
    clearing: Day.optional(),
  }),
});
export type PropertyFacts = z.infer<typeof PropertyFacts>;

/** Whole Singapore dollars as micros, in bigint (never a float for money). */
const money = (sgd: number): string => (BigInt(sgd) * 1_000_000n).toString();

export const manifest: PackManifest = {
  id: 'property-sg',
  version: '0.1.0',
  defaults: {
    outcomes: {
      stages: [
        { id: 'form_fill', label: 'Contact form filled', tier: 'success' },
        { id: 'qualified_viewing', label: 'Qualified viewing', tier: 'hard' },
        { id: 'booked', label: 'Unit booked', tier: 'hard' },
      ],
      primaryKpiStage: 'form_fill',
      // Like SnapPool, the agent's uploads are the one path to the platforms (no pixel or tag on the form). The
      // destination ids come from the property side of setup (T12 and the platforms' conversion setup): null until
      // then, so nothing is uploaded (D-076).
      feedback: [
        { stage: 'form_fill', platform: 'meta', destinationId: null, eventName: 'Lead' },
        { stage: 'form_fill', platform: 'google', destinationId: null },
      ],
    },
    copy: {
      tier: 'fragments',
      // The CEA's required elements (setup task T13). Placeholders on purpose: no ad copy contains them, so every
      // copy check fails until Marcus enters the real values in the settings.
      requiredStrings: ['[salesperson name]', '[CEA registration number]', '[agency name]', '[agency licence number]'],
      bannedPhrases: ['guaranteed returns', 'guaranteed rental', 'risk-free', 'cheapest'],
    },
  },
  phases: [
    {
      id: 'teaser',
      label: 'Teaser (before the preview)',
      intent:
        'The project is announced but not yet previewed. Build a list of interested buyers who register for the ' +
        'VVIP preview. Prices may not be out, so ads speak to location, developer and unit types. Spend modestly.',
      budgetPosture: 'conserve',
    },
    {
      id: 'vvip',
      label: 'VVIP preview',
      intent:
        'Registered buyers preview the show flat before the public launch. Turn interest into qualified viewings; ' +
        'spend may rise where the cost per form fill holds.',
      budgetPosture: 'push',
    },
    {
      id: 'booking',
      label: 'Launch and booking',
      intent:
        'Booking day and the weeks after it, when most units sell. Leads are worth most now: push for viewings ' +
        'and bookings within the ceilings.',
      budgetPosture: 'push',
    },
    {
      id: 'clearing',
      label: 'Clearing the remaining units',
      intent:
        'Most units are sold. Advertise the unit types still available, efficiently; smaller budgets and ' +
        'tighter targeting.',
      budgetPosture: 'steady',
    },
  ],
  facts: { schema: PropertyFacts, requiredForCopy: ['district', 'developer', 'unitMix'] },
  // High value, low volume, slow cycle (PROPOSAL §4): high spend and click floors (search clicks for property are
  // dear) and long day floors (a buyer takes days to weeks).
  thresholds: {
    zero_outcome_spend: { minImpressions: 2000, minClicks: 60, minSpendMicros: money(250), minDays: 14 },
    wasteful_search_term: { minImpressions: 100, minClicks: 10, minSpendMicros: money(40), minDays: 14 },
    no_delivery: { minImpressions: 0, minClicks: 0, minSpendMicros: '0', minDays: 3 },
    tracking_gap: { minImpressions: 1000, minClicks: 50, minSpendMicros: '0', minDays: 14 },
    cost_spike: { minImpressions: 2000, minClicks: 40, minSpendMicros: money(150), minDays: 14 },
    pacing_risk: { minImpressions: 0, minClicks: 0, minSpendMicros: '0', minDays: 3 },
    budget_limited_efficient: { minImpressions: 3000, minClicks: 80, minSpendMicros: money(400), minDays: 14 },
    overspend_inefficient: { minImpressions: 3000, minClicks: 80, minSpendMicros: money(400), minDays: 14 },
    copy_refresh: { minImpressions: 10000, minClicks: 60, minSpendMicros: money(300), minDays: 28 },
  },
  // Meta's Housing special ad category applies to property ads (confirmed by Marcus, D-062).
  platformPolicy: { meta: { specialAdCategories: ['HOUSING'] } },
  // A starting draft for Marcus to edit: trusted guidance, shown to the analyst as is.
  analystContext: [
    'Property SG advertises new-launch condominium projects in Singapore. Marcus is the licensed salesperson: ' +
      'every ad must carry the CEA required elements, and claims and prices come only from the project facts.',
    'The funnel: a contact-form fill (form_fill, the KPI), then a qualified viewing and a booking, which Marcus ' +
      'records by hand. Viewings and bookings are rare and come days to weeks after the click, so judge ads on ' +
      'form fills and read the later stages as a check on lead quality.',
    "Meta's Housing special ad category applies: no age, gender or postcode targeting, and a minimum radius. Do " +
      'not suggest targeting that the category forbids. Google Search comes first, Meta second.',
    'Each project moves through teaser, VVIP preview, booking and clearing; the phase decides how hard to push.',
  ].join('\n\n'),
};
