// The agree rate (PROPOSAL §12, the Phase 1 gate): over the agent proposals of a window, agree = approved (an
// edit-and-approve included), disagree = rejected. Expired undecided proposals don't count either way, but when more
// than 20% of the proposals that are no longer pending expired undecided, the gate fails: suggestions aren't being
// reviewed. Marcus's own (operator) proposals and conversion uploads (policy) are left out.
import { type DbOrTx, agreeRateCounts } from '@ads/db';

/** The Phase 1 gate's window: 3 weeks. */
export const AGREE_RATE_WINDOW_DAYS = 21;
/** More expired-undecided proposals than this share fails the gate. */
export const MAX_EXPIRED_PCT = 20;

export interface AgreeRate {
  windowDays: number;
  /** Agent proposals created in the window. */
  proposals: number;
  approved: number;
  rejected: number;
  /** Expired before Marcus decided. */
  expired: number;
  /** Still waiting for a decision. */
  pending: number;
  /** approved / (approved + rejected), as a whole percent rounded down; null before any decision. */
  agreePct: number | null;
  /** expired / (approved + rejected + expired), rounded up; null when none is settled. */
  expiredPct: number | null;
  /** True when too many expired undecided (the gate fails on that alone). */
  tooManyExpired: boolean;
}

export function agreeRateOf(counts: {
  total: number;
  approved: number;
  rejected: number;
  expired: number;
  pending: number;
}): AgreeRate {
  const decided = counts.approved + counts.rejected;
  const settled = decided + counts.expired;
  const expiredPct = settled === 0 ? null : Math.ceil((counts.expired * 100) / settled);
  return {
    windowDays: AGREE_RATE_WINDOW_DAYS,
    proposals: counts.total,
    approved: counts.approved,
    rejected: counts.rejected,
    expired: counts.expired,
    pending: counts.pending,
    agreePct: decided === 0 ? null : Math.floor((counts.approved * 100) / decided),
    expiredPct,
    tooManyExpired: expiredPct !== null && expiredPct > MAX_EXPIRED_PCT,
  };
}

/** The agree rate over the `AGREE_RATE_WINDOW_DAYS` days before `now`. */
export async function agreeRate(db: DbOrTx, input: { productId: string; now: Date }): Promise<AgreeRate> {
  const from = new Date(input.now.getTime() - AGREE_RATE_WINDOW_DAYS * 86_400_000);
  return agreeRateOf(await agreeRateCounts(db, { productId: input.productId, from, to: input.now }));
}
