// Evidence for a finding (BLUEPRINT §3.7, PROPOSAL §6.5): impressions, clicks, spend, outcomes and days of data for
// the target and window, computed from the database. The thresholds are applied to this, never to a number the AI
// returned (invariant 4).
import {
  type ComputedEvidence,
  type EvidenceThreshold,
  daysFrom,
  localDate,
  microsToJson,
  minusDays,
} from '@ads/contracts';
import {
  type Account,
  type AdEntity,
  type DbOrTx,
  type EvidenceScope,
  type OutcomeScope,
  type SearchTermTotals,
  countOutcomesByScope,
  sumMetrics,
} from '@ads/db';
import { type ThresholdVerdict, evaluateEvidence } from '@ads/pack-sdk';
import type { TargetKind } from './registry.ts';

/** What a finding is about (D-079). */
export type FindingTarget =
  { kind: 'entity'; entity: AdEntity } | { kind: 'account'; account: Account } | { kind: 'product' };

/** Local days, inclusive. */
export interface EvidenceWindow {
  from: string;
  to: string;
}

export const targetKind = (target: FindingTarget): TargetKind =>
  target.kind === 'entity' ? target.entity.type : target.kind;

/** The `days` days ending yesterday in the product's time zone: today's numbers are still coming in. */
export function windowEndingYesterday(now: Date, timeZone: string, days: number): EvidenceWindow {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('an evidence window is at least one day');
  const to = minusDays(localDate(now, timeZone), 1);
  return { from: minusDays(to, days - 1), to };
}

/** Days of the window from `start` on (0 when it starts after the window). */
export function daysWatched(window: EvidenceWindow, start: string | null): number {
  if (start === null) return 0;
  const first = start > window.from ? start : window.from;
  return Math.max(0, daysFrom(first, window.to) + 1);
}

/** Below campaign level, an outcome counts for an entity only when it carries that entity's platform id (from the
 *  ad URL settings): Google ad group ids; Meta ad set and ad ids. Other levels can't be credited. */
function platformIdKey(entity: AdEntity): string | null {
  if (entity.platform === 'google' && entity.type === 'ad_group') return 'googleAdGroupId';
  if (entity.platform === 'meta' && entity.type === 'ad_group') return 'metaAdSetId';
  if (entity.platform === 'meta' && entity.type === 'ad') return 'metaAdId';
  return null;
}

function outcomeScope(target: FindingTarget): OutcomeScope | null {
  if (target.kind === 'product') return { kind: 'product' };
  if (target.kind === 'account') return { kind: 'account', accountId: target.account.id };
  const { entity } = target;
  if (entity.type === 'campaign') return { kind: 'campaign', entityId: entity.id };
  const idKey = platformIdKey(entity);
  return idKey === null ? null : { kind: 'platformId', accountId: entity.accountId, idKey, id: entity.externalId };
}

function metricScope(target: FindingTarget): EvidenceScope {
  if (target.kind === 'entity') return { kind: 'entity', entityId: target.entity.id };
  if (target.kind === 'account') return { kind: 'account', accountId: target.account.id };
  return { kind: 'product' };
}

/** `ComputedEvidence` for any target and window, from SQL. `detail` carries the rule's own computed figures. */
export async function computeEvidence(
  db: DbOrTx,
  input: {
    productId: string;
    timeZone: string;
    target: FindingTarget;
    window: EvidenceWindow;
    detail?: ComputedEvidence['detail'];
  },
): Promise<ComputedEvidence> {
  const { productId, timeZone, target, window } = input;
  const metrics = await sumMetrics(db, { productId, scope: metricScope(target), ...window, timeZone });
  const scope = outcomeScope(target);
  const outcomesByStage =
    scope === null ? {} : await countOutcomesByScope(db, { productId, scope, ...window, timeZone });
  const starts = [metrics.firstDataDay, metrics.firstSeenDay].filter((d): d is string => d !== null).sort();
  return {
    windowDays: daysFrom(window.from, window.to) + 1,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    spendMicros: microsToJson(metrics.spendMicros),
    outcomesByStage,
    from: window.from,
    to: window.to,
    dataDays: daysWatched(window, starts[0] ?? null),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  };
}

/** The pack's threshold applied to computed evidence (the threshold engine, fail closed without one). */
export const judgeEvidence = (evidence: ComputedEvidence, threshold: EvidenceThreshold | null): ThresholdVerdict =>
  evaluateEvidence(
    {
      impressions: evidence.impressions,
      clicks: evidence.clicks,
      spendMicros: BigInt(evidence.spendMicros),
      days: evidence.dataDays,
    },
    threshold,
  );

/** A search term's evidence: its ad group's window and days watched, with the term's own sums in place of the ad
 *  group's metrics, and the platform's KPI conversions for the term as its outcomes. */
export const searchTermEvidence = (
  adGroup: ComputedEvidence,
  term: SearchTermTotals,
  kpiStage: string,
): ComputedEvidence => ({
  ...adGroup,
  impressions: term.impressions,
  clicks: term.clicks,
  spendMicros: term.spendMicros.toString(),
  outcomesByStage: { [kpiStage]: Math.floor(Number(term.conversions)) }, // whole conversions (Google reports fractions)
  detail: { level: 'search_term', daysWithTerm: term.daysWithRows },
});
