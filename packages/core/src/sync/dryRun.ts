// `ads sync --dry` (M02): read everything a sync would store, and report it without writing anything.
// M04 turns this into the real sync stage (upserts, snapshots on change, drift, trust checks).
import { type EntityType, type ProductSettings, localDate, minusDays } from '@ads/contracts';
import { MetaReadClient, actionTypesForEvents } from '@ads/connector-meta';
import { NotFoundError, findProductBySlug, listAccounts } from '@ads/db';
import { get as vaultGet } from '@ads/vault';
import { dryRunGoogle } from './dryRunGoogle.ts';
import {
  type AccountReport,
  type DrySyncInput,
  type DrySyncReport,
  type LevelSummary,
  SYNC_WINDOW_DAYS,
  TRUST_WINDOW_DAYS,
  countBy,
  summariseLevel,
} from './report.ts';

export * from './report.ts';

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

/** Reads every active account of the product on one platform, and summarises what a sync would store.
 *  Writes nothing except the vault's audit row for the credential read. Names are never printed. */
export async function dryRunSync(input: DrySyncInput): Promise<DrySyncReport> {
  const { db, productSlug, platform, masterKey } = input;
  const now = input.now ?? (() => new Date());
  const product = await findProductBySlug(db, productSlug);
  if (!product) throw new NotFoundError('product', productSlug);
  if (platform === 'google') return dryRunGoogle(input, product);

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
  for (const level of META_LEVELS)
    metrics[level] = summariseLevel(await client.getMetricsDaily(accountId, window, level));

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
