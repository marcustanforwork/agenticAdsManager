// Test support for evidence and detectors (M06a): a product with ad accounts, entities, daily metrics, search terms
// and outcomes written straight into the database, so every expected sum can be worked out by hand.
import type { OutcomeEvent, Platform, ProductSettings } from '@ads/contracts';
import {
  type AdEntity,
  type DbOrTx,
  type EntityType,
  createProduct,
  insertOutcomes,
  schema,
  setAttributions,
  upsertAccount,
  upsertAdEntity,
  upsertMetricsDaily,
  upsertSearchTerms,
} from '@ads/db';
import { TEST_SETTINGS } from '@ads/db/testing';
import { and, eq } from 'drizzle-orm';

export const TZ = 'Asia/Singapore';
/** 2026-10-08 09:00 in Singapore: the evidence windows end on 2026-10-07. */
export const NOW = new Date('2026-10-08T01:00:00Z');
export const S = (dollars: number): bigint => BigInt(Math.round(dollars * 100)) * 10_000n; // S$ → micros

export interface AdWorld {
  db: DbOrTx;
  productId: string;
  accounts: Record<Platform, string>;
  entity(
    platform: Platform,
    type: EntityType,
    externalId: string,
    opts?: { parent?: AdEntity; status?: string; firstSeen?: string; dailyBudget?: bigint },
  ): Promise<AdEntity>;
  metrics(entity: AdEntity, day: string, impressions: number, clicks: number, spend: bigint): Promise<void>;
  searchTerm(adGroup: AdEntity, day: string, term: string, m: [number, number, bigint, string]): Promise<void>;
  /** Adds outcomes, attributing each to `to` (null: unattributed). */
  outcome(
    sourceId: string,
    stage: string,
    occurredAt: string,
    to: AdEntity | null,
    opts?: { isTest?: boolean; ids?: OutcomeEvent['ids'] },
  ): Promise<void>;
}

export async function makeAdWorld(
  db: DbOrTx,
  opts: { slug?: string; settings?: ProductSettings; packId?: string } = {},
): Promise<AdWorld> {
  const product = await createProduct(db, {
    slug: opts.slug ?? 'snappool',
    name: 'SnapPool',
    packId: opts.packId ?? 'saas-snappool',
    timezone: TZ,
    settings: opts.settings ?? TEST_SETTINGS,
  });
  const google = await upsertAccount(db, {
    productId: product.id,
    platform: 'google',
    externalId: '1110001111',
    timezone: TZ,
    currency: 'SGD',
  });
  const meta = await upsertAccount(db, {
    productId: product.id,
    platform: 'meta',
    externalId: 'act_222',
    timezone: TZ,
    currency: 'SGD',
  });
  const accounts = { google: google.id, meta: meta.id };
  return {
    db,
    productId: product.id,
    accounts,
    async entity(platform, type, externalId, o = {}) {
      const e = await upsertAdEntity(db, {
        productId: product.id,
        accountId: accounts[platform],
        platform,
        type,
        externalId,
        parentId: o.parent?.id ?? null,
        name: `${type} ${externalId}`,
        status: o.status ?? 'active',
        rawStatus: o.status === 'paused' ? 'PAUSED' : 'ENABLED',
        dailyBudgetMicros: o.dailyBudget ?? null,
      });
      if (o.firstSeen === undefined) {
        // First seen long ago by default: entities aren't "new" unless a test says so.
        o.firstSeen = '2026-01-01';
      }
      const [row] = await db
        .update(schema.adEntities)
        .set({ firstSeenAt: new Date(`${o.firstSeen}T00:00:00+08:00`) })
        .where(eq(schema.adEntities.id, e.id))
        .returning();
      return row ?? e;
    },
    async metrics(entity, day, impressions, clicks, spend) {
      await upsertMetricsDaily(db, [
        {
          productId: product.id,
          adEntityId: entity.id,
          date: day,
          impressions,
          clicks,
          spendMicros: spend,
          platformConversions: '0',
        },
      ]);
    },
    async searchTerm(adGroup, day, term, [impressions, clicks, spend, conversions]) {
      await upsertSearchTerms(db, [
        {
          productId: product.id,
          adGroupEntityId: adGroup.id,
          date: day,
          term,
          impressions,
          clicks,
          spendMicros: spend,
          conversions,
        },
      ]);
    },
    async outcome(sourceId, stage, occurredAt, to, o = {}) {
      await insertOutcomes(db, product.id, [
        { sourceId, stage, occurredAt, isTest: o.isTest ?? false, ids: o.ids ?? {} },
      ]);
      const [stored] = await db
        .select({ id: schema.outcomes.id })
        .from(schema.outcomes)
        .where(
          and(
            eq(schema.outcomes.productId, product.id),
            eq(schema.outcomes.sourceId, sourceId),
            eq(schema.outcomes.stage, stage),
          ),
        );
      if (stored === undefined) throw new Error(`outcome ${sourceId}/${stage} was not stored`);
      await setAttributions(db, [
        { outcomeId: stored.id, entityId: to?.id ?? null, method: to === null ? 'none' : 'platform_ids' },
      ]);
    },
  };
}
