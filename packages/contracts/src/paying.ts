// Paying customers, revenue and cost per paying customer (F4, D-096): shown beside the KPI by the weekly brief and
// the dashboard's Overview, for a product with a stage marked `paying`. Pure arithmetic on totals that come from
// SQL (invariant 4); no product names. Money stays in micros, per currency: a payment is in its own currency, which
// may differ from the ad accounts', so revenue is never added across currencies.
import { costPer } from './format.ts';
import { type OutcomeStage, stageWithRole } from './settings.ts';

/** Real outcomes (test traffic apart) of one stage in one currency: how many, and their summed value. A stage's
 *  outcomes without a value have a null currency. */
export interface StageValueTotal {
  stage: string;
  currency: string | null;
  outcomes: number;
  valueMicros: bigint;
}

export interface MoneyByCurrency {
  currency: string;
  micros: bigint;
}

export interface PayingSummary {
  /** The paying stage's id and label. */
  stage: string;
  label: string;
  /** New paying customers: the paying stage's outcomes. */
  customers: number;
  /** Their payments' values, per currency, in currency order. */
  revenue: MoneyByCurrency[];
  /** The spend over the same days (the product's currency) per paying customer; null without one. */
  costPerCustomerMicros: bigint | null;
  /** The refund stage's outcomes, when the product has one. */
  refunds: { stage: string; count: number; amounts: MoneyByCurrency[] } | null;
}

function byCurrency(totals: readonly StageValueTotal[]): MoneyByCurrency[] {
  const sums = new Map<string, bigint>();
  for (const t of totals) {
    if (t.currency === null) continue;
    sums.set(t.currency, (sums.get(t.currency) ?? 0n) + t.valueMicros);
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, micros]) => ({ currency, micros }));
}

const countIn = (totals: readonly StageValueTotal[]): number => totals.reduce((n, t) => n + t.outcomes, 0);

/** The figures for the stages marked `paying` and `refund`, or null when the product has no paying stage. */
export function payingSummary(
  config: { stages: readonly OutcomeStage[] },
  totals: readonly StageValueTotal[],
  spendMicros: bigint,
): PayingSummary | null {
  const paying = stageWithRole(config, 'paying');
  if (paying === undefined) return null;
  const refund = stageWithRole(config, 'refund');
  const ofStage = (id: string) => totals.filter((t) => t.stage === id);
  const customers = countIn(ofStage(paying.id));
  return {
    stage: paying.id,
    label: paying.label,
    customers,
    revenue: byCurrency(ofStage(paying.id)),
    costPerCustomerMicros: costPer(spendMicros, customers),
    refunds:
      refund === undefined
        ? null
        : { stage: refund.id, count: countIn(ofStage(refund.id)), amounts: byCurrency(ofStage(refund.id)) },
  };
}

/** The stages `payingSummary` needs totals for: the paying and the refund stage, if marked. */
export function moneyStages(config: { stages: readonly OutcomeStage[] }): string[] {
  return config.stages.filter((s) => s.role !== undefined).map((s) => s.id);
}
