// Quota bookkeeping shared by everything that calls Google (the worker's sync now, the gateway later, D-066).
import { EXPLORER_DAILY_OPERATIONS } from './version.ts';

/** The day `api_usage` counts Google operations under: the UTC date. Google's own window may be a sliding
 *  24 hours (UNVERIFIED, GOTCHAS "Google Ads API operations"), so the soft cap is an approximation and Google's
 *  limit still applies on top. */
export const quotaDay = (now: Date): string => now.toISOString().slice(0, 10);

/** The sync's soft cap: operations a day across every Google account, since the Explorer quota belongs to the
 *  Cloud project (D-072). It leaves the rest of the 2,880 for the gateway's writes and uploads. */
export const GOOGLE_SYNC_SOFT_CAP = 2_000;

if (GOOGLE_SYNC_SOFT_CAP >= EXPLORER_DAILY_OPERATIONS) throw new Error('the soft cap must sit below the quota');
