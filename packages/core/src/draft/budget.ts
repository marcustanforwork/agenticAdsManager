// Budget amounts for a proposal (BLUEPRINT §5.11): new = current × (1 + clamp(pct, −max, +max)/100), rounded to
// the platform's unit towards the current budget, so rounding never takes the change past the guard. A change
// below the minimum meaningful delta makes no proposal. All in bigint micros (invariant 6): the AI's percentage
// is a hint, turned into whole basis points before it touches money.
import type { GuardConfig, Platform } from '@ads/contracts';

/** The smallest budget step per platform: Google bills in units of 10,000 micros; Meta in the currency's minor
 *  unit, 10,000 micros for SGD and the other two-decimal currencies. */
export const BUDGET_UNIT_MICROS: Readonly<Record<Platform, bigint>> = { google: 10_000n, meta: 10_000n };

export type BudgetChange =
  | { ok: true; newDailyBudgetMicros: bigint; deltaMicros: bigint; appliedPct: number; netIncrease: boolean }
  | { ok: false; reason: string };

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** Rounds `value` to a multiple of `unit`, towards `toward` (never past the unrounded value). */
function roundToward(value: bigint, unit: bigint, toward: bigint): bigint {
  const down = value >= 0n ? (value / unit) * unit : -(((-value + unit - 1n) / unit) * unit);
  if (down === value) return value;
  const up = down + unit;
  return value > toward ? down : up;
}

export function budgetChange(input: {
  currentMicros: bigint;
  /** The analyst's hint, e.g. -20 for a 20% cut. */
  pct: number;
  guards: Pick<GuardConfig, 'maxBudgetChangePct' | 'minBudgetDeltaMicros' | 'minBudgetDeltaPct'>;
  platform: Platform;
}): BudgetChange {
  const { currentMicros, guards } = input;
  if (currentMicros <= 0n) return { ok: false, reason: 'the entity has no daily budget to change' };
  if (!Number.isFinite(input.pct) || input.pct === 0) return { ok: false, reason: 'no change asked for' };
  const max = guards.maxBudgetChangePct;
  const clamped = Math.max(-max, Math.min(max, input.pct));
  const basisPoints = BigInt(Math.trunc(clamped * 100)); // truncated towards 0: never past the clamp
  const unit = BUDGET_UNIT_MICROS[input.platform];
  const raw = (currentMicros * (10_000n + basisPoints)) / 10_000n;
  const next = roundToward(raw, unit, currentMicros);
  const delta = next - currentMicros;
  const minByPct = (currentMicros * BigInt(Math.ceil(guards.minBudgetDeltaPct * 100))) / 10_000n;
  const minDelta = BigInt(guards.minBudgetDeltaMicros) > minByPct ? BigInt(guards.minBudgetDeltaMicros) : minByPct;
  if (delta === 0n || abs(delta) < minDelta) {
    return { ok: false, reason: `the change (${delta} micros) is below the minimum meaningful change (${minDelta})` };
  }
  if (next <= 0n) return { ok: false, reason: 'the new budget would not be positive' };
  return {
    ok: true,
    newDailyBudgetMicros: next,
    deltaMicros: delta,
    appliedPct: Number(basisPoints) / 100,
    netIncrease: delta > 0n,
  };
}
