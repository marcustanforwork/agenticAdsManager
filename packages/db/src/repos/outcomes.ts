// Outcomes (conversions pulled from each product by its pack's adapter) and their attribution and uploads.
import { microsFromJson, OutcomeEvent, type Platform } from '@ads/contracts';
import { and, asc, count, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { inBatches } from './batch.ts';
import { adEntities, outcomes, type ATTRIBUTION_METHODS } from '../schema.ts';

export type Outcome = typeof outcomes.$inferSelect;
export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number];

const rowsOf = (productId: string, events: OutcomeEvent[]) =>
  events.map((raw) => {
    const e = OutcomeEvent.parse(raw);
    return {
      productId,
      sourceId: e.sourceId,
      stage: e.stage,
      occurredAt: new Date(e.occurredAt),
      valueMicros: e.valueMicros !== undefined ? microsFromJson(e.valueMicros) : null,
      currency: e.currency ?? null,
      isTest: e.isTest,
      ids: e.ids,
      hashedContact: e.hashedContact ?? null,
      web: e.web ?? null,
    };
  });

/** Stores outcomes read from the product's source (M05a). A new one (product, source id, stage) is inserted. One
 *  already stored keeps what it had, except `is_test`, which follows the latest read: the source and the current
 *  test-traffic settings decide it, so a test domain added later still excludes the outcomes read again.
 *  Events are validated first; repeats of one key in `events` are stored once (the last wins). */
export async function upsertOutcomes(
  db: DbOrTx,
  productId: string,
  events: OutcomeEvent[],
): Promise<{ inserted: number; testFlagChanged: number }> {
  const byKey = new Map(rowsOf(productId, events).map((r) => [`${r.stage}\u0000${r.sourceId}`, r]));
  const out = { inserted: 0, testFlagChanged: 0 };
  await inBatches(db, [...byKey.values()], async (tx, batch) => {
    const rows = await tx
      .insert(outcomes)
      .values(batch)
      .onConflictDoUpdate({
        target: [outcomes.productId, outcomes.sourceId, outcomes.stage],
        set: { isTest: sql`excluded.is_test` },
        setWhere: sql`${outcomes.isTest} is distinct from excluded.is_test`,
      })
      // xmax = 0 only on a freshly inserted row version.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of rows) {
      if (r.inserted) out.inserted++;
      else out.testFlagChanged++;
    }
  });
  return out;
}

/** Inserts new outcomes; one already stored (same product, source id and stage) is left as it is.
 *  Returns the number of new rows. Events are validated against the contract first. */
export async function insertOutcomes(db: DbOrTx, productId: string, events: OutcomeEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const rows = rowsOf(productId, events);
  let inserted = 0;
  await inBatches(db, rows, async (tx, batch) => {
    const ids = await tx
      .insert(outcomes)
      .values(batch)
      .onConflictDoNothing({ target: [outcomes.productId, outcomes.sourceId, outcomes.stage] })
      .returning({ id: outcomes.id });
    inserted += ids.length;
  });
  return inserted;
}

export async function listOutcomes(
  db: DbOrTx,
  input: { productId: string; from: Date; to: Date; includeTest?: boolean },
): Promise<Outcome[]> {
  return db
    .select()
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        gte(outcomes.occurredAt, input.from),
        lt(outcomes.occurredAt, input.to),
        input.includeTest ? undefined : eq(outcomes.isTest, false),
      ),
    )
    .orderBy(asc(outcomes.occurredAt));
}

export async function listUnattributed(db: DbOrTx, productId: string, limit = 500): Promise<Outcome[]> {
  return db
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.productId, productId), isNull(outcomes.attributionMethod)))
    .orderBy(asc(outcomes.occurredAt))
    .limit(limit);
}

/** The outcomes to attribute (M05b): every one not attributed yet, and those found unattributable (`none`) that
 *  occurred since `retrySince` (their click id or campaign may arrive with a later sync). New ones come first, so
 *  retries can never crowd them out of a batch; then oldest first. */
export async function listAttributionCandidates(
  db: DbOrTx,
  input: { productId: string; retrySince: Date; limit?: number },
): Promise<Outcome[]> {
  return db
    .select()
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        or(
          isNull(outcomes.attributionMethod),
          and(eq(outcomes.attributionMethod, 'none'), gte(outcomes.occurredAt, input.retrySince)),
        ),
      ),
    )
    .orderBy(sql`(${outcomes.attributionMethod} is null) desc`, asc(outcomes.occurredAt), asc(outcomes.id))
    .limit(input.limit ?? 5000);
}

/** Records many attributions, one update per (method, entity). */
export async function setAttributions(
  db: DbOrTx,
  rows: { outcomeId: string; entityId: string | null; method: AttributionMethod }[],
): Promise<void> {
  const groups = new Map<string, { entityId: string | null; method: AttributionMethod; ids: string[] }>();
  for (const r of rows) {
    const key = `${r.method}\u0000${r.entityId ?? ''}`;
    const group = groups.get(key) ?? { entityId: r.entityId, method: r.method, ids: [] };
    group.ids.push(r.outcomeId);
    groups.set(key, group);
  }
  for (const g of groups.values()) {
    await inBatches(db, g.ids, (tx, ids) =>
      tx
        .update(outcomes)
        .set({ attributedEntityId: g.entityId, attributionMethod: g.method })
        .where(inArray(outcomes.id, ids)),
    );
  }
}

export async function setAttribution(
  db: DbOrTx,
  input: { outcomeId: string; entityId: string | null; method: AttributionMethod },
): Promise<void> {
  await db
    .update(outcomes)
    .set({ attributedEntityId: input.entityId, attributionMethod: input.method })
    .where(eq(outcomes.id, input.outcomeId));
}

/** Marks outcomes as uploaded to a platform. Only rows not yet marked are touched; returns how many were. */
export async function markFedBack(db: DbOrTx, platform: Platform, outcomeIds: string[], at = new Date()) {
  if (outcomeIds.length === 0) return 0;
  const column = platform === 'google' ? outcomes.fedBackGoogleAt : outcomes.fedBackMetaAt;
  const set = platform === 'google' ? { fedBackGoogleAt: at } : { fedBackMetaAt: at };
  const rows = await db
    .update(outcomes)
    .set(set)
    .where(and(inArray(outcomes.id, outcomeIds), isNull(column)))
    .returning({ id: outcomes.id });
  return rows.length;
}

/** How many outcomes of `stage` were uploaded to `platform` since `since` (test outcomes are never uploaded). The
 *  `tracking_active` trust check uses it: when nothing was uploaded, the platform's zero conversions say nothing
 *  about tracking (D-075). */
export async function countFedBackSince(
  db: DbOrTx,
  input: { productId: string; platform: Platform; stage: string; since: Date },
): Promise<number> {
  const column = input.platform === 'google' ? outcomes.fedBackGoogleAt : outcomes.fedBackMetaAt;
  const [row] = await db
    .select({ n: count() })
    .from(outcomes)
    .where(and(eq(outcomes.productId, input.productId), eq(outcomes.stage, input.stage), gte(column, input.since)));
  return row?.n ?? 0;
}

export interface StageCount {
  stage: string;
  /** Outcomes that count (not test traffic). */
  outcomes: number;
  /** Test and internal outcomes, never counted (D-059). */
  test: number;
}

/** Outcomes per stage in [from, to), real and test counted apart. Stages without outcomes are absent. */
export async function countOutcomesByStage(
  db: DbOrTx,
  input: { productId: string; from: Date; to: Date },
): Promise<StageCount[]> {
  const rows = await db
    .select({
      stage: outcomes.stage,
      outcomes: sql<number>`(count(*) filter (where not ${outcomes.isTest}))::int`,
      test: sql<number>`(count(*) filter (where ${outcomes.isTest}))::int`,
    })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        gte(outcomes.occurredAt, input.from),
        lt(outcomes.occurredAt, input.to),
      ),
    )
    .groupBy(outcomes.stage)
    .orderBy(outcomes.stage);
  return rows;
}

export interface AttributionCount {
  stage: string;
  /** The attribution method, or null while not attributed yet. */
  method: AttributionMethod | null;
  outcomes: number;
}

/** Outcomes (test traffic apart) in [from, to) per stage and attribution method: the attribution rate (M05b). */
export async function countAttribution(
  db: DbOrTx,
  input: { productId: string; from: Date; to: Date },
): Promise<AttributionCount[]> {
  return db
    .select({ stage: outcomes.stage, method: outcomes.attributionMethod, outcomes: sql<number>`count(*)::int` })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        eq(outcomes.isTest, false),
        gte(outcomes.occurredAt, input.from),
        lt(outcomes.occurredAt, input.to),
      ),
    )
    .groupBy(outcomes.stage, outcomes.attributionMethod)
    .orderBy(outcomes.stage, outcomes.attributionMethod);
}

/** The ids that tie an outcome to an ad click (ClickAndPlatformIds without the utm values, and without `fbp`, the
 *  Meta browser cookie any visitor of a site with the pixel gets): what the `id_capture` trust check looks for. */
export const CAPTURED_ID_KEYS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'fbc',
  'googleCampaignId',
  'googleAdGroupId',
  'metaCampaignId',
  'metaAdSetId',
  'metaAdId',
] as const;

/** Outcomes of `stage` in [from, to), test traffic apart: how many, and how many carry a click or platform id
 *  (the `id_capture` trust check, M05b). */
export async function countIdCapture(
  db: DbOrTx,
  input: { productId: string; stage: string; from: Date; to: Date },
): Promise<{ outcomes: number; withIds: number }> {
  const keys = sql.join(
    CAPTURED_ID_KEYS.map((k) => sql`${k}`),
    sql`, `,
  );
  const [row] = await db
    .select({
      outcomes: sql<number>`count(*)::int`,
      withIds: sql<number>`(count(*) filter (where ${outcomes.ids} ?| array[${keys}]::text[]))::int`,
    })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        eq(outcomes.stage, input.stage),
        eq(outcomes.isTest, false),
        gte(outcomes.occurredAt, input.from),
        lt(outcomes.occurredAt, input.to),
      ),
    );
  return { outcomes: row?.outcomes ?? 0, withIds: row?.withIds ?? 0 };
}

/** Outcomes of `stage` on the days `from`..`to` (inclusive, `YYYY-MM-DD` in `timeZone`), test traffic apart,
 *  attributed to a campaign of `accountId`: the `attribution_gap` trust check compares them with the platform's
 *  own conversions over the same account days (M05b). */
export async function countAttributedToAccount(
  db: DbOrTx,
  input: { productId: string; accountId: string; stage: string; from: string; to: string; timeZone: string },
): Promise<number> {
  const day = sql`(${outcomes.occurredAt} at time zone ${input.timeZone})::date`;
  const [row] = await db
    .select({ n: count() })
    .from(outcomes)
    .innerJoin(adEntities, eq(adEntities.id, outcomes.attributedEntityId))
    .where(
      and(
        eq(outcomes.productId, input.productId),
        eq(outcomes.stage, input.stage),
        eq(outcomes.isTest, false),
        eq(adEntities.accountId, input.accountId),
        sql`${day} between ${input.from}::date and ${input.to}::date`,
      ),
    );
  return row?.n ?? 0;
}
