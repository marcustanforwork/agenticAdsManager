// Outcomes (conversions pulled from each product by its pack's adapter) and their attribution and uploads.
import { microsFromJson, OutcomeEvent, type Platform } from '@ads/contracts';
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
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
  const inserted = await db
    .insert(outcomes)
    .values(rows)
    .onConflictDoNothing({ target: [outcomes.productId, outcomes.sourceId, outcomes.stage] })
    .returning({ id: outcomes.id });
  return inserted.length;
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
