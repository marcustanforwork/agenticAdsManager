// `ads sync --dry` (M02): read everything a sync would store, and report it without writing anything.
// M04 turns this into the real sync stage (upserts, snapshots on change, drift, trust checks).
import {
  type AdEntityRecord,
  type EntityType,
  type Platform,
  type ProductSettings,
  localDate,
  microsToJson,
  minusDays,
} from '@ads/contracts';
import { MetaReadClient, actionTypesForEvents } from '@ads/connector-meta';
import { type DbOrTx, NotFoundError, findProductBySlug, listAccounts } from '@ads/db';
import { type MasterKey, get as vaultGet } from '@ads/vault';

/** BLUEPRINT §5.7: each sync re-downloads the trailing 28 days. */
export const SYNC_WINDOW_DAYS = 28;
/** BLUEPRINT §5.8: trust signals look at the last 7 days. */
export const TRUST_WINDOW_DAYS = 7;

const META_LEVELS: EntityType[] = ['campaign', 'ad_group', 'ad'];

/** How the Meta client is configured from a product's settings. Platform conversions count the Meta events of
 *  the **primary KPI stage** only (the attribution-gap check compares them with our outcomes of that stage), and
 *  the trust check watches that stage's dataset. Problems become warnings, not failures. */
export function metaReadConfig(settings: ProductSettings): {
  conversionActionTypes: string[];
  datasetId?: string;
  warnings: string[];
} {
  const { feedback, primaryKpiStage } = settings.outcomes;
  const routes = feedback.filter((r) => r.platform === 'meta' && r.stage === primaryKpiStage);
  const warnings: string[] = [];
  if (routes.length === 0) {
    warnings.push(
      `no Meta route for the KPI stage "${primaryKpiStage}" in the settings: platform conversions read as 0`,
    );
  }
  const events = routes.flatMap((r) => (r.eventName === undefined ? [] : [r.eventName]));
  if (routes.length > 0 && events.length === 0) {
    warnings.push(`the Meta route for "${primaryKpiStage}" has no eventName: platform conversions read as 0`);
  }
  let conversionActionTypes: string[] = [];
  try {
    conversionActionTypes = actionTypesForEvents(events);
  } catch (e) {
    warnings.push(`${(e as Error).message}: platform conversions read as 0`);
  }
  // The trust check watches the KPI stage's dataset, or else any Meta dataset in the settings: a configured
  // dataset is never left unwatched just because the KPI stage isn't routed to Meta.
  const anyMeta = feedback.filter((r) => r.platform === 'meta');
  const datasetIds = [...new Set((routes.length > 0 ? routes : anyMeta).map((r) => r.destinationId))];
  if (datasetIds.length > 1)
    warnings.push(`several Meta datasets in the settings; the trust signals use ${datasetIds[0]}`);
  const [datasetId] = datasetIds;
  return datasetId === undefined ? { conversionActionTypes, warnings } : { conversionActionTypes, datasetId, warnings };
}

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
  now?: () => Date;
}

function countBy(rows: AdEntityRecord[], type: EntityType) {
  const mine = rows.filter((r) => r.ref.type === type);
  const byStatus: Record<string, number> = {};
  for (const r of mine) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { total: mine.length, byStatus };
}

/** Reads every active account of the product on one platform, and summarises what a sync would store.
 *  Writes nothing except the vault's audit row for the credential read. Names are never printed. */
export async function dryRunSync(input: DrySyncInput): Promise<DrySyncReport> {
  const { db, productSlug, platform, masterKey } = input;
  const now = input.now ?? (() => new Date());
  if (platform !== 'meta') throw new Error('only --platform meta can sync yet; Google reads arrive in M03');
  const product = await findProductBySlug(db, productSlug);
  if (!product) throw new NotFoundError('product', productSlug);

  const config = metaReadConfig(product.settings);
  const report: DrySyncReport = {
    product: productSlug,
    platform,
    dryRun: true,
    warnings: config.warnings,
    accounts: [],
  };
  const accounts = (await listAccounts(db, product.id)).filter((a) => a.platform === platform);
  if (accounts.length === 0) report.warnings.push(`no ${platform} account is linked to ${productSlug}`);

  for (const account of accounts) {
    const label = `${account.platform}:${account.externalId}`;
    if (account.status !== 'active') {
      report.accounts.push({ account: label, outcome: 'skipped', detail: `account is ${account.status}` });
      continue;
    }
    const started = Date.now();
    let client: MetaReadClient | undefined;
    try {
      const credential = await vaultGet(db, account.id, 'read', { process: 'cli', purpose: 'sync --dry' }, masterKey);
      client = MetaReadClient.fromCredential(credential, {
        conversionActionTypes: config.conversionActionTypes,
        ...(config.datasetId === undefined ? {} : { datasetId: config.datasetId }),
        now,
        ...(input.fetch === undefined ? {} : { graph: { fetch: input.fetch } }),
      });
      report.accounts.push(await readAccount(client, account.externalId, label, product.timezone, now()));
    } catch (e) {
      report.accounts.push({ account: label, outcome: 'error', detail: (e as Error).message });
    }
    const last = report.accounts.at(-1);
    if (last) {
      last.durationMs = Date.now() - started;
      if (client) last.requests = client.graph.requestCount;
    }
  }
  return report;
}

async function readAccount(
  client: MetaReadClient,
  accountId: string,
  label: string,
  productTimezone: string,
  now: Date,
): Promise<AccountReport> {
  const info = await client.getAccountInfo(accountId);
  const today = localDate(now, info.timezone);
  const window = { from: minusDays(today, SYNC_WINDOW_DAYS - 1), to: today };

  const entities = await client.listEntities(accountId, META_LEVELS);

  const metrics: Partial<Record<EntityType, LevelSummary>> = {};
  for (const level of META_LEVELS) {
    const rows = await client.getMetricsDaily(accountId, window, level);
    metrics[level] = {
      rows: rows.length,
      days: new Set(rows.map((r) => r.day)).size,
      impressions: rows.reduce((n, r) => n + r.impressions, 0),
      clicks: rows.reduce((n, r) => n + r.clicks, 0),
      spendMicros: microsToJson(rows.reduce((n, r) => n + BigInt(r.spendMicros), 0n)),
      platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
    };
  }

  const trust = await client.trustSignals(accountId, { from: minusDays(today, TRUST_WINDOW_DAYS - 1), to: today });

  return {
    account: label,
    outcome: 'read',
    timezone: info.timezone,
    currency: info.currency,
    timezoneMatchesProduct: info.timezone === productTimezone,
    window,
    entities: Object.fromEntries(META_LEVELS.map((t) => [t, countBy(entities, t)])),
    // One snapshot per entity on a first sync; M04 then stores one only when the hash changes.
    snapshots: entities.length,
    metrics,
    trust: { ...trust },
  };
}
