// `ads sync --platform google --dry` (M03): what a Google sync would store, as counts. The loop is `dryRunSync`.
import { localDate, minusDays, type EntityType } from '@ads/contracts';
import type { GoogleReadClient } from '@ads/connector-google';
import { SYNC_LEVELS } from './clients.ts';
import {
  type AccountReport,
  type LevelSummary,
  SYNC_WINDOW_DAYS,
  TRUST_WINDOW_DAYS,
  countBy,
  summariseLevel,
} from './report.ts';

export async function readGoogleAccount(
  client: GoogleReadClient,
  accountId: string,
  label: string,
  productTimezone: string,
  now: Date,
): Promise<AccountReport> {
  const info = await client.getAccountInfo(accountId);
  if (info.manager) throw new Error(`${label} is a manager account: link its client account instead`);
  const today = localDate(now, info.timezone);
  const window = { from: minusDays(today, SYNC_WINDOW_DAYS - 1), to: today };
  const levels = SYNC_LEVELS.google;

  const entities = await client.listEntities(accountId, levels.entities);
  const metrics: Partial<Record<EntityType, LevelSummary>> = {};
  for (const level of levels.metrics)
    metrics[level] = summariseLevel(await client.getMetricsDaily(accountId, window, level));
  const terms = await client.getSearchTerms(accountId, window);
  const yesterday = minusDays(today, 1);
  const clicks = await client.getClickIds(accountId, yesterday);
  const trust = await client.trustSignals(accountId, { from: minusDays(today, TRUST_WINDOW_DAYS - 1), to: today });

  return {
    account: label,
    outcome: 'read',
    timezone: info.timezone,
    currency: info.currency,
    timezoneMatchesProduct: info.timezone === productTimezone,
    window,
    entities: Object.fromEntries(levels.entities.map((t) => [t, countBy(entities, t)])),
    sharedBudgets: entities.filter((e) => e.ref.type === 'budget' && e.budgetShared === true).length,
    // One snapshot per entity on a first sync; the sync stage then stores one only when the hash changes.
    snapshots: entities.length,
    metrics,
    searchTerms: { rows: terms.length, days: new Set(terms.map((r) => r.day)).size },
    clickIds: { day: yesterday, rows: clicks.length },
    trust: { ...trust },
  };
}
