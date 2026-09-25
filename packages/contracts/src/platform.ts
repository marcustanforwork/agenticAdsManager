import { z } from 'zod';
import { IsoDate } from './hash.ts';
import { MicrosJson } from './money.ts';

export const Platform = z.enum(['google', 'meta']);
export type Platform = z.infer<typeof Platform>;

export const EntityType = z.enum(['campaign', 'ad_group', 'ad', 'keyword', 'budget']); // Meta "ad set" = ad_group
export type EntityType = z.infer<typeof EntityType>;

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
});
export type TrustSignalRow = z.infer<typeof TrustSignalRow>;
