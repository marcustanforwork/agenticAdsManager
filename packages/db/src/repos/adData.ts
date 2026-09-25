// What's in the ad accounts: accounts, ad entities, snapshots, daily metrics, search terms, Google clicks.
import { hashOf, type EntityRef, type Platform } from '@ads/contracts';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { NotFoundError } from '../errors.ts';
import { addDecimals, inBatches } from './batch.ts';
import {
  accounts,
  adEntities,
  adEntitySnapshots,
  googleClicks,
  metricsDaily,
  searchTerms,
  type ACCOUNT_STATUSES,
  type ENTITY_TYPES,
} from '../schema.ts';

// ── Accounts ──────────────────────────────────────────────────────────────────────────────────

export type Account = typeof accounts.$inferSelect;

/** Links an ad account to a product, or updates its reported name, timezone and currency. */
export async function upsertAccount(
  db: DbOrTx,
  input: {
    productId: string;
    platform: Platform;
    externalId: string;
    name?: string | null;
    timezone?: string | null;
    currency?: string | null;
  },
): Promise<Account> {
  const reported = { name: input.name ?? null, timezone: input.timezone ?? null, currency: input.currency ?? null };
  const [row] = await db
    .insert(accounts)
    .values({ productId: input.productId, platform: input.platform, externalId: input.externalId, ...reported })
    // setWhere: another product's row is never touched; the upsert then returns nothing.
    .onConflictDoUpdate({
      target: [accounts.platform, accounts.externalId],
      set: reported,
      setWhere: eq(accounts.productId, input.productId),
    })
    .returning();
  if (!row) throw new Error(`account ${input.platform}:${input.externalId} belongs to another product`);
  return row;
}

export async function findAccount(db: DbOrTx, platform: Platform, externalId: string): Promise<Account | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.platform, platform), eq(accounts.externalId, externalId)));
  return row ?? null;
}

export async function listAccounts(db: DbOrTx, productId: string): Promise<Account[]> {
  return db.select().from(accounts).where(eq(accounts.productId, productId)).orderBy(accounts.platform);
}

export async function setAccountStatus(
  db: DbOrTx,
  id: string,
  status: (typeof ACCOUNT_STATUSES)[number],
): Promise<void> {
  const rows = await db.update(accounts).set({ status }).where(eq(accounts.id, id)).returning({ id: accounts.id });
  if (rows.length === 0) throw new NotFoundError('account', id);
}

export async function markAccountSynced(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db.update(accounts).set({ lastSyncedAt: at }).where(eq(accounts.id, id));
}

// ── Ad entities ───────────────────────────────────────────────────────────────────────────────

export type AdEntity = typeof adEntities.$inferSelect;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface AdEntityInput {
  productId: string;
  accountId: string;
  platform: Platform;
  type: EntityType;
  externalId: string;
  parentId?: string | null;
  name: string;
  status: string;
  rawStatus: string;
  dailyBudgetMicros?: bigint | null;
  budgetShared?: boolean;
  offeringId?: string | null;
  attributes?: Record<string, unknown>;
  createdByUs?: boolean;
}

/** Inserts or refreshes an entity by (account, type, external id). `firstSeenAt`, `offeringId` and
 *  `createdByUs` are kept from the first insert unless given. */
export async function upsertAdEntity(db: DbOrTx, input: AdEntityInput, syncedAt: Date = new Date()): Promise<AdEntity> {
  // An entity's account must be this product's, on the same platform: refs never cross products.
  const [account] = await db
    .select({ productId: accounts.productId, platform: accounts.platform })
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  if (!account) throw new NotFoundError('account', input.accountId);
  if (account.productId !== input.productId || account.platform !== input.platform) {
    throw new Error(`account ${input.accountId} is not a ${input.platform} account of product ${input.productId}`);
  }
  const refreshed = {
    parentId: input.parentId ?? null,
    name: input.name,
    status: input.status,
    rawStatus: input.rawStatus,
    dailyBudgetMicros: input.dailyBudgetMicros ?? null,
    budgetShared: input.budgetShared ?? false,
    attributes: input.attributes ?? {},
    lastSyncedAt: syncedAt,
    ...(input.offeringId !== undefined ? { offeringId: input.offeringId } : {}),
    ...(input.createdByUs !== undefined ? { createdByUs: input.createdByUs } : {}),
  };
  const [row] = await db
    .insert(adEntities)
    .values({
      productId: input.productId,
      accountId: input.accountId,
      platform: input.platform,
      type: input.type,
      externalId: input.externalId,
      ...refreshed,
    })
    .onConflictDoUpdate({
      target: [adEntities.accountId, adEntities.type, adEntities.externalId],
      set: refreshed,
      setWhere: eq(adEntities.productId, input.productId),
    })
    .returning();
  if (!row) throw new Error(`ad entity ${input.externalId} belongs to another product`);
  return row;
}

/** Finds the entity an EntityRef points at, only within `productId` (a ref from elsewhere never crosses products). */
export async function findEntityByRef(db: DbOrTx, productId: string, ref: EntityRef): Promise<AdEntity | null> {
  const [row] = await db
    .select({ entity: adEntities })
    .from(adEntities)
    .innerJoin(accounts, eq(accounts.id, adEntities.accountId))
    .where(
      and(
        eq(adEntities.productId, productId),
        eq(accounts.platform, ref.platform),
        eq(accounts.externalId, ref.accountId),
        eq(adEntities.type, ref.type),
        eq(adEntities.externalId, ref.externalId),
      ),
    );
  return row?.entity ?? null;
}

export async function getEntity(db: DbOrTx, id: string): Promise<AdEntity> {
  const [row] = await db.select().from(adEntities).where(eq(adEntities.id, id));
  if (!row) throw new NotFoundError('ad entity', id);
  return row;
}

export async function listEntities(
  db: DbOrTx,
  productId: string,
  filter: { accountId?: string; type?: EntityType } = {},
): Promise<AdEntity[]> {
  return db
    .select()
    .from(adEntities)
    .where(
      and(
        eq(adEntities.productId, productId),
        filter.accountId !== undefined ? eq(adEntities.accountId, filter.accountId) : undefined,
        filter.type !== undefined ? eq(adEntities.type, filter.type) : undefined,
      ),
    )
    .orderBy(adEntities.type, adEntities.externalId);
}

// ── Snapshots: stored only when the hash changes ──────────────────────────────────────────────

export type Snapshot = typeof adEntitySnapshots.$inferSelect;

export async function latestSnapshot(db: DbOrTx, adEntityId: string): Promise<Snapshot | null> {
  const [row] = await db
    .select()
    .from(adEntitySnapshots)
    .where(eq(adEntitySnapshots.adEntityId, adEntityId))
    .orderBy(desc(adEntitySnapshots.takenAt), desc(adEntitySnapshots.id))
    .limit(1);
  return row ?? null;
}

/** Stores the snapshot (hash = hashOf(snapshot)) unless it equals the latest one.
 *  Returns whether a row was written. Concurrent writers for the same entity are serialised. */
export async function recordSnapshot(
  db: DbOrTx,
  input: { productId: string; adEntityId: string; snapshot: Record<string, unknown>; takenAt?: Date },
): Promise<{ stored: boolean; hash: string }> {
  const hash = hashOf(input.snapshot);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${adEntities} where ${adEntities.id} = ${input.adEntityId} for update`);
    const latest = await latestSnapshot(tx, input.adEntityId);
    if (latest?.hash === hash) return { stored: false, hash };
    await tx.insert(adEntitySnapshots).values({
      productId: input.productId,
      adEntityId: input.adEntityId,
      snapshot: input.snapshot,
      hash,
      // clock_timestamp(), not now(): snapshots taken in one transaction still get distinct, ordered times.
      takenAt: input.takenAt ?? sql`clock_timestamp()`,
    });
    return { stored: true, hash };
  });
}

// ── Daily metrics: the trailing window is re-downloaded and upserted (BLUEPRINT §5.7) ──────────

export type MetricsDaily = typeof metricsDaily.$inferSelect;

export interface MetricsInput {
  productId: string;
  adEntityId: string;
  date: string; // YYYY-MM-DD, the account's local day
  impressions: number;
  clicks: number;
  spendMicros: bigint;
  platformConversions: string; // decimal string: the platform's own (possibly fractional) count
  platformConversionValueMicros?: bigint;
}

/** Upserts rows; an existing row is overwritten, and `restated_at` moves only if a value changed. */
export async function upsertMetricsDaily(db: DbOrTx, rows: MetricsInput[]): Promise<void> {
  if (rows.length === 0) return;
  // One row per (entity, day): a connector must aggregate segmented rows first. Postgres would reject the
  // whole statement anyway ("cannot affect row a second time"); this names the offending key.
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.adEntityId}|${r.date}`;
    if (seen.has(key)) throw new Error(`duplicate metrics row for entity ${r.adEntityId} on ${r.date}`);
    seen.add(key);
  }
  const m = metricsDaily;
  const changed = sql`(${m.impressions}, ${m.clicks}, ${m.spendMicros}, ${m.platformConversions}, ${m.platformConversionValueMicros})
    is distinct from (excluded.impressions, excluded.clicks, excluded.spend_micros, excluded.platform_conversions,
    excluded.platform_conversion_value_micros)`;
  await inBatches(db, rows, (tx, batch) =>
    tx
      .insert(m)
      .values(batch.map((r) => ({ ...r, platformConversionValueMicros: r.platformConversionValueMicros ?? 0n })))
      .onConflictDoUpdate({
        target: [m.adEntityId, m.date],
        set: {
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          spendMicros: sql`excluded.spend_micros`,
          platformConversions: sql`excluded.platform_conversions`,
          platformConversionValueMicros: sql`excluded.platform_conversion_value_micros`,
          restatedAt: sql`case when ${changed} then now() else ${m.restatedAt} end`,
        },
      }),
  );
}

export async function getMetrics(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; adEntityId?: string },
): Promise<MetricsDaily[]> {
  return db
    .select()
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.productId, input.productId),
        gte(metricsDaily.date, input.from),
        lte(metricsDaily.date, input.to),
        input.adEntityId !== undefined ? eq(metricsDaily.adEntityId, input.adEntityId) : undefined,
      ),
    )
    .orderBy(metricsDaily.adEntityId, metricsDaily.date);
}

// ── Search terms (Google). The term is untrusted platform text: data, never instructions. ─────

export type SearchTerm = typeof searchTerms.$inferSelect;

/** Rows with the same (ad group, day, term) are summed first: Google reports a term once per matched keyword. */
export async function upsertSearchTerms(db: DbOrTx, rows: (typeof searchTerms.$inferInsert)[]): Promise<void> {
  if (rows.length === 0) return;
  const merged = new Map<string, typeof searchTerms.$inferInsert>();
  for (const r of rows) {
    const key = JSON.stringify([r.adGroupEntityId, r.date, r.term]);
    const prev = merged.get(key);
    merged.set(
      key,
      prev
        ? {
            ...prev,
            impressions: (prev.impressions ?? 0) + (r.impressions ?? 0),
            clicks: (prev.clicks ?? 0) + (r.clicks ?? 0),
            spendMicros: (prev.spendMicros ?? 0n) + (r.spendMicros ?? 0n),
            conversions: addDecimals(prev.conversions, r.conversions),
          }
        : r,
    );
  }
  await inBatches(db, [...merged.values()], (tx, batch) =>
    tx
      .insert(searchTerms)
      .values(batch)
      .onConflictDoUpdate({
        target: [searchTerms.adGroupEntityId, searchTerms.date, searchTerms.term],
        set: {
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          spendMicros: sql`excluded.spend_micros`,
          conversions: sql`excluded.conversions`,
        },
      }),
  );
}

export async function getSearchTerms(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; adGroupEntityId?: string },
): Promise<SearchTerm[]> {
  return db
    .select()
    .from(searchTerms)
    .where(
      and(
        eq(searchTerms.productId, input.productId),
        gte(searchTerms.date, input.from),
        lte(searchTerms.date, input.to),
        input.adGroupEntityId !== undefined ? eq(searchTerms.adGroupEntityId, input.adGroupEntityId) : undefined,
      ),
    )
    .orderBy(searchTerms.date, searchTerms.term);
}

// ── Google clicks (gclid → campaign) ──────────────────────────────────────────────────────────

export async function upsertGoogleClicks(db: DbOrTx, rows: (typeof googleClicks.$inferInsert)[]): Promise<void> {
  if (rows.length === 0) return;
  await inBatches(db, rows, (tx, batch) =>
    tx.insert(googleClicks).values(batch).onConflictDoNothing({ target: googleClicks.gclid }),
  );
}

export async function findGoogleClick(db: DbOrTx, productId: string, gclid: string) {
  const [row] = await db
    .select()
    .from(googleClicks)
    .where(and(eq(googleClicks.productId, productId), eq(googleClicks.gclid, gclid)));
  return row ?? null;
}
