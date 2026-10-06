// `ads sync --dry` (M02, M03): read everything a sync would store, and report it as counts, writing nothing but
// the vault's audit row and (Google) the quota meter. It opens accounts like the sync stage (`clients.ts`).
import { type EntityType, localDate, minusDays } from '@ads/contracts';
import type { MetaReadClient } from '@ads/connector-meta';
import { NotFoundError, findProductBySlug, listAccounts } from '@ads/db';
import { type OpenedClient, SYNC_LEVELS, openReadClient, readConfigWarnings } from './clients.ts';
import { readGoogleAccount } from './dryRunGoogle.ts';
import { requestsOf } from './stage.ts';
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

/** Reads every active account of the product on one platform, and summarises what a sync would store.
 *  Names are never printed. */
export async function dryRunSync(input: DrySyncInput): Promise<DrySyncReport> {
  const { db, productSlug, platform, masterKey } = input;
  const now = input.now ?? (() => new Date());
  const product = await findProductBySlug(db, productSlug);
  if (!product) throw new NotFoundError('product', productSlug);

  const report: DrySyncReport = {
    product: productSlug,
    platform,
    dryRun: true,
    warnings: readConfigWarnings(platform, product.settings),
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
    let opened: OpenedClient | undefined;
    try {
      opened = await openReadClient(
        {
          db,
          masterKey,
          process: 'cli',
          purpose: 'sync --dry',
          now,
          ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
          ...(input.tokenFetch === undefined ? {} : { tokenFetch: input.tokenFetch }),
          ...(input.googleSoftCap === undefined ? {} : { googleSoftCap: input.googleSoftCap }),
        },
        product,
        account,
      );
      if (opened.foundManager !== undefined) {
        report.warnings.push(
          `${label} is reached through manager ${opened.foundManager}; store it with: ads accounts link --product ${productSlug} --platform google --account ${account.externalId} --manager ${opened.foundManager}`,
        );
      }
      const { client } = opened;
      report.accounts.push(
        client.platform === 'meta'
          ? await readMetaAccount(client, account.externalId, label, product.timezone, now())
          : {
              ...(await readGoogleAccount(client, account.externalId, label, product.timezone, now())),
              loginCustomerId: opened.loginCustomerId ?? null,
            },
      );
    } catch (e) {
      const requests = requestsOf(e);
      report.accounts.push({
        account: label,
        outcome: 'error',
        detail: (e as Error).message,
        ...(requests === undefined ? {} : { requests }),
      });
    }
    const last = report.accounts.at(-1);
    if (last) {
      last.durationMs = Date.now() - started;
      if (opened) last.requests = opened.requests();
    }
  }
  return report;
}

async function readMetaAccount(
  client: MetaReadClient,
  accountId: string,
  label: string,
  productTimezone: string,
  now: Date,
): Promise<AccountReport> {
  const info = await client.getAccountInfo(accountId);
  const today = localDate(now, info.timezone);
  const window = { from: minusDays(today, SYNC_WINDOW_DAYS - 1), to: today };
  const levels = SYNC_LEVELS.meta;

  const entities = await client.listEntities(accountId, levels.entities);
  const metrics: Partial<Record<EntityType, LevelSummary>> = {};
  for (const level of levels.metrics)
    metrics[level] = summariseLevel(await client.getMetricsDaily(accountId, window, level));

  const trust = await client.trustSignals(accountId, { from: minusDays(today, TRUST_WINDOW_DAYS - 1), to: today });

  return {
    account: label,
    outcome: 'read',
    timezone: info.timezone,
    currency: info.currency,
    timezoneMatchesProduct: info.timezone === productTimezone,
    window,
    entities: Object.fromEntries(levels.entities.map((t) => [t, countBy(entities, t)])),
    // One snapshot per entity on a first sync; the sync stage then stores one only when the hash changes.
    snapshots: entities.length,
    metrics,
    trust: { ...trust },
  };
}
