// The daily digest (BLUEPRINT §5.14, M07): about six lines, numbers only, no AI. Every figure comes from SQL here;
// `renderDigest` only formats them. The daily cycle's `reported` stage builds it and, when the send rule says so,
// queues it in the notifications outbox for the worker's bot.
import { localDate, minusDays } from '@ads/contracts';
import {
  type DbOrTx,
  type Product,
  countOutcomesByScope,
  listAccounts,
  listProposals,
  listTrustChecks,
  listUnacknowledgedDrift,
  sumMetrics,
  trustSignalsOf,
} from '@ads/db';
import { accountRefText } from '../analyst/refs.ts';
import { costPer, countOf, formatMoney, percentOf, stageWord } from './format.ts';

/** Days the digest's cost per KPI covers: one day is too noisy at low volume. */
export const DIGEST_KPI_DAYS = 7;

export interface DigestData {
  product: { slug: string; name: string; currency: string };
  /** Yesterday, in the product's timezone: the last full day. */
  day: string;
  /** The day the digest is for is the last day of its month, so today is the 1st (the Meta limit reminder). */
  firstOfMonth: boolean;
  spend: {
    dayMicros: bigint;
    dailyCeilingMicros: bigint | null;
    /** The month of `day`, from its 1st through `day`. */
    month: string;
    monthMicros: bigint;
    monthlyCeilingMicros: bigint | null;
  };
  /** Meta accounts: the account spending limit and how much of it is used, as read at the last sync (D-063). */
  metaLimits: { account: string; spendCapMicros: bigint | null; amountSpentMicros: bigint | null }[];
  /** Outcomes on `day` per stage, in the pack's stage order (test traffic never counts). */
  outcomes: { stage: string; label: string; count: number }[];
  kpi: { stage: string; label: string; days: number; spendMicros: bigint; outcomes: number; costMicros: bigint | null };
  openProposals: number;
  /** This cycle's trust checks that didn't pass (`no_signal` is not a problem). Null: no cycle given. */
  trust: { result: string | null; flagged: { check: string; result: string; account: string | null }[] } | null;
  /** Changes made outside the agent that Marcus hasn't acknowledged. */
  drift: number;
}

export async function buildDigest(
  db: DbOrTx,
  input: {
    product: Product;
    now: Date;
    /** The cycle reported on: its `cycleDate` is "today", so a cycle resumed the next day reports its own day. */
    cycle?: { id: string; trustResult: string | null; cycleDate: string } | null;
  },
): Promise<DigestData> {
  const { product, now } = input;
  const tz = product.timezone;
  const today = input.cycle?.cycleDate ?? localDate(now, tz);
  const day = minusDays(today, 1);
  const month = day.slice(0, 7);
  const spendOn = async (from: string, to: string) =>
    (await sumMetrics(db, { productId: product.id, scope: { kind: 'product' }, from, to, timeZone: tz })).spendMicros;
  const outcomesOn = (from: string, to: string) =>
    countOutcomesByScope(db, { productId: product.id, scope: { kind: 'product' }, from, to, timeZone: tz });

  const kpiFrom = minusDays(day, DIGEST_KPI_DAYS - 1);
  const [dayMicros, monthMicros, kpiSpend, dayOutcomes, kpiOutcomes, accounts, proposals, drift] = await Promise.all([
    spendOn(day, day),
    spendOn(`${month}-01`, day),
    spendOn(kpiFrom, day),
    outcomesOn(day, day),
    outcomesOn(kpiFrom, day),
    listAccounts(db, product.id),
    listProposals(db, product.id, ['pending']),
    listUnacknowledgedDrift(db, product.id),
  ]);
  const accountRef = new Map(accounts.map((a) => [a.id, accountRefText(a)]));

  let trust: DigestData['trust'] = null;
  if (input.cycle != null) {
    const checks = await listTrustChecks(db, input.cycle.id);
    trust = {
      result: input.cycle.trustResult,
      flagged: checks
        .filter((c) => c.result === 'fail' || c.result === 'warn')
        .map((c) => ({
          check: c.checkId,
          result: c.result,
          account: c.accountId === null ? null : (accountRef.get(c.accountId) ?? null),
        })),
    };
  }

  const { stages, primaryKpiStage } = product.settings.outcomes;
  const kpiLabel = stages.find((s) => s.id === primaryKpiStage)?.label ?? primaryKpiStage;
  const kpiCount = kpiOutcomes[primaryKpiStage] ?? 0;
  const ceiling = (json: string | null): bigint | null => (json === null ? null : BigInt(json));
  return {
    product: { slug: product.slug, name: product.name, currency: product.currency },
    day,
    firstOfMonth: today.endsWith('-01'),
    spend: {
      dayMicros,
      dailyCeilingMicros: ceiling(product.settings.spend.dailyCeilingMicros),
      month,
      monthMicros,
      monthlyCeilingMicros: ceiling(product.settings.spend.monthlyCeilingMicros),
    },
    metaLimits: accounts
      .filter((a) => a.platform === 'meta' && a.status === 'active')
      .map((a) => {
        const signals = trustSignalsOf(a);
        const micros = (json: string | null | undefined): bigint | null => (json == null ? null : BigInt(json));
        return {
          account: accountRefText(a),
          spendCapMicros: micros(signals?.spendCapMicros),
          amountSpentMicros: micros(signals?.amountSpentMicros),
        };
      }),
    outcomes: stages.map((s) => ({ stage: s.id, label: s.label, count: dayOutcomes[s.id] ?? 0 })),
    kpi: {
      stage: primaryKpiStage,
      label: kpiLabel,
      days: DIGEST_KPI_DAYS,
      spendMicros: kpiSpend,
      outcomes: kpiCount,
      costMicros: costPer(kpiSpend, kpiCount),
    },
    openProposals: proposals.length,
    trust,
    drift: drift.length,
  };
}

export type DigestSetting = Product['settings']['notifications']['digest'];

/** The send rule: `off` never; `always` every day; `auto` only while the product spends, or when a trust check
 *  failed (a broken tracking setup must not go quiet just because spend stopped). */
export function shouldSendDigest(setting: DigestSetting, data: DigestData): boolean {
  if (setting === 'off') return false;
  if (setting === 'always') return true;
  return data.spend.dayMicros > 0n || data.trust?.result === 'fail';
}

/** The digest as markdown-lite lines (see format.ts): the first line is its title. */
export function renderDigest(data: DigestData): string {
  const c = data.product.currency;
  const money = (m: bigint): string => formatMoney(m, c);
  const of = (part: bigint, whole: bigint | null): string => {
    if (whole === null) return ' (no ceiling set)';
    const pct = percentOf(part, whole);
    return ` of ${money(whole)}${pct === null ? '' : ` (${pct}%)`}`;
  };
  const lines = [`**${data.product.name} · ${data.day}**`];
  lines.push(
    `Spend: ${money(data.spend.dayMicros)} yesterday${of(data.spend.dayMicros, data.spend.dailyCeilingMicros)}`,
    `Month ${data.spend.month}: ${money(data.spend.monthMicros)}${of(data.spend.monthMicros, data.spend.monthlyCeilingMicros)}`,
  );
  for (const limit of data.metaLimits) {
    if (limit.spendCapMicros === null || limit.spendCapMicros === 0n) {
      lines.push(`Meta limit (${limit.account}): not set`);
    } else {
      const used = limit.amountSpentMicros ?? 0n;
      lines.push(`Meta limit (${limit.account}): ${money(used)} used${of(used, limit.spendCapMicros)}`);
    }
  }
  if (data.firstOfMonth && data.metaLimits.length > 0) {
    lines.push('New month: reset the Meta account spending limit (Ads Manager → Billing → Account spending limit).');
  }
  // Counts by stage id ("2 signups"), never by its label ("Signup (email link clicked)"), which takes no plural.
  const counted = data.outcomes.filter((o) => o.count > 0);
  lines.push(
    `Outcomes yesterday: ${counted.length === 0 ? 'none' : counted.map((o) => countOf(o.count, o.stage)).join(' · ')}`,
  );
  const k = data.kpi;
  lines.push(
    k.costMicros === null
      ? `Cost per ${stageWord(k.stage)} (${k.days} days): no ${stageWord(k.stage, true)} (${money(k.spendMicros)} spent)`
      : `Cost per ${stageWord(k.stage)} (${k.days} days): ${money(k.costMicros)} (${countOf(k.outcomes, k.stage)}, ${money(k.spendMicros)} spent)`,
  );
  lines.push(`Open proposals: ${data.openProposals}`);
  const flags: string[] = [];
  if (data.trust?.result === 'fail') flags.push('trust check FAILED: the weekly analysis is held until it passes');
  for (const f of data.trust?.flagged ?? []) {
    flags.push(`${f.check} ${f.result}${f.account === null ? '' : ` (${f.account})`}`);
  }
  if (data.drift > 0) flags.push(`${data.drift} change${data.drift === 1 ? '' : 's'} made outside the agent`);
  lines.push(`Checks: ${flags.length === 0 ? 'all OK' : flags.join('; ')}`);
  return lines.join('\n');
}
