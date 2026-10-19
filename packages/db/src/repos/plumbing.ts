// Briefs, operator requests, notifications, drift events, system flags and API usage.
import { OperatorRequest, type Platform } from '@ads/contracts';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { NotFoundError, RefusedError } from '../errors.ts';
import {
  apiUsage,
  briefs,
  driftEvents,
  notifications,
  operatorRequests,
  systemFlags,
  type BRIEF_KINDS,
  type REQUEST_CHANNELS,
} from '../schema.ts';

// ── Briefs ────────────────────────────────────────────────────────────────────────────────────

export type Brief = typeof briefs.$inferSelect;

export async function insertBrief(
  db: DbOrTx,
  input: {
    productId: string;
    cycleId?: string | null;
    kind: (typeof BRIEF_KINDS)[number];
    numbers: Record<string, unknown>; // every figure the brief may quote (from SQL)
    markdown: string;
    usedTemplateFallback?: boolean;
  },
): Promise<Brief> {
  const [row] = await db
    .insert(briefs)
    .values({ ...input, cycleId: input.cycleId ?? null })
    .returning();
  if (!row) throw new Error('insert into briefs returned nothing');
  return row;
}

export async function getBrief(db: DbOrTx, id: string): Promise<Brief> {
  const [row] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!row) throw new NotFoundError('brief', id);
  return row;
}

export async function listBriefs(db: DbOrTx, productId: string, limit = 10): Promise<Brief[]> {
  return db.select().from(briefs).where(eq(briefs.productId, productId)).orderBy(desc(briefs.createdAt)).limit(limit);
}

/** The cycle's brief, if its report stage already wrote one (resume). */
export async function findCycleBrief(db: DbOrTx, cycleId: string): Promise<Brief | null> {
  const [row] = await db
    .select()
    .from(briefs)
    .where(eq(briefs.cycleId, cycleId))
    .orderBy(desc(briefs.createdAt))
    .limit(1);
  return row ?? null;
}

export async function markBriefSent(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db.update(briefs).set({ sentAt: at }).where(eq(briefs.id, id));
}

/** Marcus's feedback (the Phase 0 gate). Only the answers given are stored (F1): an answer from one surface never
 *  overwrites the other answer given elsewhere. The latest answer to each wins. Returns both answers as stored. */
export async function setBriefFeedback(
  db: DbOrTx,
  input: { briefId: string; useful?: boolean | undefined; newInfo?: boolean | undefined },
): Promise<{ useful: boolean | null; newInfo: boolean | null }> {
  const set = {
    ...(input.useful === undefined ? {} : { feedbackUseful: input.useful }),
    ...(input.newInfo === undefined ? {} : { feedbackNewInfo: input.newInfo }),
  };
  if (Object.keys(set).length === 0) throw new Error('brief feedback: no answer given');
  const [row] = await db
    .update(briefs)
    .set(set)
    .where(eq(briefs.id, input.briefId))
    .returning({ useful: briefs.feedbackUseful, newInfo: briefs.feedbackNewInfo });
  if (row === undefined) throw new NotFoundError('brief', input.briefId);
  return row;
}

// ── Operator requests: surfaces record intent; one processor acts (BLUEPRINT §5.4, M01b) ───────

export type OperatorRequestRow = typeof operatorRequests.$inferSelect;

/** The product a request concerns, when the request itself names one (null = global or resolved later). */
function productOf(request: OperatorRequest): string | null {
  return 'productId' in request ? request.productId : null;
}

/** Records a request, validated against the contract. The payload's `kind` is copied to the kind column. */
export async function recordOperatorRequest(
  db: DbOrTx,
  input: { request: OperatorRequest; actor: string; channel: (typeof REQUEST_CHANNELS)[number] },
): Promise<OperatorRequestRow> {
  const request = OperatorRequest.parse(input.request);
  const [row] = await db
    .insert(operatorRequests)
    .values({
      productId: productOf(request),
      kind: request.kind,
      payload: request,
      actor: input.actor,
      channel: input.channel,
    })
    .returning();
  if (!row) throw new Error('insert into operator_requests returned nothing');
  return row;
}

export async function getOperatorRequest(db: DbOrTx, id: string): Promise<OperatorRequestRow> {
  const [row] = await db.select().from(operatorRequests).where(eq(operatorRequests.id, id));
  if (!row) throw new NotFoundError('operator request', id);
  return row;
}

export async function listQueuedRequests(db: DbOrTx, limit = 50): Promise<OperatorRequestRow[]> {
  return db
    .select()
    .from(operatorRequests)
    .where(eq(operatorRequests.status, 'queued'))
    .orderBy(asc(operatorRequests.createdAt))
    .limit(limit);
}

/** Closes a queued request as done or refused, with the result shown to Marcus. Closing twice is refused. */
export async function completeOperatorRequest(
  db: DbOrTx,
  input: { id: string; status: 'done' | 'refused'; result: Record<string, unknown> },
): Promise<void> {
  const rows = await db
    .update(operatorRequests)
    .set({ status: input.status, result: input.result, processedAt: sql`now()` })
    .where(and(eq(operatorRequests.id, input.id), eq(operatorRequests.status, 'queued')))
    .returning({ id: operatorRequests.id });
  if (rows.length === 0) {
    await getOperatorRequest(db, input.id);
    throw new RefusedError(`operator request ${input.id} was already processed`);
  }
}

// ── Notifications: an outbox; anyone writes, the worker's bot sends ────────────────────────────

export type Notification = typeof notifications.$inferSelect;

export async function enqueueNotification(
  db: DbOrTx,
  input: { productId?: string | null; kind: string; payload: Record<string, unknown> },
): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({ ...input, productId: input.productId ?? null })
    .returning();
  if (!row) throw new Error('insert into notifications returned nothing');
  return row;
}

/** A cycle's notification of `kind` (its payload carries `cycleId`), if one was queued: a resumed report stage
 *  doesn't queue a second digest or brief. */
export async function findCycleNotification(
  db: DbOrTx,
  input: { kind: string; cycleId: string },
): Promise<Notification | null> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.kind, input.kind), sql`${notifications.payload} ->> 'cycleId' = ${input.cycleId}`))
    .limit(1);
  return row ?? null;
}

/** The alert queued under `key` (its payload's `key`), sent or not: an alert is raised once per key (M09a). */
export async function findAlertNotification(db: DbOrTx, key: string): Promise<Notification | null> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.kind, 'alert'), sql`${notifications.payload} ->> 'key' = ${key}`))
    .limit(1);
  return row ?? null;
}

export async function listUnsentNotifications(db: DbOrTx, limit = 50): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(isNull(notifications.sentAt))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
}

/** Records how many of a notification's messages went out, so a retry after a failure part-way doesn't send the
 *  first ones again (kept in its payload as `sentChunks`). */
export async function setNotificationProgress(db: DbOrTx, id: string, sentChunks: number): Promise<void> {
  await db
    .update(notifications)
    .set({ payload: sql`${notifications.payload} || jsonb_build_object('sentChunks', ${sentChunks}::int)` })
    .where(and(eq(notifications.id, id), isNull(notifications.sentAt)));
}

export async function markNotificationSent(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db
    .update(notifications)
    .set({ sentAt: at })
    .where(and(eq(notifications.id, id), isNull(notifications.sentAt)));
}

// ── Drift: changes made outside this system ───────────────────────────────────────────────────

export type DriftEvent = typeof driftEvents.$inferSelect;

/** Records a drift event. `expected` and `observed` are stored as `{ "value": … }`: drizzle's jsonb reader would
 *  turn a bare numeric-looking string (a budget in micros, a name like "123") back into a number. */
export async function recordDrift(
  db: DbOrTx,
  input: { productId: string; adEntityId: string; field: string; expected: unknown; observed: unknown },
): Promise<DriftEvent> {
  const [row] = await db
    .insert(driftEvents)
    .values({ ...input, expected: { value: input.expected ?? null }, observed: { value: input.observed ?? null } })
    .returning();
  if (!row) throw new Error('insert into drift_events returned nothing');
  return row;
}

export async function listUnacknowledgedDrift(db: DbOrTx, productId: string): Promise<DriftEvent[]> {
  return db
    .select()
    .from(driftEvents)
    .where(and(eq(driftEvents.productId, productId), isNull(driftEvents.acknowledgedAt)))
    .orderBy(desc(driftEvents.detectedAt));
}

/** The product's drift detected at or after `since` (a cycle's sync), oldest first. */
export async function listDriftSince(db: DbOrTx, input: { productId: string; since: Date }): Promise<DriftEvent[]> {
  return db
    .select()
    .from(driftEvents)
    .where(and(eq(driftEvents.productId, input.productId), gte(driftEvents.detectedAt, input.since)))
    .orderBy(asc(driftEvents.detectedAt));
}

export async function acknowledgeDrift(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db
    .update(driftEvents)
    .set({ acknowledgedAt: at })
    .where(and(eq(driftEvents.id, id), isNull(driftEvents.acknowledgedAt)));
}

/** The database's clock. Times compared with database-stamped ones (`change_log.applied_at`) are taken from it,
 *  so a skew between the worker's clock and the database's can't reorder them. */
export async function databaseNow(db: DbOrTx): Promise<Date> {
  const result = await db.execute<{ now: string | Date }>(sql`select clock_timestamp() as now`);
  const value = result.rows[0]?.now;
  if (value === undefined) throw new Error('select clock_timestamp() returned nothing');
  return value instanceof Date ? value : new Date(value);
}

// ── System flags (GLOBAL) ─────────────────────────────────────────────────────────────────────

export const WRITES_ENABLED = 'writes_enabled';

export async function getFlag(db: DbOrTx, key: string): Promise<unknown> {
  // Read as text and parse once: Drizzle's jsonb reader re-parses string values, so a stored string "true"
  // would come back as boolean true (GOTCHAS). For the write switch that difference matters.
  const [row] = await db
    .select({ json: sql<string>`${systemFlags.value}::text` })
    .from(systemFlags)
    .where(eq(systemFlags.key, key));
  return row === undefined ? undefined : (JSON.parse(row.json) as unknown);
}

export async function setFlag(db: DbOrTx, key: string, value: unknown, requestId: string | null = null) {
  await db
    .insert(systemFlags)
    .values({ key, value, requestId })
    .onConflictDoUpdate({ target: systemFlags.key, set: { value, requestId, updatedAt: sql`now()` } });
}

/** The DB half of the write switch (BLUEPRINT §6 step 2). Anything but an explicit `true` means off. */
export async function writesEnabled(db: DbOrTx): Promise<boolean> {
  return (await getFlag(db, WRITES_ENABLED)) === true;
}

export const PHASE = 'phase';
export const MAX_PHASE = 5;

/** The system's phase (PROPOSAL §12, D-082): 0 until Marcus records the Phase 0 gate as passed. Anything but a
 *  whole number from 0 to 5 reads as 0, so a broken flag drafts nothing. */
export async function getPhase(db: DbOrTx): Promise<number> {
  const value = await getFlag(db, PHASE);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PHASE ? value : 0;
}

// ── API usage (GLOBAL quota accounting) ───────────────────────────────────────────────────────

/** Adds `operations` to today's count for an account and returns the new total. */
export async function addApiUsage(
  db: DbOrTx,
  input: { platform: Platform; accountExternalId: string; date: string; operations: number },
): Promise<number> {
  const [row] = await db
    .insert(apiUsage)
    .values(input)
    .onConflictDoUpdate({
      target: [apiUsage.platform, apiUsage.accountExternalId, apiUsage.date],
      set: { operations: sql`${apiUsage.operations} + excluded.operations` },
    })
    .returning({ operations: apiUsage.operations });
  if (!row) throw new Error('upsert into api_usage returned nothing');
  return row.operations;
}

/** Today's operations across every account of a platform: Google's Explorer quota belongs to the Cloud project,
 *  so the soft cap is checked against this total (D-072). */
export async function sumApiUsage(db: DbOrTx, input: { platform: Platform; date: string }): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${apiUsage.operations}), 0)::int` })
    .from(apiUsage)
    .where(and(eq(apiUsage.platform, input.platform), eq(apiUsage.date, input.date)));
  return row?.total ?? 0;
}

export async function getApiUsage(
  db: DbOrTx,
  input: { platform: Platform; accountExternalId: string; date: string },
): Promise<number> {
  const [row] = await db
    .select({ operations: apiUsage.operations })
    .from(apiUsage)
    .where(
      and(
        eq(apiUsage.platform, input.platform),
        eq(apiUsage.accountExternalId, input.accountExternalId),
        eq(apiUsage.date, input.date),
      ),
    );
  return row?.operations ?? 0;
}
