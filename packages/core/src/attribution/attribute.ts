// Attribution (BLUEPRINT §5.12, M05b): each outcome is credited to the campaign its click came from. The methods
// are tried in order, and the first match wins:
//   1. platform_ids  ids captured from the landing URL, matched to the product's ad entities: a campaign id, else
//                    an ad group / ad set id or an ad id, credited to its campaign;
//   2. gclid_lookup  a Google click id found in google_clicks (clicks up to 90 days before the outcome);
//   3. utm           utm_campaign exactly equal to one campaign's id or name, on the platform utm_source names
//                    (a name two campaigns share matches nothing; a utm_source that isn't an ad platform, such as
//                    a newsletter, matches nothing);
//   4. none          unattributed: reported, never dropped.
// An outcome found `none` is tried again for RETRY_DAYS: its click id arrives with the next day's click sync
// (clicks are synced up to yesterday), and a new campaign appears with the next entity sync.
// Ids come from visitors' URLs (untrusted): they're only compared with stored ids, never interpreted.
import { ClickAndPlatformIds, type Platform, platformOfUtmSource } from '@ads/contracts';
import {
  type AdEntity,
  type AttributionMethod,
  type DbOrTx,
  type Outcome,
  findGoogleClicks,
  listAttributionCandidates,
  listEntities,
  setAttributions,
} from '@ads/db';

/** How long an unattributable outcome is tried again. */
export const ATTRIBUTION_RETRY_DAYS = 7;
/** A gclid matches clicks up to this many days before the outcome (Google keeps click views for 90 days). */
export const GCLID_LOOKBACK_DAYS = 90;
/** Outcomes attributed per run at most; the rest wait for the next run. */
export const ATTRIBUTION_BATCH = 5000;

const DAY_MS = 86_400_000;

export interface Attribution {
  method: AttributionMethod;
  /** The campaign's ad entity; null for `none`. */
  entityId: string | null;
}

/** What attribution matches against: the product's campaigns, ad groups and ads, and the stored clicks. */
export interface AttributionIndex {
  /** Entities by `<platform>:<type>:<external id>`. */
  entities: Map<string, AdEntity>;
  /** Entities by id (to walk up to the campaign). */
  byId: Map<string, AdEntity>;
  /** Campaigns by external id and by name (a utm_campaign value), several when names repeat. */
  campaignsByUtm: Map<string, AdEntity[]>;
  /** gclid → the click's day and campaign. */
  clicks: Map<string, { date: string; campaignExternalId: string }>;
}

/** An outcome's stored ids, checked (they were validated when stored; a bad row counts as no ids). */
const idsOf = (o: Pick<Outcome, 'ids'>): ClickAndPlatformIds => ClickAndPlatformIds.safeParse(o.ids).data ?? {};

const refKey = (platform: string, type: string, externalId: string): string => `${platform}:${type}:${externalId}`;

/** An entity's campaign: itself, or the first campaign above it. */
function campaignOf(entity: AdEntity | undefined, index: AttributionIndex): AdEntity | null {
  for (let e = entity, depth = 0; e !== undefined && depth < 4; depth++) {
    if (e.type === 'campaign') return e;
    e = e.parentId === null ? undefined : index.byId.get(e.parentId);
  }
  return null;
}

/** The platform ids in the order they're tried: campaign ids first, then the finer levels. */
const PLATFORM_ID_FIELDS: { field: keyof ClickAndPlatformIds; platform: Platform; type: string }[] = [
  { field: 'googleCampaignId', platform: 'google', type: 'campaign' },
  { field: 'metaCampaignId', platform: 'meta', type: 'campaign' },
  { field: 'googleAdGroupId', platform: 'google', type: 'ad_group' },
  { field: 'metaAdSetId', platform: 'meta', type: 'ad_group' },
  { field: 'metaAdId', platform: 'meta', type: 'ad' },
];

/** The attribution of one outcome (pure). */
export function attributionFor(
  outcome: { ids: ClickAndPlatformIds; occurredAt: Date },
  index: AttributionIndex,
): Attribution {
  const { ids } = outcome;
  for (const { field, platform, type } of PLATFORM_ID_FIELDS) {
    const id = ids[field];
    if (id === undefined) continue;
    const campaign = campaignOf(index.entities.get(refKey(platform, type, id)), index);
    if (campaign !== null) return { method: 'platform_ids', entityId: campaign.id };
  }

  if (ids.gclid !== undefined) {
    const click = index.clicks.get(ids.gclid);
    const clickDay = click === undefined ? NaN : Date.parse(`${click.date}T00:00:00Z`);
    // Day granularity (the click's day is the account's local day): a day of slack on each side.
    const inWindow =
      clickDay <= outcome.occurredAt.getTime() + DAY_MS &&
      clickDay >= outcome.occurredAt.getTime() - (GCLID_LOOKBACK_DAYS + 1) * DAY_MS;
    if (click !== undefined && inWindow) {
      const campaign = index.entities.get(refKey('google', 'campaign', click.campaignExternalId));
      if (campaign !== undefined) return { method: 'gclid_lookup', entityId: campaign.id };
    }
  }

  if (ids.utmCampaign !== undefined) {
    // Without a utm_source any platform's campaign may match; with one that isn't an ad platform, none may.
    const platform = platformOfUtmSource(ids.utmSource);
    if (ids.utmSource === undefined || platform !== undefined) {
      const matches = new Set(
        (index.campaignsByUtm.get(ids.utmCampaign) ?? [])
          .filter((e) => platform === undefined || e.platform === platform)
          .map((e) => e.id),
      );
      if (matches.size === 1) return { method: 'utm', entityId: [...matches][0] ?? null };
    }
  }

  return { method: 'none', entityId: null };
}

/** Loads what the candidates need: the product's campaigns, ad groups and ads, and their gclids' clicks. */
export async function attributionIndex(
  db: DbOrTx,
  productId: string,
  candidates: readonly Pick<Outcome, 'ids'>[],
): Promise<AttributionIndex> {
  const entities = new Map<string, AdEntity>();
  const byId = new Map<string, AdEntity>();
  const campaignsByUtm = new Map<string, AdEntity[]>();
  const addUtm = (key: string, e: AdEntity) => campaignsByUtm.set(key, [...(campaignsByUtm.get(key) ?? []), e]);
  for (const e of await listEntities(db, productId, { types: ['campaign', 'ad_group', 'ad'] })) {
    entities.set(refKey(e.platform, e.type, e.externalId), e);
    byId.set(e.id, e);
    if (e.type === 'campaign') {
      addUtm(e.externalId, e);
      if (e.name !== e.externalId) addUtm(e.name, e);
    }
  }
  const gclids = candidates.map((o) => idsOf(o).gclid).filter((g): g is string => g !== undefined);
  const clicks = new Map<string, { date: string; campaignExternalId: string }>();
  for (const [gclid, row] of await findGoogleClicks(db, productId, gclids)) {
    clicks.set(gclid, { date: row.date, campaignExternalId: row.campaignExternalId });
  }
  return { entities, byId, campaignsByUtm, clicks };
}

export interface AttributionRunSummary {
  /** Outcomes looked at: new ones, and recent ones found unattributable before. */
  checked: number;
  /** Newly credited to a campaign, by method. */
  attributed: { platform_ids: number; gclid_lookup: number; utm: number };
  /** Still unattributable. */
  none: number;
}

/** Attributes the product's new outcomes, and retries the recent unattributable ones. Idempotent. */
export async function attributeOutcomes(
  db: DbOrTx,
  input: { productId: string; now: Date; limit?: number },
): Promise<AttributionRunSummary> {
  const candidates = await listAttributionCandidates(db, {
    productId: input.productId,
    retrySince: new Date(input.now.getTime() - ATTRIBUTION_RETRY_DAYS * DAY_MS),
    limit: input.limit ?? ATTRIBUTION_BATCH,
  });
  const summary: AttributionRunSummary = {
    checked: candidates.length,
    attributed: { platform_ids: 0, gclid_lookup: 0, utm: 0 },
    none: 0,
  };
  if (candidates.length === 0) return summary;
  const index = await attributionIndex(db, input.productId, candidates);
  const changes: { outcomeId: string; entityId: string | null; method: AttributionMethod }[] = [];
  for (const o of candidates) {
    const result = attributionFor({ ids: idsOf(o), occurredAt: o.occurredAt }, index);
    if (result.method === 'none') summary.none++;
    else summary.attributed[result.method]++;
    // A retried outcome that is still unattributable needs no write.
    if (result.method !== 'none' || o.attributionMethod !== 'none') {
      changes.push({ outcomeId: o.id, entityId: result.entityId, method: result.method });
    }
  }
  await setAttributions(db, changes);
  return summary;
}
