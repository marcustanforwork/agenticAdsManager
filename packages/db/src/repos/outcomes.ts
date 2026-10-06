// Outcomes (conversions pulled from each product by its pack's adapter) and their attribution and uploads.
import { microsFromJson, OutcomeEvent, type Platform } from '@ads/contracts';
import { and, asc, count, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { inBatches } from './batch.ts';
import { outcomes, type ATTRIBUTION_METHODS } from '../schema.ts';

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
