// The trust checks (BLUEPRINT §5.8, M04): named checks that pass, warn, fail, or have too little data to judge
// (`no_signal`). They read only the database (what the sync stored), never the platforms, so a resumed cycle can
// run them again for free. `outcome_source_fresh` is on from M05a; `attribution_gap` and `id_capture` arrive
// in M05b. A cycle whose checks fail produces a diagnostic report only.
import type { OutcomeSourceState, Platform, ProductSettings } from '@ads/contracts';
import {
  type Account,
  type DbOrTx,
  type Product,
  type TrustCheck,
  countFedBackSince,
  getProduct,
  listAccounts,
  outcomeSourceOf,
  replaceTrustChecks,
  trustSignalsOf,
} from '@ads/db';
import { TRUST_WINDOW_DAYS } from '../sync/report.ts';

export type CheckResult = 'pass' | 'warn' | 'fail' | 'no_signal';
export type TrustResult = 'ok' | 'degraded' | 'fail';

export interface CheckOutcome {
  result: CheckResult;
  detail: Record<string, unknown>;
}

/** `data_fresh`: the last successful sync must be under 26 hours old (a daily sync plus slack). */
export const DATA_FRESH_MAX_HOURS = 26;
/** `spend_cap_headroom`: warn from 80% of the Meta spending limit used (D-063). */
export const SPEND_CAP_WARN_PCT = 80;
/** The trust signals cover the last 7 days (the account's local days, `TRUST_WINDOW_DAYS`). */
export const TRUST_WINDOW_MS = TRUST_WINDOW_DAYS * 86_400_000;

const HOUR_MS = 3_600_000;

export function dataFresh(input: { lastSyncedAt: Date | null; lastSyncError: string | null; now: Date }): CheckOutcome {
  const error = input.lastSyncError === null ? {} : { lastSyncError: input.lastSyncError };
  if (input.lastSyncedAt === null) return { result: 'fail', detail: { lastSyncedAt: null, ...error } };
  const ageHours = Math.round(((input.now.getTime() - input.lastSyncedAt.getTime()) / HOUR_MS) * 10) / 10;
  return {
    result: ageHours < DATA_FRESH_MAX_HOURS ? 'pass' : 'fail',
    detail: { lastSyncedAt: input.lastSyncedAt.toISOString(), ageHours, maxHours: DATA_FRESH_MAX_HOURS, ...error },
  };
}

/** `timezone_match`: metric days are the account's local days, so they must be the product's days too. */
export function timezoneMatch(input: { accountTimezone: string | null; productTimezone: string }): CheckOutcome {
  const detail = { accountTimezone: input.accountTimezone, productTimezone: input.productTimezone };
  return { result: input.accountTimezone === input.productTimezone ? 'pass' : 'fail', detail };
}

/** `tracking_active`: the platform recorded conversions in the last 7 days. Zero conversions fail only with enough
 *  clicks to judge, and only when the platform should have seen some: if the KPI stage reaches it through the
 *  agent's uploads and nothing was uploaded in the window, zero says nothing about tracking (D-075). */
export function trackingActive(input: {
  clicks: number;
  platformConversions: number;
  minClicks: number;
  /** The KPI stage reaches this platform through a feedback route (the agent's uploads). */
  routedByUploads: boolean;
  /** KPI-stage outcomes uploaded to this platform in the window. */
  uploads: number;
}): CheckOutcome {
  const detail = {
    clicks: input.clicks,
    platformConversions: input.platformConversions,
    minClicksToJudgeTracking: input.minClicks,
    ...(input.routedByUploads ? { uploads: input.uploads } : {}),
  };
  if (input.platformConversions > 0) return { result: 'pass', detail };
  if (input.clicks < input.minClicks) return { result: 'no_signal', detail: { ...detail, reason: 'too few clicks' } };
  if (input.routedByUploads && input.uploads === 0) {
    return { result: 'no_signal', detail: { ...detail, reason: 'conversions arrive only through uploads; none yet' } };
  }
  return { result: 'fail', detail };
}

/** `spend_cap_headroom` (Meta): the account spending limit is the real backstop (D-063). It's a lifetime total
 *  that Marcus resets by hand, so an unset limit or 80% used warns; it never fails. Money stays in bigint. */
export function spendCapHeadroom(input: {
  spendCapMicros: string | null;
  amountSpentMicros: string | null;
}): CheckOutcome {
  if (input.spendCapMicros === null) {
    return { result: 'warn', detail: { spendCapMicros: null, reason: 'no spending limit is set' } };
  }
  const cap = BigInt(input.spendCapMicros);
  const spent = BigInt(input.amountSpentMicros ?? '0');
  const usedPct = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 100;
  const detail = { spendCapMicros: cap.toString(), amountSpentMicros: spent.toString(), usedPct };
  return { result: spent * 100n >= cap * BigInt(SPEND_CAP_WARN_PCT) ? 'warn' : 'pass', detail };
}

/** `outcome_source_fresh` (product level): the last read of the product's outcome source (stored by the sync).
 *  Unread, unreadable or not read for DATA_FRESH_MAX_HOURS fails; healthy but with no activity within
 *  `maxOutcomeStalenessHours` warns (quiet, not broken). */
export function outcomeSourceFresh(input: {
  state: OutcomeSourceState | null;
  now: Date;
  maxStalenessHours: number;
}): CheckOutcome {
  const { state, now } = input;
  if (state === null) return { result: 'fail', detail: { reason: 'the outcome source has not been read yet' } };
  const hoursSince = (iso: string): number => Math.round(((now.getTime() - Date.parse(iso)) / HOUR_MS) * 10) / 10;
  const read = { checkedAt: state.checkedAt, readAgeHours: hoursSince(state.checkedAt) };
  if (!state.ok) {
    return { result: 'fail', detail: { ...read, reason: 'the outcome source could not be read', error: state.detail } };
  }
  if (read.readAgeHours >= DATA_FRESH_MAX_HOURS) {
    return { result: 'fail', detail: { ...read, reason: 'the outcome source was not read recently' } };
  }
  const limits = { maxOutcomeStalenessHours: input.maxStalenessHours };
  if (state.latestActivityAt === null) {
    return { result: 'warn', detail: { ...read, ...limits, latestActivityAt: null, reason: 'no activity yet' } };
  }
  const activityAgeHours = hoursSince(state.latestActivityAt);
  const detail = { ...read, ...limits, latestActivityAt: state.latestActivityAt, activityAgeHours };
  return activityAgeHours <= input.maxStalenessHours
    ? { result: 'pass', detail }
    : { result: 'warn', detail: { ...detail, reason: 'healthy but quiet' } };
}

/** The cycle's trust result: `fail` if any check fails, `degraded` if any warns, else `ok`. */
export function trustResultOf(results: CheckResult[]): TrustResult {
  if (results.includes('fail')) return 'fail';
  if (results.includes('warn')) return 'degraded';
  return 'ok';
}

/** Whether the product's KPI stage reaches `platform` through the agent's uploads (a feedback route). */
export const routedByUploads = (settings: ProductSettings, platform: Platform): boolean =>
  settings.outcomes.feedback.some((r) => r.platform === platform && r.stage === settings.outcomes.primaryKpiStage);

export interface TrustStageResult {
  result: TrustResult;
  checks: TrustCheck[];
}

/** Runs every switched-on check for the product's active accounts and stores them for the cycle (replacing any
 *  from an interrupted run). No account to check at all is a product-level `data_fresh` failure. */
export async function trustStage(
  db: DbOrTx,
  input: { product: Product; cycleId: string; now: Date },
): Promise<TrustStageResult> {
  const { product, now } = input;
  const checks: { accountId: string | null; checkId: string; result: CheckResult; detail: Record<string, unknown> }[] =
    [];
  const add = (account: Account | null, checkId: string, outcome: CheckOutcome): void => {
    const label = account === null ? {} : { account: `${account.platform}:${account.externalId}` };
    checks.push({
      accountId: account?.id ?? null,
      checkId,
      result: outcome.result,
      detail: { ...label, ...outcome.detail },
    });
  };

  const accounts = (await listAccounts(db, product.id)).filter((a) => a.status === 'active');
  if (accounts.length === 0)
    add(null, 'data_fresh', { result: 'fail', detail: { reason: 'no active ad account is linked' } });

  for (const account of accounts) {
    add(
      account,
      'data_fresh',
      dataFresh({ lastSyncedAt: account.lastSyncedAt, lastSyncError: account.lastSyncError, now }),
    );
    add(
      account,
      'timezone_match',
      timezoneMatch({ accountTimezone: account.timezone, productTimezone: product.timezone }),
    );

    const signals = trustSignalsOf(account);
    const read = signals === null ? {} : { range: signals.range, readAt: signals.readAt };
    if (signals === null) {
      add(account, 'tracking_active', { result: 'no_signal', detail: { reason: 'no trust signals stored yet' } });
    } else {
      const routed = routedByUploads(product.settings, account.platform);
      const uploads = routed
        ? await countFedBackSince(db, {
            productId: product.id,
            platform: account.platform,
            stage: product.settings.outcomes.primaryKpiStage,
            // The uploads that could show in those signals: the 7 days before they were read.
            since: new Date(Date.parse(signals.readAt) - TRUST_WINDOW_MS),
          })
        : 0;
      const outcome = trackingActive({
        clicks: signals.clicks,
        platformConversions: signals.platformConversions,
        minClicks: product.settings.trust.minClicksToJudgeTracking,
        routedByUploads: routed,
        uploads,
      });
      add(account, 'tracking_active', { ...outcome, detail: { ...outcome.detail, ...read } });
    }

    if (account.platform === 'meta') {
      const outcome =
        signals === null
          ? { result: 'warn' as const, detail: { reason: 'the spending limit has not been read yet' } }
          : spendCapHeadroom(signals);
      add(account, 'spend_cap_headroom', { ...outcome, detail: { ...outcome.detail, ...read } });
    }
  }

  // Read again: the sync stage of this cycle stored the outcome source's state after `product` was loaded.
  const current = await getProduct(db, product.id);
  add(
    null,
    'outcome_source_fresh',
    outcomeSourceFresh({
      state: outcomeSourceOf(current),
      now,
      maxStalenessHours: current.settings.trust.maxOutcomeStalenessHours,
    }),
  );

  const stored = await replaceTrustChecks(db, { productId: product.id, cycleId: input.cycleId, checks });
  return { result: trustResultOf(checks.map((c) => c.result)), checks: stored };
}
