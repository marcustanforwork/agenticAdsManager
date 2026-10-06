// Google status → normalised status (BLUEPRINT §5.7; keep that table in sync with this one). `status` is what
// the advertiser set (ENABLED / PAUSED / REMOVED, stored as raw_status); for an enabled entity, `primary_status`
// says whether it actually serves, including its parents (an enabled ad group in a paused campaign is PAUSED),
// like Meta's `effective_status`.
import type { EntityStatus } from '@ads/contracts';

export const GOOGLE_STATUS_TABLE: Readonly<Record<string, EntityStatus>> = {
  ENABLED: 'active',
  PAUSED: 'paused',
  REMOVED: 'removed',
};

/** Campaign, ad group and keyword primary statuses (their enums share these names). */
export const GOOGLE_PRIMARY_STATUS_TABLE: Readonly<Record<string, EntityStatus>> = {
  ELIGIBLE: 'active',
  LEARNING: 'active', // serving; automated bidding is adjusting
  PAUSED: 'paused',
  REMOVED: 'removed',
  PENDING: 'pending', // may serve in the future (e.g. a start date ahead)
  LIMITED: 'limited',
  NOT_ELIGIBLE: 'limited',
  MISCONFIGURED: 'limited',
  ENDED: 'limited',
};

const lookup = (table: Readonly<Record<string, EntityStatus>>, key: string): EntityStatus =>
  Object.hasOwn(table, key) ? (table[key] ?? 'unknown') : 'unknown';

/** Anything not in the tables (a value Google adds later) is `unknown`, never guessed. An enabled entity with no
 *  primary status (budgets have none) is `active`. */
export function normaliseGoogleStatus(status: string, primaryStatus?: string): EntityStatus {
  const base = lookup(GOOGLE_STATUS_TABLE, status);
  if (base !== 'active' || primaryStatus === undefined) return base;
  return lookup(GOOGLE_PRIMARY_STATUS_TABLE, primaryStatus);
}
