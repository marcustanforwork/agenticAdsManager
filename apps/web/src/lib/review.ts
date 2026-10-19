// The review views' arithmetic and wording (M10b): pure functions over what the loaders read. Every number comes
// from SQL; these only add up, divide (in bigint micros, invariant 6) and format. Display only: nothing here feeds
// back into a decision.
import { type EntityRef, type WriteOp, costPer, formatMoney, minusDays, targetRefOf } from '@ads/contracts';
import type { DayStageCount, DaySpend, StageAttribution } from '@ads/db';

// ── Numbers ───────────────────────────────────────────────────────────────────────────────────
// Money, counts and times come from `@ads/contracts` (F2), shared with the digest, the brief and the Telegram cards.

/** A rate to one decimal place, e.g. 66.7; null without a whole. */
export const ratePct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part * 1000) / whole) / 10;

// ── Spend ─────────────────────────────────────────────────────────────────────────────────────

export interface MonthProjection {
  /** The month of `day`, `YYYY-MM`. */
  month: string;
  /** Days of the month through `day`. */
  daysElapsed: number;
  daysInMonth: number;
  /** Spend through `day`, carried on at the month's average so far to its last day (rounded down). */
  projectedMicros: bigint;
}

/** A straight-line projection: the month-to-date spend over the days so far, times the days in the month. */
export function projectMonth(monthMicros: bigint, day: string): MonthProjection {
  const month = day.slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysElapsed = Number(day.slice(8, 10));
  return {
    month,
    daysElapsed,
    daysInMonth,
    projectedMicros: (monthMicros * BigInt(daysInMonth)) / BigInt(daysElapsed),
  };
}

// ── The KPI trend ─────────────────────────────────────────────────────────────────────────────

export interface TrendRow {
  from: string;
  to: string;
  spendMicros: bigint;
  /** Outcomes at the KPI stage (test traffic apart). */
  kpi: number;
  costMicros: bigint | null;
}

/** The KPI trend over the `weeks` × 7 days ending `lastDay`: one row per day, and one per week (oldest first),
 *  each week the sum of its seven days. */
export function kpiTrend(input: {
  spend: readonly DaySpend[];
  outcomes: readonly DayStageCount[];
  kpiStage: string;
  lastDay: string;
  weeks: number;
}): { weeks: TrendRow[]; days: TrendRow[] } {
  const spend = new Map(input.spend.map((s) => [s.day, s.spendMicros]));
  const kpi = new Map<string, number>();
  for (const o of input.outcomes) if (o.stage === input.kpiStage) kpi.set(o.day, (kpi.get(o.day) ?? 0) + o.outcomes);
  const total = (from: string, to: string, spendMicros: bigint, count: number): TrendRow => ({
    from,
    to,
    spendMicros,
    kpi: count,
    costMicros: costPer(spendMicros, count),
  });
  const first = minusDays(input.lastDay, input.weeks * 7 - 1);
  const days = Array.from({ length: input.weeks * 7 }, (_, i) => {
    const d = minusDays(first, -i);
    return total(d, d, spend.get(d) ?? 0n, kpi.get(d) ?? 0);
  });
  const weeks = Array.from({ length: input.weeks }, (_, w) => {
    const week = days.slice(w * 7, w * 7 + 7);
    return total(
      week[0]!.from,
      week[6]!.to,
      week.reduce((n, d) => n + d.spendMicros, 0n),
      week.reduce((n, d) => n + d.kpi, 0),
    );
  });
  return { weeks, days };
}

// ── Outcomes and attribution ──────────────────────────────────────────────────────────────────

export const CREDITED_METHODS = ['platform_ids', 'gclid_lookup', 'utm'] as const;

export interface StageSummary {
  stage: string;
  /** The pack's label; null for a stage the settings no longer list. */
  label: string | null;
  kpi: boolean;
  outcomes: number;
  test: number;
  /** Credited to a campaign (platform ids, a gclid look-up or UTM tags). */
  attributed: number;
  ratePct: number | null;
  byMethod: Record<(typeof CREDITED_METHODS)[number] | 'none' | 'pending', number>;
}

/** Outcomes by stage, in the settings' stage order (unknown stages last), with the attribution rate of each. The
 *  rate is as `ads outcomes` reports it: credited over all real outcomes; `none` (looked, nothing found) and
 *  `pending` (not looked at yet) both count against it. */
export function summariseStages(
  rows: readonly StageAttribution[],
  stages: readonly { id: string; label: string }[],
  kpiStage: string,
): StageSummary[] {
  const empty = (stage: string, label: string | null): StageSummary => ({
    stage,
    label,
    kpi: stage === kpiStage,
    outcomes: 0,
    test: 0,
    attributed: 0,
    ratePct: null,
    byMethod: { platform_ids: 0, gclid_lookup: 0, utm: 0, none: 0, pending: 0 },
  });
  const out = new Map(stages.map((s) => [s.id, empty(s.id, s.label)]));
  for (const r of rows) {
    let s = out.get(r.stage);
    if (s === undefined) out.set(r.stage, (s = empty(r.stage, null)));
    s.outcomes += r.outcomes;
    s.test += r.test;
    s.byMethod[r.method ?? 'pending'] += r.outcomes;
  }
  for (const s of out.values()) {
    s.attributed = CREDITED_METHODS.reduce((n, m) => n + s.byMethod[m], 0);
    s.ratePct = ratePct(s.attributed, s.outcomes);
  }
  return [...out.values()];
}

// ── Proposals and changes in words ────────────────────────────────────────────────────────────

/** `campaign “name” (google:123:campaign:456)`. The name is platform text: shown as data (React escapes it). */
export function entityText(ref: EntityRef, name: string | null): string {
  const words = ref.type.replaceAll('_', ' ');
  const shown = name === null ? '' : ` “${name.replaceAll(/\s+/g, ' ').trim()}”`;
  return `${words}${shown} (${ref.platform}:${ref.accountId}:${ref.type}:${ref.externalId})`;
}

/** A synced entity, as the views know it. */
export type EntityLookup = (ref: EntityRef) => { name: string; status: string } | null;

/** A write action in words: what it does, and before → after. `entityOf` gives a synced entity's name and status;
 *  `live` says the action is still to be decided, so a pause's "before" is the entity's status now (as the Telegram
 *  card shows it). A past change's before is what it was then, not now. */
export function describeAction(
  op: WriteOp,
  currency: string,
  entityOf: EntityLookup,
  options: { undo?: WriteOp | null; live?: boolean } = {},
): { headline: string; change: string | null } {
  const target = (ref: EntityRef) => entityText(ref, entityOf(ref)?.name ?? null);
  const money = (micros: string) => formatMoney(BigInt(micros), currency);
  const undo = options.undo ?? null;
  switch (op.action) {
    case 'pause_entity': {
      const before = options.live === true ? (entityOf(op.target)?.status ?? 'active') : 'active';
      return { headline: `Pause ${target(op.target)}`, change: `status ${before} → paused` };
    }
    case 'resume_entity':
      return { headline: `Turn back on ${target(op.target)}`, change: 'status paused → active' };
    case 'add_negative_keyword':
      return {
        headline: `Add a negative keyword to ${target(op.target)}`,
        change: `+ “${op.text}” (${op.matchType.toLowerCase()} match) blocked`,
      };
    case 'remove_negative_keyword':
      return { headline: `Remove a negative keyword from ${target(op.target)}`, change: null };
    case 'adjust_budget': {
      const before = undo?.action === 'adjust_budget' ? money(undo.newDailyBudgetMicros) : '?';
      return {
        headline: `${op.netIncrease ? 'Raise' : 'Cut'} the daily budget of ${target(op.target)}`,
        change: `${before} → ${money(op.newDailyBudgetMicros)} a day`,
      };
    }
    default: {
      const ref = targetRefOf(op);
      return { headline: `${op.action.replaceAll('_', ' ')}${ref === null ? '' : ` on ${target(ref)}`}`, change: null };
    }
  }
}

/** Which edits a proposal's action takes (the edit_approve grammar): budget, or a negative's words and match. */
export function editableFields(op: WriteOp): ('budget' | 'negative_text' | 'match_type')[] {
  if (op.action === 'adjust_budget') return ['budget'];
  if (op.action === 'add_negative_keyword') return ['negative_text', 'match_type'];
  return [];
}
