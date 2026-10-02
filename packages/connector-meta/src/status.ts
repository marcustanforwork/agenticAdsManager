// Meta `effective_status` → normalised status (BLUEPRINT §5.7; keep that table in sync with this one).
// `effective_status` already accounts for the parents: an active ad in a paused campaign is CAMPAIGN_PAUSED.
import type { EntityStatus } from '@ads/contracts';

export const META_STATUS_TABLE: Readonly<Record<string, EntityStatus>> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CAMPAIGN_PAUSED: 'paused',
  ADSET_PAUSED: 'paused',
  DELETED: 'removed',
  ARCHIVED: 'removed',
  IN_PROCESS: 'pending',
  PENDING_REVIEW: 'pending',
  PREAPPROVED: 'pending',
  PENDING_BILLING_INFO: 'pending',
  WITH_ISSUES: 'limited',
  DISAPPROVED: 'limited',
};

/** Anything not in the table (a value Meta adds later) is `unknown`, never guessed. */
export const normaliseMetaStatus = (effectiveStatus: string): EntityStatus =>
  Object.hasOwn(META_STATUS_TABLE, effectiveStatus) ? (META_STATUS_TABLE[effectiveStatus] ?? 'unknown') : 'unknown';
