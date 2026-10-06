// `ads sync --platform google --dry` (M03): read everything a Google sync would store, and report it as counts.
// Every request counts itself in `api_usage` first (the quota meter); that's the only write besides the vault's
// audit row. M04 turns this into the real sync stage.
import { type EntityType, type ProductSettings, localDate, minusDays } from '@ads/contracts';
import { GoogleAdsClient, GoogleReadClient, tokenProviderFor } from '@ads/connector-google';
import { type Product, listAccounts } from '@ads/db';
import { get as vaultGet } from '@ads/vault';
import { apiUsageMeter } from './quota.ts';
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

const GOOGLE_ENTITIES: EntityType[] = ['campaign', 'ad_group', 'keyword', 'budget'];
const GOOGLE_LEVELS: EntityType[] = ['campaign', 'ad_group', 'keyword'];

/** How the Google client is configured from a product's settings: platform conversions count the conversion
 *  actions of the **primary KPI stage** only (as for Meta, D-069). Problems become warnings, not failures. */
export function googleReadConfig(settings: ProductSettings): { conversionActionIds: string[]; warnings: string[] } {
  const { feedback, primaryKpiStage } = settings.outcomes;
  const routes = feedback.filter((r) => r.platform === 'google' && r.stage === primaryKpiStage);
  const warnings: string[] = [];
  if (routes.length === 0) {
    warnings.push(
      `no Google route for the KPI stage "${primaryKpiStage}" in the settings: platform conversions read as 0`,
    );
  }
  const conversionActionIds: string[] = [];
  for (const r of routes) {
    if (/^\d{1,19}$/.test(r.destinationId)) conversionActionIds.push(r.destinationId);
    else warnings.push(`the Google route for "${r.stage}" has a destinationId that is not a conversion action id`);
  }
  return { conversionActionIds: [...new Set(conversionActionIds)], warnings };
}

export async function dryRunGoogle(input: DrySyncInput, product: Product): Promise<DrySyncReport> {
  const { db, masterKey } = input;
  const now = input.now ?? (() => new Date());
  const config = googleReadConfig(product.settings);
  const report: DrySyncReport = {
    product: input.productSlug,
    platform: 'google',
    dryRun: true,
    warnings: config.warnings,
    accounts: [],
  };
  const accounts = (await listAccounts(db, product.id)).filter((a) => a.platform === 'google');
  if (accounts.length === 0) report.warnings.push(`no google account is linked to ${input.productSlug}`);

  for (const account of accounts) {
    const label = `google:${account.externalId}`;
    if (account.status !== 'active') {
      report.accounts.push({ account: label, outcome: 'skipped', detail: `account is ${account.status}` });
      continue;
    }
    const started = Date.now();
    const apis: GoogleAdsClient[] = [];
    try {
      const credential = await vaultGet(db, account.id, 'read', { process: 'cli', purpose: 'sync --dry' }, masterKey);
      const tokens = tokenProviderFor(credential, input.tokenFetch === undefined ? {} : { fetch: input.tokenFetch });
      const quota = apiUsageMeter({
        db,
        accountExternalId: account.externalId,
        now,
        ...(input.googleSoftCap === undefined ? {} : { cap: input.googleSoftCap }),
      });
      const clientFor = (loginCustomerId: string | undefined): GoogleReadClient => {
        const api = new GoogleAdsClient({
          tokens,
          quota,
          ...(loginCustomerId === undefined ? {} : { loginCustomerId }),
          ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
        });
        apis.push(api);
        return new GoogleReadClient({ api, conversionActionIds: config.conversionActionIds, now });
      };
      let login = account.loginCustomerId ?? undefined;
      let client = clientFor(login);
      if (login === undefined) {
        // No manager stored: find the one the identity reaches this account through (manager → client).
        login = await client.findManagerFor(account.externalId);
        if (login !== undefined) {
          report.warnings.push(
            `${label} is reached through manager ${login}; store it with: ads accounts link --platform google --account ${account.externalId} --manager ${login}`,
          );
          client = clientFor(login);
        }
      }
      const read = await readGoogleAccount(client, account.externalId, label, product.timezone, now());
      report.accounts.push({ ...read, loginCustomerId: login ?? null });
    } catch (e) {
      report.accounts.push({ account: label, outcome: 'error', detail: (e as Error).message });
    }
    const last = report.accounts.at(-1);
    if (last) {
      last.durationMs = Date.now() - started;
      if (apis.length > 0) last.requests = apis.reduce((n, a) => n + a.requestCount, 0);
    }
  }
  return report;
}

async function readGoogleAccount(
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

  const entities = await client.listEntities(accountId, GOOGLE_ENTITIES);
  const metrics: Partial<Record<EntityType, LevelSummary>> = {};
  for (const level of GOOGLE_LEVELS)
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
    entities: Object.fromEntries(GOOGLE_ENTITIES.map((t) => [t, countBy(entities, t)])),
    sharedBudgets: entities.filter((e) => e.ref.type === 'budget' && e.budgetShared === true).length,
    // One snapshot per entity on a first sync; M04 then stores one only when the hash changes.
    snapshots: entities.length,
    metrics,
    searchTerms: { rows: terms.length, days: new Set(terms.map((r) => r.day)).size },
    clickIds: { day: yesterday, rows: clicks.length },
    trust: { ...trust },
  };
}
