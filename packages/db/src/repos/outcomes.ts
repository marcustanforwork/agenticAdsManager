// Outcomes (conversions pulled from each product by its pack's adapter) and their attribution and uploads.
import { microsFromJson, OutcomeEvent, type Platform } from '@ads/contracts';
import { and, asc, count, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { inBatches } from './batch.ts';
import { outcomes, type ATTRIBUTION_METHODS } from '../schema.ts';

export type Outcome = typeof outcomes.$inferSelect;
export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number];

/** Inserts new outcomes; one already stored (same product, source id and stage) is left as it is.
 *  Returns the number of new rows. Events are validated against the contract first. */
export async function insertOutcomes(db: DbOrTx, productId: string, events: OutcomeEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const rows = events.map((raw) => {
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
    };
  });
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
