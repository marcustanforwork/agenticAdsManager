// The review views' arithmetic and wording (M10b): bigint money, the month projection, the KPI trend, attribution.
import type { EntityRef } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import {
  costPer,
  countOf,
  describeAction,
  editableFields,
  formatMoney,
  formatUsd,
  kpiTrend,
  percentOf,
  projectMonth,
  ratePct,
  summariseStages,
} from '../src/lib/review.ts';

describe('money', () => {
  it('formats SGD as the digest does, other currencies with their code, and USD exactly', () => {
    expect(formatMoney(1_234_567_890n, 'SGD')).toBe('S$1,234.57');
    expect(formatMoney(1_234_565_000n, 'USD')).toBe('USD 1,234.57');
    expect(formatMoney(5_000n, 'MYR')).toBe('MYR 0.01');
    expect(formatMoney(-12_500_000n, 'MYR')).toBe('MYR -12.50');
    expect(formatUsd(23_400n)).toBe('US$0.0234');
    expect(formatUsd(2_000_000n)).toBe('US$2.00');
  });

  it('divides in bigint: percentages round down, cost per rounds half up, rates to one place', () => {
    expect(percentOf(1n, 3n)).toBe(33);
    expect(percentOf(5n, 0n)).toBeNull();
    expect(costPer(10_000_001n, 2)).toBe(5_000_001n);
    expect(costPer(10n, 0)).toBeNull();
    expect(ratePct(1, 3)).toBe(33.3);
    expect(ratePct(0, 0)).toBeNull();
  });

  it('counts with a word or a stage id, never a stage label', () => {
    expect(countOf(1, 'signup')).toBe('1 signup');
    expect(countOf(3, 'pool_request')).toBe('3 pool requests');
    expect(countOf(2, 'Clicks')).toBe('2 clicks');
    // A stage named for a state becomes a noun: the KPI switched to `paid` reads "3 paid outcomes", not "3 paids".
    expect(countOf(3, 'paid')).toBe('3 paid outcomes');
    expect(countOf(1, 'booked')).toBe('1 booked outcome');
    expect(countOf(4, 'qualified_viewing')).toBe('4 qualified viewings');
    expect(countOf(2, 'enquiry')).toBe('2 enquiries');
    expect(countOf(2, 'search')).toBe('2 searches');
  });
});

describe('projectMonth', () => {
  it('carries the month-to-date average to the last day of the month', () => {
    expect(projectMonth(150_000_000n, '2026-10-15')).toEqual({
      month: '2026-10',
      daysElapsed: 15,
      daysInMonth: 31,
      projectedMicros: 310_000_000n,
    });
    expect(projectMonth(28_000_000n, '2028-02-28').daysInMonth).toBe(29); // a leap year
    expect(projectMonth(30_000_000n, '2026-09-30').projectedMicros).toBe(30_000_000n); // the month is over
    expect(projectMonth(10n, '2026-10-03').projectedMicros).toBe(103n); // rounded down
  });
});

describe('kpiTrend', () => {
  it('buckets spend and KPI outcomes into weeks ending on the last day, and days, ignoring other stages', () => {
    const trend = kpiTrend({
      spend: [
        { day: '2026-09-17', spendMicros: 99n }, // before the window
        { day: '2026-09-18', spendMicros: 7_000_000n },
        { day: '2026-10-15', spendMicros: 3_000_000n },
      ],
      outcomes: [
        { day: '2026-10-15', stage: 'signup', outcomes: 2 },
        { day: '2026-10-15', stage: 'paid', outcomes: 5 },
      ],
      kpiStage: 'signup',
      lastDay: '2026-10-15',
      weeks: 4,
    });
    expect(trend.days).toHaveLength(28);
    expect(trend.days[0]).toEqual({
      from: '2026-09-18',
      to: '2026-09-18',
      spendMicros: 7_000_000n,
      kpi: 0,
      costMicros: null,
    });
    expect(trend.weeks.map((w) => [w.from, w.to, w.spendMicros, w.kpi, w.costMicros])).toEqual([
      ['2026-09-18', '2026-09-24', 7_000_000n, 0, null],
      ['2026-09-25', '2026-10-01', 0n, 0, null],
      ['2026-10-02', '2026-10-08', 0n, 0, null],
      ['2026-10-09', '2026-10-15', 3_000_000n, 2, 1_500_000n],
    ]);
  });
});

describe('summariseStages', () => {
  it('keeps the settings order, adds unknown stages last, and counts only credited methods as attributed', () => {
    const out = summariseStages(
      [
        { stage: 'signup', method: 'utm', outcomes: 1, test: 0 },
        { stage: 'signup', method: 'none', outcomes: 1, test: 0 },
        { stage: 'signup', method: null, outcomes: 2, test: 3 },
        { stage: 'trial', method: 'platform_ids', outcomes: 1, test: 0 },
      ],
      [
        { id: 'signup', label: 'Signup' },
        { id: 'paid', label: 'Paid' },
      ],
      'signup',
    );
    expect(out.map((s) => [s.stage, s.label, s.kpi, s.outcomes, s.test, s.attributed, s.ratePct])).toEqual([
      ['signup', 'Signup', true, 4, 3, 1, 25],
      ['paid', 'Paid', false, 0, 0, 0, null],
      ['trial', null, false, 1, 0, 1, 100],
    ]);
    expect(out[0]!.byMethod).toEqual({ platform_ids: 0, gclid_lookup: 0, utm: 1, none: 1, pending: 2 });
  });
});

describe('describeAction', () => {
  const ref: EntityRef = { platform: 'meta', accountId: 'act_1', type: 'ad_group', externalId: '9' };
  const synced = () => ({ name: '  Pool\n set ', status: 'paused' });
  it('says what each action does, with the synced name (spaces collapsed) or none', () => {
    expect(describeAction({ action: 'pause_entity', target: ref }, 'SGD', synced)).toEqual({
      headline: 'Pause ad group “Pool set” (meta:act_1:ad_group:9)',
      change: 'status active → paused',
    });
    expect(describeAction({ action: 'resume_entity', target: ref }, 'SGD', () => null).headline).toBe(
      'Turn back on ad group (meta:act_1:ad_group:9)',
    );
    const budget = {
      action: 'adjust_budget' as const,
      target: ref,
      newDailyBudgetMicros: '45000000',
      netIncrease: true,
    };
    expect(describeAction(budget, 'SGD', () => null).change).toBe('? → S$45.00 a day');
    expect(
      describeAction(budget, 'SGD', () => null, {
        undo: { ...budget, newDailyBudgetMicros: '30000000', netIncrease: false },
      }).change,
    ).toBe('S$30.00 → S$45.00 a day');
    expect(describeAction({ action: 'mark_abandoned', target: ref }, 'SGD', () => null).headline).toBe(
      'mark abandoned on ad group (meta:act_1:ad_group:9)',
    );
  });

  it("shows a pause still to decide from the entity's status now, as the Telegram card does", () => {
    expect(describeAction({ action: 'pause_entity', target: ref }, 'SGD', synced, { live: true }).change).toBe(
      'status paused → paused',
    );
    expect(describeAction({ action: 'pause_entity', target: ref }, 'SGD', () => null, { live: true }).change).toBe(
      'status active → paused',
    );
  });

  it('offers edits only for a budget or a negative keyword', () => {
    expect(editableFields({ action: 'pause_entity', target: ref })).toEqual([]);
    expect(editableFields({ action: 'add_negative_keyword', target: ref, text: 'x', matchType: 'EXACT' })).toEqual([
      'negative_text',
      'match_type',
    ]);
  });
});
