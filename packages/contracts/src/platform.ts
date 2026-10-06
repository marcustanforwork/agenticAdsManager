import { z } from 'zod';
import { IsoDate, IsoDateTime } from './hash.ts';
import { MicrosJson } from './money.ts';

export const Platform = z.enum(['google', 'meta']);
export type Platform = z.infer<typeof Platform>;

export const EntityType = z.enum(['campaign', 'ad_group', 'ad', 'keyword', 'budget']); // Meta "ad set" = ad_group
export type EntityType = z.infer<typeof EntityType>;

/** Ad account id formats: Meta `act_<digits>`, Google a 10-digit customer id (no dashes). */
export const ACCOUNT_ID_PATTERNS: Readonly<Record<Platform, RegExp>> = { meta: /^act_\d+$/, google: /^\d{10}$/ };
export const ACCOUNT_ID_HINTS: Readonly<Record<Platform, string>> = {
  meta: 'a Meta ad account id looks like act_<digits>',
  google: 'a Google customer id is 10 digits, without dashes',
};

export const EntityRef = z.object({
  platform: Platform,
  accountId: z.string(), // Google customer id (digits) / Meta 'act_…'
  type: EntityType,
  externalId: z.string(), // Google keyword: '<adGroupId>~<criterionId>'
});
export type EntityRef = z.infer<typeof EntityRef>;

/** Normalised status (the platform's own value is stored alongside as raw_status; table in BLUEPRINT §5.7). */
export const EntityStatus = z.enum(['active', 'paused', 'removed', 'pending', 'limited', 'unknown']);
export type EntityStatus = z.infer<typeof EntityStatus>;

// ---------------------------------------------------------------------------------------------
// Read-side row shapes used by PlatformReadClient (BLUEPRINT §3.6 names them without spelling them
// out). These are the minimum M00 needs to type the interface; M02/M03 may ADD fields.
// ---------------------------------------------------------------------------------------------

/** An inclusive range of metrics days, in the ad account's timezone. */
export const DateRange = z.object({ from: IsoDate, to: IsoDate });
export type DateRange = z.infer<typeof DateRange>;

export const AdEntityRecord = z.object({
  ref: EntityRef,
  parent: EntityRef.nullable(),
  name: z.string(),
  status: EntityStatus,
  rawStatus: z.string(),
  dailyBudgetMicros: MicrosJson.nullable(),
  budgetShared: z.boolean().nullable(), // Google shared budgets are never changed by this system
  /** The tracked, non-status fields the sync stores as `ad_entities.attributes` (objective, bid strategy type,
   *  special ad categories, attribution setting…). Added in M02. */
  attributes: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()),
});
export type AdEntityRecord = z.infer<typeof AdEntityRecord>;

export const MetricRow = z.object({
  ref: EntityRef,
  day: IsoDate,
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  spendMicros: MicrosJson,
  platformConversions: z.number().min(0), // the platform's own (possibly fractional) count; never a decision number
  /** The platform's own value for those conversions (`metrics_daily.platform_conversion_value_micros`). Added in M02. */
  platformConversionValueMicros: MicrosJson.optional(),
  /** The attribution setting the platform used for this row, e.g. Meta `7d_click_1d_view` or `mixed`. Added in M02. */
  attributionSetting: z.string().nullable().optional(),
});
export type MetricRow = z.infer<typeof MetricRow>;

/** Google search terms. The text is untrusted platform data (invariant 5). */
export const SearchTermRow = z.object({
  adGroup: EntityRef,
  day: IsoDate,
  searchTerm: z.string(),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  spendMicros: MicrosJson,
});
export type SearchTermRow = z.infer<typeof SearchTermRow>;

/** Google click_view: one row per click id, one day per call. */
export const ClickRow = z.object({
  gclid: z.string(),
  day: IsoDate,
  campaignId: z.string(),
  adGroupId: z.string().nullable(),
});
export type ClickRow = z.infer<typeof ClickRow>;

/** Inputs to the trust checks (BLUEPRINT §5.8) for one account and range. */
export const TrustSignalRow = z.object({
  clicks: z.number().int().min(0),
  platformConversions: z.number().min(0),
  spendMicros: MicrosJson,
  spendCapMicros: MicrosJson.nullable(), // Meta account spending limit; null = unset (D-063)
  amountSpentMicros: MicrosJson.nullable(), // spent against that limit
  /** Meta: events the conversion dataset received in the last 7 days; null = no dataset configured. Added in M02. */
  datasetEventsReceived: z.number().int().min(0).nullable().optional(),
  /** Meta: when the dataset last received an event; null = never or not configured. Added in M02. */
  datasetLastEventAt: IsoDateTime.nullable().optional(),
  /** Google: whether auto-tagging (gclid on clicks) is on. Added in M03. */
  autoTaggingEnabled: z.boolean().nullable().optional(),
  /** Google: enabled conversion actions in the account. Added in M03. */
  conversionActionsEnabled: z.number().int().min(0).nullable().optional(),
  /** Google: the KPI stage's conversion action ids that are missing or not enabled. Added in M03. */
  conversionActionsMissing: z.array(z.string()).optional(),
});
export type TrustSignalRow = z.infer<typeof TrustSignalRow>;

/** The trust signals the last successful sync read for an account, with the days they cover (the account's local
 *  days) and when they were read: `accounts.trust_signals`. The trust stage reads them instead of calling the
 *  platform again, so a resumed cycle needs no API call (M04). */
export const AccountTrustSignals = TrustSignalRow.extend({ range: DateRange, readAt: IsoDateTime });
export type AccountTrustSignals = z.infer<typeof AccountTrustSignals>;
