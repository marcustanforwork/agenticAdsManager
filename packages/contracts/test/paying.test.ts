import { describe, expect, it } from 'vitest';
import { type OutcomeStage, moneyStages, payingSummary } from '../src/index.ts';

const stages: OutcomeStage[] = [
  { id: 'signup', label: 'Signup', tier: 'success' },
  { id: 'paid', label: 'Paid (first order)', tier: 'hard', role: 'paying' },
  { id: 'refunded', label: 'Refunded', tier: 'hard', role: 'refund' },
];
const S = (dollars: number): bigint => BigInt(dollars) * 1_000_000n;

describe('paying customers, revenue and cost per paying customer (F4)', () => {
  it('counts the paying stage, sums its values per currency, and divides the spend by the customers', () => {
    const summary = payingSummary(
      { stages },
      [
        { stage: 'signup', currency: null, outcomes: 40, valueMicros: 0n },
        { stage: 'paid', currency: 'SGD', outcomes: 2, valueMicros: S(78) },
        { stage: 'paid', currency: 'USD', outcomes: 1, valueMicros: S(20) },
        { stage: 'paid', currency: null, outcomes: 1, valueMicros: 0n }, // no value read: counted, no revenue
        { stage: 'refunded', currency: 'SGD', outcomes: 1, valueMicros: S(29) },
      ],
      S(200),
    );
    expect(summary).toEqual({
      stage: 'paid',
      label: 'Paid (first order)',
      customers: 4,
      revenue: [
        { currency: 'SGD', micros: S(78) },
        { currency: 'USD', micros: S(20) },
      ],
      costPerCustomerMicros: S(50),
      refunds: { stage: 'refunded', count: 1, amounts: [{ currency: 'SGD', micros: S(29) }] },
    });
    expect(moneyStages({ stages })).toEqual(['paid', 'refunded']);
  });

  it('has no cost per customer without one, no refunds without a refund stage, and nothing without a paying stage', () => {
    expect(payingSummary({ stages: stages.slice(0, 2) }, [], S(100))).toEqual({
      stage: 'paid',
      label: 'Paid (first order)',
      customers: 0,
      revenue: [],
      costPerCustomerMicros: null,
      refunds: null,
    });
    expect(payingSummary({ stages: stages.slice(0, 1) }, [], S(100))).toBeNull();
    expect(moneyStages({ stages: stages.slice(0, 1) })).toEqual([]);
  });
});
