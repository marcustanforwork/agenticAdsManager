// The `ads sync --dry` report (M02, M03): what a sync would store, as counts only (never names).
import type { AdEntityRecord, EntityType, MetricRow, Platform } from '@ads/contracts';
import { microsToJson } from '@ads/contracts';
import type { DbOrTx } from '@ads/db';
import type { MasterKey } from '@ads/vault';

/** BLUEPRINT §5.7: each sync re-downloads the trailing 28 days. */
export const SYNC_WINDOW_DAYS = 28;
/** BLUEPRINT §5.8: trust signals look at the last 7 days. */
export const TRUST_WINDOW_DAYS = 7;

export interface LevelSummary {
  rows: number;
  days: number;
  impressions: number;
  clicks: number;
  spendMicros: string;
  platformConversions: number;
}

export interface AccountReport {
  account: string;
  outcome: 'read' | 'skipped' | 'error';
  detail?: string;
  timezone?: string;
  currency?: string;
  /** BLUEPRINT §5.8 `timezone_match`: the account's timezone must equal the product's. */
  timezoneMatchesProduct?: boolean;
  window?: { from: string; to: string };
  entities?: Partial<Record<EntityType, { total: number; byStatus: Record<string, number> }>>;
  snapshots?: number;
  metrics?: Partial<Record<EntityType, LevelSummary>>;
  trust?: Record<string, unknown>;
  /** Google: search-term rows over the window, and on how many days. */
  searchTerms?: { rows: number; days: number };
  /** Google: click ids read for one day (yesterday). */
  clickIds?: { day: string; rows: number };
  /** Google: budgets shared by several campaigns (never changed by this system). */
  sharedBudgets?: number;
  /** Google: the manager account used as `login-customer-id` (null = direct access). */
  loginCustomerId?: string | null;
  /** HTTP requests made; for Google each one counts as an API operation. */
  requests?: number;
  durationMs?: number;
}

export interface DrySyncReport {
  product: string;
  platform: Platform;
  dryRun: true;
  warnings: string[];
  accounts: AccountReport[];
}

export interface DrySyncInput {
  db: DbOrTx;
  productSlug: string;
  platform: Platform;
  /** The worker's read key (`VAULT_READ_KEY`). */
  masterKey: MasterKey;
  /** Replaces the network: the replayer in tests, the recorder with RECORD=1. */
  fetch?: typeof fetch;
  /** Google only: replaces the token endpoint's network (sign-in never goes through `fetch`, D-072). */
  tokenFetch?: typeof fetch;
  /** Google only: the soft cap on the day's operations (default GOOGLE_SYNC_SOFT_CAP). */
  googleSoftCap?: number;
  now?: () => Date;
}

export function countBy(rows: AdEntityRecord[], type: EntityType) {
  const mine = rows.filter((r) => r.ref.type === type);
  const byStatus: Record<string, number> = {};
  for (const r of mine) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { total: mine.length, byStatus };
}

/** The totals of one level's metric rows. */
export function summariseLevel(rows: MetricRow[]): LevelSummary {
  return {
    rows: rows.length,
    days: new Set(rows.map((r) => r.day)).size,
    impressions: rows.reduce((n, r) => n + r.impressions, 0),
    clicks: rows.reduce((n, r) => n + r.clicks, 0),
    spendMicros: microsToJson(rows.reduce((n, r) => n + BigInt(r.spendMicros), 0n)),
    platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
  };
}
