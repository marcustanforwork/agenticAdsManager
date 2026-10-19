// The review views' arithmetic and wording (M10b): pure functions over what the loaders read. Every number comes
// from SQL; these only add up, divide (in bigint micros, invariant 6) and format. Display only: nothing here feeds
// back into a decision.
import { type EntityRef, type WriteOp, daysFrom, formatSgd, minusDays, targetRefOf } from '@ads/contracts';
import type { DayStageCount, DaySpend, StageAttribution } from '@ads/db';

// ── Numbers ───────────────────────────────────────────────────────────────────────────────────

/** Micros as an exact decimal with at least `minDecimals` places ("12.50", "0.0123"). */
function microsDecimal(micros: bigint, minDecimals: number): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  let frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  frac = frac.padEnd(minDecimals, '0');
  const whole = (abs / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

/** "S$1,234.57" for SGD (as the digest shows it); "<CUR> 1,234.57" for anything else. */
export function formatMoney(micros: bigint, currency: string): string {
  if (currency === 'SGD') return formatSgd(micros);
  return `${currency} ${microsDecimal(((micros >= 0n ? micros + 5_000n : micros - 5_000n) / 10_000n) * 10_000n, 2)}`;
}

/** The AI cost, in US dollars (the providers bill in USD, D-078): exact, since a cycle costs fractions of a cent. */
export const formatUsd = (micros: bigint): string => `US$${microsDecimal(micros, 2)}`;

/** `part` as a whole percentage of `whole`, rounded down; null when `whole` isn't positive. */
export function percentOf(part: bigint, whole: bigint): number | null {
  return whole > 0n ? Number((part * 100n) / whole) : null;
}

/** Cost per outcome in micros, rounded half up; null without outcomes. */
export function costPer(spendMicros: bigint, outcomes: number): bigint | null {
  if (outcomes <= 0) return null;
  const n = BigInt(outcomes);
  return (spendMicros * 2n + n) / (2n * n);
}

/** A rate to one decimal place, e.g. 66.7; null without a whole. */
export const ratePct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part * 1000) / whole) / 10;

/** "1 signup" / "3 signups" from a stage label. Labels are written by Marcus (trusted). */
export function countOf(n: number, label: string): string {
  const word = label.toLowerCase();
  return `${n} ${n === 1 || word.endsWith('s') ? word : `${word}s`}`;
}

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

/** The KPI trend over the `weeks` × 7 days ending `lastDay`: one row per week (oldest first), and one per day. */
export function kpiTrend(input: {
  spend: readonly DaySpend[];
  outcomes: readonly DayStageCount[];
  kpiStage: string;
  lastDay: string;
  weeks?: number;
}): { weeks: TrendRow[]; days: TrendRow[] } {
  const weeks = input.weeks ?? 4;
  const spend = new Map(input.spend.map((s) => [s.day, s.spendMicros]));
  const kpi = new Map<string, number>();
  for (const o of input.outcomes) if (o.stage === input.kpiStage) kpi.set(o.day, (kpi.get(o.day) ?? 0) + o.outcomes);
  const row = (from: string, to: string): TrendRow => {
    let spendMicros = 0n;
    let count = 0;
    for (let d = from; daysFrom(d, to) >= 0; d = minusDays(d, -1)) {
      spendMicros += spend.get(d) ?? 0n;
      count += kpi.get(d) ?? 0;
    }
    return { from, to, spendMicros, kpi: count, costMicros: costPer(spendMicros, count) };
  };
  const first = minusDays(input.lastDay, weeks * 7 - 1);
  const days: TrendRow[] = [];
  for (let d = first; daysFrom(d, input.lastDay) >= 0; d = minusDays(d, -1)) days.push(row(d, d));
  const weekRows: TrendRow[] = [];
  for (let w = 0; w < weeks; w++) {
    const from = minusDays(first, -7 * w);
    weekRows.push(row(from, minusDays(from, -6)));
  }
  return { weeks: weekRows, days };
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

/** A write action in words: what it does, and before → after. `nameOf` gives a synced entity's name. */
export function describeAction(
  op: WriteOp,
  currency: string,
  nameOf: (ref: EntityRef) => string | null,
  undo: WriteOp | null = null,
): { headline: string; change: string | null } {
  const target = (ref: EntityRef) => entityText(ref, nameOf(ref));
  const money = (micros: string) => formatMoney(BigInt(micros), currency);
  switch (op.action) {
    case 'pause_entity':
      return { headline: `Pause ${target(op.target)}`, change: 'status active → paused' };
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

/** `2026-10-21 10:00` in the product's timezone. */
export function localTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
