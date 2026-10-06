// Opening an ad account's read client: the credential from the vault, the platform client configured from the
// product's settings, and (Google) the quota meter and the manager account. The dry run (M02/M03) and the sync
// stage (M04) share it.
import { type EntityType, type Platform, type ProductSettings } from '@ads/contracts';
import { GoogleAdsClient, GoogleReadClient, tokenProviderFor } from '@ads/connector-google';
import { MetaReadClient, actionTypesForEvents } from '@ads/connector-meta';
import type { Account, DbOrTx, Product } from '@ads/db';
import { get as vaultGet, type MasterKey } from '@ads/vault';
import { apiUsageMeter } from './quota.ts';

/** What each platform's sync reads: the entity types listed, and the levels with daily metrics. */
export const SYNC_LEVELS: Readonly<Record<Platform, { entities: EntityType[]; metrics: EntityType[] }>> = {
  meta: { entities: ['campaign', 'ad_group', 'ad'], metrics: ['campaign', 'ad_group', 'ad'] },
  google: { entities: ['budget', 'campaign', 'ad_group', 'keyword'], metrics: ['campaign', 'ad_group', 'keyword'] },
};

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
  // A route whose dataset isn't set up yet (null, D-076) still counts its event, but has no dataset to watch.
  const anyMeta = feedback.filter((r) => r.platform === 'meta');
  const datasetIds = [
    ...new Set(
      (routes.length > 0 ? routes : anyMeta).flatMap((r) => (r.destinationId === null ? [] : [r.destinationId])),
    ),
  ];
  if (datasetIds.length > 1)
    warnings.push(`several Meta datasets in the settings; the trust signals use ${datasetIds[0]}`);
  const [datasetId] = datasetIds;
  return datasetId === undefined ? { conversionActionTypes, warnings } : { conversionActionTypes, datasetId, warnings };
}

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
    if (r.destinationId === null) {
      warnings.push(
        `the Google route for "${r.stage}" has no conversion action id yet: platform conversions read as 0`,
      );
    } else if (/^\d{1,19}$/.test(r.destinationId)) conversionActionIds.push(r.destinationId);
    else warnings.push(`the Google route for "${r.stage}" has a destinationId that is not a conversion action id`);
  }
  return { conversionActionIds: [...new Set(conversionActionIds)], warnings };
}

/** The product-level warnings about a platform's read configuration (the same for every account). */
export const readConfigWarnings = (platform: Platform, settings: ProductSettings): string[] =>
  platform === 'meta' ? metaReadConfig(settings).warnings : googleReadConfig(settings).warnings;

export interface OpenClientDeps {
  db: DbOrTx;
  /** The worker's read key (`VAULT_READ_KEY`). */
  masterKey: MasterKey;
  /** Who reads the credential, for the vault's audit row. */
  process: 'worker' | 'cli';
  purpose: string;
  /** Replaces the network: the replayer in tests, the recorder with RECORD=1. */
  fetch?: typeof fetch;
  /** Google only: replaces the token endpoint's network (sign-in never goes through `fetch`, D-072). */
  tokenFetch?: typeof fetch;
  /** Google only: the soft cap on the day's operations (default GOOGLE_SYNC_SOFT_CAP). */
  googleSoftCap?: number;
  now: () => Date;
}

export type ReadClient = MetaReadClient | GoogleReadClient;

export interface OpenedClient {
  client: ReadClient;
  /** HTTP requests made so far; for Google each one is an API operation. */
  requests(): number;
  /** Google: the manager account used as `login-customer-id` (null = direct access). */
  loginCustomerId?: string | null;
  /** Google: a manager found because none was stored. The sync stores it; the dry run only says so. */
  foundManager?: string;
}

/** Opens the read client for one account. Reading the credential writes the vault's audit row; a Google client
 *  also meters every request in `api_usage` first (BLUEPRINT §5.7 "Quota"). */
export async function openReadClient(deps: OpenClientDeps, product: Product, account: Account): Promise<OpenedClient> {
  const { db, masterKey, now } = deps;
  const credential = await vaultGet(
    db,
    account.id,
    'read',
    { process: deps.process, purpose: deps.purpose },
    masterKey,
  );
  if (account.platform === 'meta') {
    const config = metaReadConfig(product.settings);
    const client = MetaReadClient.fromCredential(credential, {
      conversionActionTypes: config.conversionActionTypes,
      ...(config.datasetId === undefined ? {} : { datasetId: config.datasetId }),
      now,
      ...(deps.fetch === undefined ? {} : { graph: { fetch: deps.fetch } }),
    });
    return { client, requests: () => client.graph.requestCount };
  }

  const config = googleReadConfig(product.settings);
  const tokens = tokenProviderFor(credential, deps.tokenFetch === undefined ? {} : { fetch: deps.tokenFetch });
  const quota = apiUsageMeter({
    db,
    accountExternalId: account.externalId,
    now,
    ...(deps.googleSoftCap === undefined ? {} : { cap: deps.googleSoftCap }),
  });
  const apis: GoogleAdsClient[] = [];
  const clientFor = (loginCustomerId: string | undefined): GoogleReadClient => {
    const api = new GoogleAdsClient({
      tokens,
      quota,
      ...(loginCustomerId === undefined ? {} : { loginCustomerId }),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
    apis.push(api);
    return new GoogleReadClient({ api, conversionActionIds: config.conversionActionIds, now });
  };
  const requests = (): number => apis.reduce((n, a) => n + a.requestCount, 0);
  let login = account.loginCustomerId ?? undefined;
  let client = clientFor(login);
  let foundManager: string | undefined;
  if (login === undefined) {
    // No manager stored: find the one the identity reaches this account through (manager → client).
    try {
      login = await client.findManagerFor(account.externalId);
    } catch (error) {
      // The lookup was metered: say how many requests it made (`requestsOf`).
      throw Object.assign(error as Error, { requests: requests() });
    }
    if (login !== undefined) {
      foundManager = login;
      client = clientFor(login);
    }
  }
  return {
    client,
    requests,
    loginCustomerId: login ?? null,
    ...(foundManager === undefined ? {} : { foundManager }),
  };
}
