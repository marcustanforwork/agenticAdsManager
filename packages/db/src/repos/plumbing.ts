// Briefs, operator requests, notifications, drift events, system flags and API usage.
import { OperatorRequest, type Platform } from '@ads/contracts';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
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

export async function markBriefSent(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db.update(briefs).set({ sentAt: at }).where(eq(briefs.id, id));
}

/** Marcus's feedback (the Phase 0 gate). The latest answer wins. */
export async function setBriefFeedback(
  db: DbOrTx,
  input: { briefId: string; useful: boolean; newInfo: boolean },
): Promise<void> {
  const rows = await db
    .update(briefs)
    .set({ feedbackUseful: input.useful, feedbackNewInfo: input.newInfo })
    .where(eq(briefs.id, input.briefId))
    .returning({ id: briefs.id });
  if (rows.length === 0) throw new NotFoundError('brief', input.briefId);
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

export async function listUnsentNotifications(db: DbOrTx, limit = 50): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(isNull(notifications.sentAt))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationSent(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db
    .update(notifications)
    .set({ sentAt: at })
    .where(and(eq(notifications.id, id), isNull(notifications.sentAt)));
}

// ── Drift: changes made outside this system ───────────────────────────────────────────────────

export type DriftEvent = typeof driftEvents.$inferSelect;

export async function recordDrift(
  db: DbOrTx,
  input: { productId: string; adEntityId: string; field: string; expected: unknown; observed: unknown },
): Promise<DriftEvent> {
  const [row] = await db.insert(driftEvents).values(input).returning();
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

export async function acknowledgeDrift(db: DbOrTx, id: string, at: Date = new Date()): Promise<void> {
  await db
    .update(driftEvents)
    .set({ acknowledgedAt: at })
    .where(and(eq(driftEvents.id, id), isNull(driftEvents.acknowledgedAt)));
}

// ── System flags (GLOBAL) ─────────────────────────────────────────────────────────────────────

export const WRITES_ENABLED = 'writes_enabled';

export async function getFlag(db: DbOrTx, key: string): Promise<unknown> {
  const [row] = await db.select({ value: systemFlags.value }).from(systemFlags).where(eq(systemFlags.key, key));
  return row?.value;
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
