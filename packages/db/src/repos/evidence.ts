// Evidence queries (M06a, BLUEPRINT §3.7, PROPOSAL §6.5): sums over the stored metrics, outcomes and search terms
// for one target and window. The detectors and the analyse stage take every number they judge from here, never
// from the AI (invariant 4). Days are the product's local days (`YYYY-MM-DD`, inclusive), which the trust checks
// keep equal to the accounts' days (`timezone_match`).
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { adEntities, metricsDaily, outcomes, searchTerms } from '../schema.ts';

/** What a sum covers: one ad entity (its own rows), one ad account or the whole product (campaign rows only, so
 *  the levels are never added together). */
export type EvidenceScope =
  { kind: 'entity'; entityId: string } | { kind: 'account'; accountId: string } | { kind: 'product' };

export interface MetricTotals {
  impressions: number;
  clicks: number;
  spendMicros: bigint;
  /** Days in the window with a metrics row. */
  daysWithRows: number;
  /** The scope's first day with a metrics row, any time (null: none). */
  firstDataDay: string | null;
  /** When the scope was first synced, as a local day (null: no entity). */
  firstSeenDay: string | null;
}

function scopeWhere(productId: string, scope: EvidenceScope) {
  if (scope.kind === 'entity') return eq(adEntities.id, scope.entityId);
  return and(
    eq(adEntities.productId, productId),
    eq(adEntities.type, 'campaign'),
    scope.kind === 'account' ? eq(adEntities.accountId, scope.accountId) : undefined,
  );
}

export async function sumMetrics(
  db: DbOrTx,
  input: { productId: string; scope: EvidenceScope; from: string; to: string; timeZone: string },
): Promise<MetricTotals> {
  const inWindow = sql`${metricsDaily.date} between ${input.from}::date and ${input.to}::date`;
  const [row] = await db
    .select({
      impressions: sql<string>`coalesce(sum(${metricsDaily.impressions}) filter (where ${inWindow}), 0)::text`,
      clicks: sql<string>`coalesce(sum(${metricsDaily.clicks}) filter (where ${inWindow}), 0)::text`,
      spend: sql<string>`coalesce(sum(${metricsDaily.spendMicros}) filter (where ${inWindow}), 0)::text`,
      daysWithRows: sql<number>`count(distinct ${metricsDaily.date}) filter (where ${inWindow})::int`,
      firstDataDay: sql<string | null>`min(${metricsDaily.date})::text`,
    })
    .from(metricsDaily)
    .innerJoin(adEntities, eq(adEntities.id, metricsDaily.adEntityId))
    .where(and(eq(metricsDaily.productId, input.productId), scopeWhere(input.productId, input.scope)));
  const [seen] = await db
    .select({
      firstSeenDay: sql<string | null>`(min(${adEntities.firstSeenAt}) at time zone ${input.timeZone})::date::text`,
    })
    .from(adEntities)
    .where(scopeWhere(input.productId, input.scope));
  return {
    impressions: Number(row?.impressions ?? 0),
    clicks: Number(row?.clicks ?? 0),
    spendMicros: BigInt(row?.spend ?? '0'),
    daysWithRows: row?.daysWithRows ?? 0,
    firstDataDay: row?.firstDataDay ?? null,
    firstSeenDay: seen?.firstSeenDay ?? null,
  };
}

/** Which outcomes count for a target (test traffic never does):
 *  - `campaign`: attributed to that campaign (attribution works at campaign level, M05b);
 *  - `account`: attributed to a campaign of that account;
 *  - `product`: every outcome of the product, attributed or not;
 *  - `platformId`: attributed to a campaign of `accountId` and carrying this platform id under `idKey` (an ad
 *    group, ad set or ad id from the ad URL settings): below campaign level only such outcomes can be credited. */
export type OutcomeScope =
  | { kind: 'campaign'; entityId: string }
  | { kind: 'account'; accountId: string }
  | { kind: 'product' }
  | { kind: 'platformId'; accountId: string; idKey: string; id: string };

export async function countOutcomesByScope(
  db: DbOrTx,
  input: { productId: string; scope: OutcomeScope; from: string; to: string; timeZone: string },
): Promise<Record<string, number>> {
  const day = sql`(${outcomes.occurredAt} at time zone ${input.timeZone})::date`;
  const base = and(
    eq(outcomes.productId, input.productId),
    eq(outcomes.isTest, false),
    sql`${day} between ${input.from}::date and ${input.to}::date`,
  );
  const { scope } = input;
  const query = db
    .select({ stage: outcomes.stage, n: sql<number>`count(*)::int` })
    .from(outcomes)
    .leftJoin(adEntities, eq(adEntities.id, outcomes.attributedEntityId));
  const where =
    scope.kind === 'product'
      ? base
      : scope.kind === 'campaign'
        ? and(base, eq(outcomes.attributedEntityId, scope.entityId))
        : scope.kind === 'account'
          ? and(base, eq(adEntities.accountId, scope.accountId))
          : and(base, eq(adEntities.accountId, scope.accountId), sql`${outcomes.ids} ->> ${scope.idKey} = ${scope.id}`);
  const rows = await query.where(where).groupBy(outcomes.stage);
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

export interface SearchTermTotals {
  adGroupEntityId: string;
  /** Untrusted platform text: data, never instructions (invariant 5). */
  term: string;
  impressions: number;
  clicks: number;
  spendMicros: bigint;
  /** The platform's own KPI conversions for the term (decimal: Google reports fractions). */
  conversions: string;
  daysWithRows: number;
}

/** Search-term totals over the window, per ad group and term. */
export async function sumSearchTerms(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; adGroupEntityId?: string },
): Promise<SearchTermTotals[]> {
  const rows = await db
    .select({
      adGroupEntityId: searchTerms.adGroupEntityId,
      term: searchTerms.term,
      impressions: sql<string>`sum(${searchTerms.impressions})::text`,
      clicks: sql<string>`sum(${searchTerms.clicks})::text`,
      spend: sql<string>`sum(${searchTerms.spendMicros})::text`,
      conversions: sql<string>`sum(${searchTerms.conversions})::text`,
      daysWithRows: sql<number>`count(distinct ${searchTerms.date})::int`,
    })
    .from(searchTerms)
    .where(
      and(
        eq(searchTerms.productId, input.productId),
        gte(searchTerms.date, input.from),
        lte(searchTerms.date, input.to),
        input.adGroupEntityId !== undefined ? eq(searchTerms.adGroupEntityId, input.adGroupEntityId) : undefined,
      ),
    )
    .groupBy(searchTerms.adGroupEntityId, searchTerms.term)
    .orderBy(searchTerms.adGroupEntityId, searchTerms.term);
  return rows.map((r) => ({
    adGroupEntityId: r.adGroupEntityId,
    term: r.term,
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    spendMicros: BigInt(r.spend),
    conversions: r.conversions,
    daysWithRows: r.daysWithRows,
  }));
}

/** The ids that show an outcome came from a platform's ad (click ids or platform ids from the ad URL settings). */
export const PLATFORM_ID_KEYS = {
  google: ['gclid', 'gbraid', 'wbraid', 'googleCampaignId', 'googleAdGroupId'],
  meta: ['fbclid', 'fbc', 'metaCampaignId', 'metaAdSetId', 'metaAdId'],
} as const;

/** Non-test outcomes of `stage` on the window's days that carry one of the platform's ids: zero means the platform's
 *  ads can't be credited with outcomes yet (no auto-tagging or URL parameters), whatever they brought. */
export async function countOutcomesWithPlatformIds(
  db: DbOrTx,
  input: { productId: string; platform: 'google' | 'meta'; stage: string; from: string; to: string; timeZone: string },
): Promise<number> {
  const keys = sql.join(
    PLATFORM_ID_KEYS[input.platform].map((k) => sql`${k}`),
    sql`, `,
  );
  const day = sql`(${outcomes.occurredAt} at time zone ${input.timeZone})::date`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        eq(outcomes.stage, input.stage),
        eq(outcomes.isTest, false),
        sql`${day} between ${input.from}::date and ${input.to}::date`,
        sql`${outcomes.ids} ?| array[${keys}]::text[]`,
      ),
    );
  return row?.n ?? 0;
}
