// The sync stage (BLUEPRINT §5.7, M04): for each active account of a product, read the platform into the
// repositories. Entities are upserted, a snapshot is stored only when it changed (with drift in the same
// transaction), the trailing 28 days of metrics are re-downloaded and upserted, Google search terms and click ids
// are stored, and the trust signals are kept on the account so the trust stage needs no API call.
// Every step is idempotent, so a crashed sync simply runs again. Search terms and entity names are untrusted
// platform text: stored as data, never printed in summaries, never treated as instructions (invariant 5).
import {
  type AdEntityRecord,
  EntityNotFoundError,
  type EntityRef,
  type EntityType,
  type Platform,
  localDate,
  minusDays,
} from '@ads/contracts';
import { snapshotOf as googleSnapshotOf } from '@ads/connector-google';
import { snapshotOf as metaSnapshotOf } from '@ads/connector-meta';
import {
  type Account,
  type AdEntity,
  type AdEntityInput,
  type MetricsInput,
  type Product,
  latestSnapshot,
  listAccounts,
  listEntities,
  markAccountSyncFailed,
  markAccountSynced,
  setAccountLoginCustomerId,
  setClicksSyncedThrough,
  upsertAccount,
  upsertAdEntity,
  upsertGoogleClicks,
  upsertMetricsDaily,
  upsertSearchTerms,
} from '@ads/db';
import {
  type OpenClientDeps,
  type OpenedClient,
  type ReadClient,
  SYNC_LEVELS,
  openReadClient,
  readConfigWarnings,
} from './clients.ts';
import { attributesOf, recordSnapshotAndDrift, refKey } from './drift.ts';
import { SYNC_WINDOW_DAYS, TRUST_WINDOW_DAYS } from './report.ts';

/** Google keeps click ids (`click_view`) for 90 days, one day per query (GOTCHAS). */
export const CLICK_LOOKBACK_DAYS = 90;
/** Entities read one by one per account and sync: known ones missing from a listing, and unknown ids in the
 *  metrics. More wait for the next sync. */
export const MAX_READS_BY_ID = 50;

/** Errors that mean "stop this account's sync now" even while reading a single entity. */
const STOP_ERRORS = new Set(['GoogleQuotaError', 'GoogleRateLimitError', 'GoogleAuthError', 'MetaRateLimitError']);

export type SyncDeps = Omit<OpenClientDeps, 'purpose'>;

export interface AccountSyncSummary {
  account: string;
  outcome: 'synced' | 'skipped' | 'error';
  detail?: string;
  /** listed: in the platform's listing; new: first seen; snapshots: stored because something changed;
   *  drift: drift events recorded; removed: missing from the listing and confirmed gone or removed. */
  entities?: { listed: number; new: number; snapshots: number; drift: number; removed: number };
  metricRows?: number;
  /** Google: search-term rows stored. */
  searchTerms?: number;
  /** Google: click-id days read and rows stored. */
  clickIds?: { days: number; rows: number };
  warnings?: string[];
  requests?: number;
  durationMs?: number;
}

export interface SyncStageResult {
  accounts: AccountSyncSummary[];
  warnings: string[];
}

/** The days whose click ids to read: from the last stored day (re-read, as clicks can arrive late) or 90 days
 *  back, to yesterday (today is incomplete). */
export function clickDaysToSync(syncedThrough: string | null, today: string): string[] {
  const earliest = minusDays(today, CLICK_LOOKBACK_DAYS - 1);
  const yesterday = minusDays(today, 1);
  const from = syncedThrough === null || syncedThrough < earliest ? earliest : syncedThrough;
  const days: string[] = [];
  for (let d = from; d <= yesterday; d = minusDays(d, -1)) days.push(d);
  return days;
}

const snapshotOf = (record: AdEntityRecord): Record<string, unknown> =>
  record.ref.platform === 'meta' ? metaSnapshotOf(record).snapshot : googleSnapshotOf(record).snapshot;

const entityInput = (account: Account, record: AdEntityRecord, parentId: string | null): AdEntityInput => ({
  productId: account.productId,
  accountId: account.id,
  platform: account.platform,
  type: record.ref.type,
  externalId: record.ref.externalId,
  parentId,
  name: record.name,
  status: record.status,
  rawStatus: record.rawStatus,
  dailyBudgetMicros: record.dailyBudgetMicros === null ? null : BigInt(record.dailyBudgetMicros),
  // Unknown counts as shared: this system never changes a shared budget (D-073).
  budgetShared: record.budgetShared ?? true,
  attributes: record.attributes ?? {},
});

/** An entity row refreshed from a by-id snapshot (which carries the tracked fields, not the parent or the other
 *  attributes: those are kept). */
function inputFromSnapshot(e: AdEntity, s: Record<string, unknown>): AdEntityInput {
  const str = (k: string): string | undefined => (typeof s[k] === 'string' ? s[k] : undefined);
  return {
    productId: e.productId,
    accountId: e.accountId,
    platform: e.platform,
    type: e.type,
    externalId: e.externalId,
    parentId: e.parentId,
    name: str('name') ?? e.name,
    status: str('status') ?? 'unknown',
    rawStatus: str('rawStatus') ?? e.rawStatus,
    dailyBudgetMicros: str('dailyBudgetMicros') === undefined ? null : BigInt(str('dailyBudgetMicros') as string),
    budgetShared: typeof s['budgetShared'] === 'boolean' ? s['budgetShared'] : e.budgetShared,
    attributes: attributesOf(e),
  };
}

/** Syncs every active account of the product. A failing account is recorded (`last_sync_error`) and the others
 *  carry on: the `data_fresh` trust check then judges how old its data is. `syncedSince` (a resumed cycle's start)
 *  skips the accounts this cycle already synced before it was interrupted. */
export async function syncStage(
  deps: SyncDeps,
  product: Product,
  opts: { syncedSince?: Date } = {},
): Promise<SyncStageResult> {
  const result: SyncStageResult = { accounts: [], warnings: [] };
  const accounts = await listAccounts(deps.db, product.id);
  if (accounts.length === 0) result.warnings.push(`no ad account is linked to ${product.slug}`);
  const configChecked = new Set<Platform>();

  for (const account of accounts) {
    const label = `${account.platform}:${account.externalId}`;
    if (account.status !== 'active') {
      result.accounts.push({ account: label, outcome: 'skipped', detail: `account is ${account.status}` });
      continue;
    }
    const since = opts.syncedSince;
    if (since && account.lastSyncedAt && account.lastSyncedAt >= since && account.lastSyncError === null) {
      result.accounts.push({ account: label, outcome: 'skipped', detail: 'already synced in this cycle' });
      continue;
    }
    if (!configChecked.has(account.platform)) {
      configChecked.add(account.platform);
      result.warnings.push(...readConfigWarnings(account.platform, product.settings));
    }
    const started = Date.now();
    let opened: OpenedClient | undefined;
    try {
      opened = await openReadClient({ ...deps, purpose: 'sync' }, product, account);
      result.accounts.push(await syncAccount(deps, account, opened, label));
    } catch (e) {
      const detail = (e as Error).message;
      await markAccountSyncFailed(deps.db, account.id, detail);
      result.accounts.push({ account: label, outcome: 'error', detail });
    }
    const last = result.accounts.at(-1);
    if (last) {
      last.durationMs = Date.now() - started;
      if (opened) last.requests = opened.requests();
    }
  }
  return result;
}

async function syncAccount(
  deps: SyncDeps,
  account: Account,
  opened: OpenedClient,
  label: string,
): Promise<AccountSyncSummary> {
  const { db } = deps;
  const { client } = opened;
  const info = await client.getAccountInfo(account.externalId);
  if ('manager' in info && info.manager)
    throw new Error(`${label} is a manager account: link its client account instead`);
  await upsertAccount(db, {
    productId: account.productId,
    platform: account.platform,
    externalId: account.externalId,
    name: info.name,
    timezone: info.timezone,
    currency: info.currency,
  });
  if (opened.foundManager !== undefined) await setAccountLoginCustomerId(db, account.id, opened.foundManager);

  // Metric days are the account's local days (the trust check compares its timezone with the product's).
  const today = localDate(deps.now(), info.timezone);
  const window = { from: minusDays(today, SYNC_WINDOW_DAYS - 1), to: today };
  const levels = SYNC_LEVELS[account.platform];
  const entities = await entityStore(deps, account, client);

  await entities.storeListing(await client.listEntities(account.externalId, levels.entities));
  await entities.confirmMissing(levels.entities);

  let metricRows = 0;
  for (const level of levels.metrics) {
    const rows: MetricsInput[] = [];
    for (const r of await client.getMetricsDaily(account.externalId, window, level)) {
      const adEntityId = await entities.idFor(r.ref);
      if (adEntityId === null) continue;
      rows.push({
        productId: account.productId,
        adEntityId,
        date: r.day,
        impressions: r.impressions,
        clicks: r.clicks,
        spendMicros: BigInt(r.spendMicros),
        platformConversions: String(r.platformConversions),
        platformConversionValueMicros: BigInt(r.platformConversionValueMicros ?? '0'),
      });
    }
    await upsertMetricsDaily(db, rows);
    metricRows += rows.length;
  }

  const summary: AccountSyncSummary = { account: label, outcome: 'synced', metricRows };
  if (client.platform === 'google') {
    const terms = [];
    for (const t of await client.getSearchTerms(account.externalId, window)) {
      const adGroupEntityId = entities.knownId(t.adGroup);
      if (adGroupEntityId === null) continue; // an ad group we don't have (no listing): its terms wait
      terms.push({
        productId: account.productId,
        adGroupEntityId,
        date: t.day,
        term: t.searchTerm, // untrusted platform text: data, never instructions (invariant 5)
        impressions: t.impressions,
        clicks: t.clicks,
        spendMicros: BigInt(t.spendMicros),
        // The search-terms read has no conversions yet (KPI conversions per term need a query segmented by
        // conversion action); SnapPool's are 0 until uploads start anyway. M06a adds them with its detector.
        conversions: '0',
      });
    }
    await upsertSearchTerms(db, terms);
    summary.searchTerms = terms.length;

    const days = clickDaysToSync(account.clicksSyncedThrough, today);
    let rows = 0;
    for (const day of days) {
      const clicks = await client.getClickIds(account.externalId, day);
      await upsertGoogleClicks(
        db,
        clicks.map((c) => ({
          productId: account.productId,
          gclid: c.gclid,
          date: c.day,
          campaignExternalId: c.campaignId,
          adGroupExternalId: c.adGroupId,
        })),
      );
      await setClicksSyncedThrough(db, account.id, day);
      rows += clicks.length;
    }
    summary.clickIds = { days: days.length, rows };
  }

  const range = { from: minusDays(today, TRUST_WINDOW_DAYS - 1), to: today };
  const trust = await client.trustSignals(account.externalId, range);
  const at = deps.now();
  await markAccountSynced(db, account.id, { at, trustSignals: { ...trust, range, readAt: at.toISOString() } });

  summary.entities = entities.counts;
  if (entities.warnings.length > 0) summary.warnings = entities.warnings;
  return summary;
}

/** The account's entities during one sync: what was known before, what the listing returned, and the reads by id
 *  (bounded by MAX_READS_BY_ID). */
async function entityStore(deps: SyncDeps, account: Account, client: ReadClient) {
  const { db } = deps;
  const ref = (type: EntityType, externalId: string): EntityRef => ({
    platform: account.platform,
    accountId: account.externalId,
    type,
    externalId,
  });
  const before = await listEntities(db, account.productId, { accountId: account.id });
  const known = new Map(before.map((e) => [refKey(ref(e.type, e.externalId)), e]));
  const ids = new Map([...known].map(([k, e]) => [k, e.id]));
  const listed = new Set<string>();
  const unreadable = new Set<string>();
  const counts = { listed: 0, new: 0, snapshots: 0, drift: 0, removed: 0 };
  const warnings: string[] = [];
  let reads = 0;
  let skippedReads = 0;

  const store = async (input: AdEntityInput, entityRef: EntityRef, snapshot: Record<string, unknown>) => {
    const key = refKey(entityRef);
    const entity = await upsertAdEntity(db, input, deps.now());
    if (!ids.has(key)) counts.new++;
    ids.set(key, entity.id);
    const result = await recordSnapshotAndDrift(db, { entity, ref: entityRef, snapshot });
    if (result.stored) counts.snapshots++;
    counts.drift += result.drift.length;
    return entity;
  };

  /** One entity read by id: its snapshot, 'gone' if the platform says it doesn't exist, or null if it can't be
   *  read now (the budget is spent, or an error that isn't worth stopping the sync for). */
  const readById = async (entityRef: EntityRef): Promise<Record<string, unknown> | 'gone' | null> => {
    if (reads >= MAX_READS_BY_ID) {
      skippedReads++;
      return null;
    }
    reads++;
    try {
      return (await client.snapshot(entityRef)).snapshot;
    } catch (e) {
      if (e instanceof EntityNotFoundError) return 'gone';
      if (STOP_ERRORS.has((e as Error).name)) throw e;
      warnings.push(`could not read ${entityRef.type} ${entityRef.externalId}: ${(e as Error).message}`);
      return null;
    }
  };

  return {
    counts,
    get warnings(): string[] {
      return skippedReads === 0
        ? warnings
        : [
            ...warnings,
            `${skippedReads} entities wait for the next sync (more than ${MAX_READS_BY_ID} to read one by one)`,
          ];
    },

    /** Upserts the listing, parents first, each with its snapshot and drift. */
    async storeListing(records: AdEntityRecord[]): Promise<void> {
      const order: EntityType[] = ['budget', 'campaign', 'ad_group', 'ad', 'keyword'];
      const sorted = [...records].sort((a, b) => order.indexOf(a.ref.type) - order.indexOf(b.ref.type));
      for (const r of sorted) {
        listed.add(refKey(r.ref));
        const parentId = r.parent === null ? null : (ids.get(refKey(r.parent)) ?? null);
        await store(entityInput(account, r, parentId), r.ref, snapshotOf(r));
      }
      counts.listed = sorted.length;
    },

    /** Known entities the listing left out (Meta's edges may omit archived and deleted objects, GOTCHAS) are read
     *  by id; one the platform says doesn't exist is recorded as removed. Either way drift is checked. */
    async confirmMissing(types: EntityType[]): Promise<void> {
      for (const e of before) {
        const entityRef = ref(e.type, e.externalId);
        if (!types.includes(e.type) || e.status === 'removed' || listed.has(refKey(entityRef))) continue;
        const read = await readById(entityRef);
        if (read === null) continue;
        let snapshot: Record<string, unknown>;
        if (read === 'gone') {
          const base = ((await latestSnapshot(db, e.id))?.snapshot as Record<string, unknown> | undefined) ?? {
            name: e.name,
            status: e.status,
            rawStatus: e.rawStatus,
          };
          snapshot = {
            ...base,
            status: 'removed',
            rawStatus: 'NOT_FOUND',
            ...('configuredStatus' in base ? { configuredStatus: 'NOT_FOUND' } : {}),
          };
        } else snapshot = read;
        const updated = await store(inputFromSnapshot(e, snapshot), entityRef, snapshot);
        if (updated.status === 'removed') counts.removed++;
      }
    },

    /** The entity id for a ref: known or listed, else read by id and stored (parent unknown until a listing
     *  includes it). Null if it can't be read: its rows wait for the next sync. */
    async idFor(entityRef: EntityRef): Promise<string | null> {
      const key = refKey(entityRef);
      const id = ids.get(key);
      if (id !== undefined) return id;
      if (unreadable.has(key)) return null;
      const read = await readById(entityRef);
      if (read === null || read === 'gone') {
        unreadable.add(key);
        return null;
      }
      const str = (k: string): string | undefined => (typeof read[k] === 'string' ? read[k] : undefined);
      const entity = await store(
        {
          productId: account.productId,
          accountId: account.id,
          platform: account.platform,
          type: entityRef.type,
          externalId: entityRef.externalId,
          parentId: null,
          name: str('name') ?? '',
          status: str('status') ?? 'unknown',
          rawStatus: str('rawStatus') ?? '',
          dailyBudgetMicros: str('dailyBudgetMicros') === undefined ? null : BigInt(str('dailyBudgetMicros') as string),
          budgetShared: typeof read['budgetShared'] === 'boolean' ? read['budgetShared'] : true,
        },
        entityRef,
        read,
      );
      return entity.id;
    },

    /** The id of a known or listed entity, without reading anything. */
    knownId(entityRef: EntityRef): string | null {
      return ids.get(refKey(entityRef)) ?? null;
    },
  };
}
