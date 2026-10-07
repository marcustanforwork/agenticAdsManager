// The detectors (BLUEPRINT §5.9): fixed rules that turn the synced data into candidate findings. A candidate is
// kept only when its rule holds AND the pack's evidence threshold is met by evidence computed from the database
// (PROPOSAL §6.5); a pack without a threshold for a type gets no candidates of that type (fail closed). Summaries
// are built from computed figures only, never from platform text (entity names and search terms are untrusted,
// invariant 5): a search term travels as the candidate's `negativeText` parameter, as data.
import {
  type ComputedEvidence,
  type FindingTypeId,
  type PackManifest,
  daysFrom,
  formatSgd,
  localDate,
  minusDays,
} from '@ads/contracts';
import {
  type Account,
  type AdEntity,
  type DbOrTx,
  type Product,
  listAccounts,
  listEntities,
  countOutcomesWithPlatformIds,
  listTrustChecks,
  sumSearchTerms,
} from '@ads/db';
import { thresholdFor } from '@ads/pack-sdk';
import { TRUST_WINDOW_DAYS } from '../sync/report.ts';
import {
  type EvidenceWindow,
  type FindingTarget,
  computeEvidence,
  judgeEvidence,
  windowEndingYesterday,
} from './evidence.ts';
import { evidenceWindowDays } from './registry.ts';

export interface DetectorContext {
  db: DbOrTx;
  product: Product;
  manifest: PackManifest;
  cycleId: string;
  now: Date;
}

export interface Candidate {
  type: FindingTypeId;
  target: FindingTarget;
  summary: string;
  evidence: ComputedEvidence;
  params?: { negativeText: string };
}

export interface Detector {
  type: FindingTypeId;
  detect(ctx: DetectorContext): Promise<Candidate[]>;
}

/** Google's limit for a keyword's text: a longer search term can't become a negative keyword as it is. */
export const NEGATIVE_KEYWORD_MAX_CHARS = 80;
export const NEGATIVE_KEYWORD_MAX_WORDS = 10;
/** Pacing: projected month spend above 100% or below 60% of the monthly ceiling (§5.9). */
export const PACING_HIGH_PCT = 100n;
export const PACING_LOW_PCT = 60n;

/** Money for a summary, rounded to the cent in bigint (invariant 6): S$ for SGD, else the currency code. */
const money = (micros: bigint, currency: string): string =>
  currency === 'SGD' ? formatSgd(micros) : formatSgd(micros).replace('S$', `${currency} `);

/** The KPI stage for summaries, from its id ("signup", "form fill"): pack labels are descriptive phrases that don't
 *  take a plural. */
const kpiName = (product: Product): string => product.settings.outcomes.primaryKpiStage.replaceAll('_', ' ');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The product's active accounts, and their active entities of one type. */
async function activeEntities(ctx: DetectorContext, type: AdEntity['type']): Promise<AdEntity[]> {
  const accounts = new Set(
    (await listAccounts(ctx.db, ctx.product.id)).filter((a) => a.status === 'active').map((a) => a.id),
  );
  return (await listEntities(ctx.db, ctx.product.id, { type })).filter(
    (e) => e.status === 'active' && accounts.has(e.accountId),
  );
}

const evidenceFor = (
  ctx: DetectorContext,
  target: FindingTarget,
  window: EvidenceWindow,
  detail?: ComputedEvidence['detail'],
) =>
  computeEvidence(ctx.db, {
    productId: ctx.product.id,
    timeZone: ctx.product.timezone,
    target,
    window,
    ...(detail === undefined ? {} : { detail }),
  });

/** Spend without outcomes: spend and clicks over the window, and no outcome at the KPI stage (campaign level, where
 *  outcomes are attributed). */
export const zeroOutcomeSpend: Detector = {
  type: 'zero_outcome_spend',
  async detect(ctx) {
    const threshold = thresholdFor(ctx.manifest, this.type);
    if (threshold === null) return [];
    const window = windowEndingYesterday(ctx.now, ctx.product.timezone, evidenceWindowDays(this.type, threshold));
    const kpi = ctx.product.settings.outcomes.primaryKpiStage;
    // Zero attributed outcomes mean something only where the platform's outcomes can be attributed at all: some
    // recent outcome must carry that platform's ids (auto-tagging or URL parameters, T14). Until then, skip.
    const attributable = new Map<string, boolean>();
    for (const platform of ['google', 'meta'] as const) {
      const n = await countOutcomesWithPlatformIds(ctx.db, {
        productId: ctx.product.id,
        platform,
        stage: kpi,
        ...window,
        timeZone: ctx.product.timezone,
      });
      attributable.set(platform, n > 0);
    }
    const out: Candidate[] = [];
    for (const entity of await activeEntities(ctx, 'campaign')) {
      if (attributable.get(entity.platform) !== true) continue;
      const target: FindingTarget = { kind: 'entity', entity };
      const evidence = await evidenceFor(ctx, target, window);
      const spend = BigInt(evidence.spendMicros);
      if (spend === 0n || evidence.clicks === 0 || (evidence.outcomesByStage[kpi] ?? 0) > 0) continue;
      if (!judgeEvidence(evidence, threshold).met) continue;
      out.push({
        type: this.type,
        target,
        evidence,
        summary:
          `Spent ${money(spend, ctx.product.currency)} for ${plural(evidence.clicks, 'click')} over ` +
          `${evidence.windowDays} days, with no ${kpiName(ctx.product)} outcomes.`,
      });
    }
    return out;
  },
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Tracking gap: this cycle's `tracking_active` check failed, or `attribution_gap` warned, for an account. */
export const trackingGap: Detector = {
  type: 'tracking_gap',
  async detect(ctx) {
    const threshold = thresholdFor(ctx.manifest, this.type);
    if (threshold === null) return [];
    const checks = await listTrustChecks(ctx.db, ctx.cycleId);
    const accounts = new Map((await listAccounts(ctx.db, ctx.product.id)).map((a) => [a.id, a] as const));
    const flagged = new Map<string, { tracking?: Record<string, unknown>; gap?: Record<string, unknown> }>();
    for (const c of checks) {
      if (c.accountId === null) continue;
      const entry = flagged.get(c.accountId) ?? {};
      if (c.checkId === 'tracking_active' && c.result === 'fail') entry.tracking = c.detail as Record<string, unknown>;
      else if (c.checkId === 'attribution_gap' && c.result === 'warn') entry.gap = c.detail as Record<string, unknown>;
      else continue;
      flagged.set(c.accountId, entry);
    }
    const window = windowEndingYesterday(ctx.now, ctx.product.timezone, evidenceWindowDays(this.type, threshold));
    const out: Candidate[] = [];
    for (const [accountId, found] of flagged) {
      const account: Account | undefined = accounts.get(accountId);
      if (account === undefined || account.status !== 'active') continue;
      const detail = {
        trackingActive: found.tracking === undefined ? null : 'fail',
        platformConversions: num(found.tracking?.platformConversions ?? found.gap?.platformConversions),
        attributedOutcomes: num(found.gap?.attributedOutcomes),
        attributionGapPct: num(found.gap?.gapPct),
      };
      const target: FindingTarget = { kind: 'account', account };
      const evidence = await evidenceFor(ctx, target, window, detail);
      if (!judgeEvidence(evidence, threshold).met) continue;
      const platform = account.platform === 'google' ? 'Google' : 'Meta';
      const why =
        found.tracking !== undefined
          ? `${platform} recorded no conversions in ${TRUST_WINDOW_DAYS} days despite ${plural(num(found.tracking.clicks) ?? 0, 'click')}`
          : `${platform} counts ${detail.platformConversions ?? 0} ${kpiName(ctx.product)} conversions and we can credit ` +
            `${detail.attributedOutcomes ?? 0} to its campaigns (${detail.attributionGapPct ?? 0}% apart)`;
      out.push({
        type: this.type,
        target,
        evidence,
        summary: `Tracking looks broken on this ${platform} account: ${why}.`,
      });
    }
    return out;
  },
};

/** Pacing: month-to-date spend projected over the month, against the monthly ceiling (product level). */
export const pacingRisk: Detector = {
  type: 'pacing_risk',
  async detect(ctx) {
    const threshold = thresholdFor(ctx.manifest, this.type);
    const ceilingJson = ctx.product.settings.spend.monthlyCeilingMicros;
    if (threshold === null || ceilingJson === null) return [];
    const ceiling = BigInt(ceilingJson);
    const today = localDate(ctx.now, ctx.product.timezone);
    const monthStart = `${today.slice(0, 7)}-01`;
    if (today === monthStart || ceiling <= 0n) return []; // no full day of this month yet
    const window = { from: monthStart, to: minusDays(today, 1) };
    const nextMonth = new Date(`${monthStart}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const daysInMonth = BigInt(daysFrom(monthStart, nextMonth.toISOString().slice(0, 10)));
    const elapsed = BigInt(daysFrom(window.from, window.to) + 1);
    const target: FindingTarget = { kind: 'product' };
    const first = await evidenceFor(ctx, target, window);
    const spent = BigInt(first.spendMicros);
    const projected = (spent * daysInMonth) / elapsed;
    const pct = (projected * 100n) / ceiling;
    const over = projected * 100n > ceiling * PACING_HIGH_PCT;
    const under = spent > 0n && pct < PACING_LOW_PCT; // a product that isn't spending isn't pacing
    if (!over && !under) return [];
    const evidence: ComputedEvidence = {
      ...first,
      detail: {
        monthToDateMicros: spent.toString(),
        projectedMicros: projected.toString(),
        monthlyCeilingMicros: ceiling.toString(),
        projectedPct: Number(pct),
      },
    };
    if (!judgeEvidence(evidence, threshold).met) return [];
    const c = ctx.product.currency;
    return [
      {
        type: this.type,
        target,
        evidence,
        summary: over
          ? `On course to spend ${money(projected, c)} this month, ${pct}% of the ${money(ceiling, c)} ceiling.`
          : `On course to spend only ${money(projected, c)} this month, ${pct}% of the ${money(ceiling, c)} ceiling.`,
      },
    ];
  },
};

/** Costly search terms (Google): clicks and spend over the thresholds and no KPI conversion. The platform's per-term
 *  conversions are meaningful only where tracking works, so only accounts whose `tracking_active` passed this cycle
 *  are judged (an upload-only product waits for its uploads, D-075). */
export const wastefulSearchTerm: Detector = {
  type: 'wasteful_search_term',
  async detect(ctx) {
    const threshold = thresholdFor(ctx.manifest, this.type);
    if (threshold === null) return [];
    const tracked = new Set(
      (await listTrustChecks(ctx.db, ctx.cycleId))
        .filter((c) => c.checkId === 'tracking_active' && c.result === 'pass' && c.accountId !== null)
        .map((c) => c.accountId as string),
    );
    // An ad group counts only under an active campaign: a paused campaign's terms can't cost anything any more.
    const campaigns = new Set((await activeEntities(ctx, 'campaign')).map((e) => e.id));
    const adGroups = new Map(
      (await activeEntities(ctx, 'ad_group'))
        .filter(
          (e) =>
            e.platform === 'google' && tracked.has(e.accountId) && e.parentId !== null && campaigns.has(e.parentId),
        )
        .map((e) => [e.id, e] as const),
    );
    if (adGroups.size === 0) return [];
    const window = windowEndingYesterday(ctx.now, ctx.product.timezone, evidenceWindowDays(this.type, threshold));
    const kpi = ctx.product.settings.outcomes.primaryKpiStage;
    const out: Candidate[] = [];
    // The ad group's own evidence gives the days watched; the term's sums replace its metrics.
    const watched = new Map<string, ComputedEvidence>();
    for (const term of await sumSearchTerms(ctx.db, { productId: ctx.product.id, ...window })) {
      const adGroup = adGroups.get(term.adGroupEntityId);
      if (adGroup === undefined || Number(term.conversions) > 0 || term.clicks === 0 || term.spendMicros === 0n)
        continue;
      if (term.term.length > NEGATIVE_KEYWORD_MAX_CHARS) continue; // Google would refuse it as a keyword
      if (term.term.trim().split(/\s+/).length > NEGATIVE_KEYWORD_MAX_WORDS) continue;
      const target: FindingTarget = { kind: 'entity', entity: adGroup };
      const base = watched.get(adGroup.id) ?? (await evidenceFor(ctx, target, window));
      watched.set(adGroup.id, base);
      const evidence: ComputedEvidence = {
        ...base,
        impressions: term.impressions,
        clicks: term.clicks,
        spendMicros: term.spendMicros.toString(),
        outcomesByStage: { [kpi]: 0 }, // the platform's KPI conversions for the term
        detail: { level: 'search_term', daysWithTerm: term.daysWithRows },
      };
      if (!judgeEvidence(evidence, threshold).met) continue;
      out.push({
        type: this.type,
        target,
        evidence,
        params: { negativeText: term.term }, // untrusted platform text: data only
        summary:
          `A search term in this ad group cost ${money(term.spendMicros, ctx.product.currency)} for ` +
          `${plural(term.clicks, 'click')} over ${evidence.windowDays} days, with no ${kpiName(ctx.product)} conversions.`,
      });
    }
    return out;
  },
};

/** The detectors M06a runs, in order. `cost_spike` and `no_delivery` were cut to M06b; the two Phase 3 detectors
 *  (`budget_limited_efficient`, `overspend_inefficient`) come with their proposals in M14. */
export const DETECTORS: readonly Detector[] = [zeroOutcomeSpend, trackingGap, pacingRisk, wastefulSearchTerm];

export async function runDetectors(
  ctx: DetectorContext,
  detectors: readonly Detector[] = DETECTORS,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const d of detectors) out.push(...(await d.detect(ctx)));
  return out;
}
