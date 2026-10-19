// What the dashboard reads and records (M10a). Its role reads most tables and may insert only the request columns
// of operator_requests (roles.sql), so recording is a plain insert naming exactly those columns: drizzle's insert
// lists every column of the table, which the dashboard's role isn't allowed to name. The worker processes the row.
import { OperatorRequest } from '@ads/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { NotFoundError } from '../errors.ts';
import { operatorRequests, packManifests, products, settingsHistory } from '../schema.ts';

/** The actor the dashboard records for a verified Access email: `web:<email>`, in lower case. */
export function webActor(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e)) throw new Error('not an email address');
  return `web:${e}`;
}

/** Records a dashboard request (channel `web`, actor from the verified email). Returns its id. */
export async function recordWebRequest(
  db: DbOrTx,
  input: { request: OperatorRequest; email: string },
): Promise<string> {
  const request = OperatorRequest.parse(input.request);
  const productId = 'productId' in request ? request.productId : null;
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into operator_requests (product_id, kind, payload, actor, channel)
        values (${productId}, ${request.kind}, ${JSON.stringify(request)}::jsonb, ${webActor(input.email)}, 'web')
        returning id`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert into operator_requests returned nothing');
  return id;
}

export interface RequestStatus {
  id: string;
  kind: string;
  status: 'queued' | 'done' | 'refused';
  result: Record<string, unknown> | null;
  createdAt: Date;
  processedAt: Date | null;
  /** The request's product's timezone, for showing its times; null for a global request (halt all). */
  timezone: string | null;
}

/** A request's status and the worker's verdict, for the page that polls it. */
export async function getRequestStatus(db: DbOrTx, id: string): Promise<RequestStatus> {
  const [row] = await db
    .select({
      id: operatorRequests.id,
      kind: operatorRequests.kind,
      status: operatorRequests.status,
      result: operatorRequests.result,
      createdAt: operatorRequests.createdAt,
      processedAt: operatorRequests.processedAt,
      timezone: products.timezone,
    })
    .from(operatorRequests)
    .leftJoin(products, eq(products.id, operatorRequests.productId))
    .where(eq(operatorRequests.id, id));
  if (!row) throw new NotFoundError('operator request', id);
  return { ...row, result: (row.result as Record<string, unknown> | null) ?? null };
}

export interface SettingsChange {
  version: number;
  settings: unknown;
  changedAt: Date;
  requestId: string | null;
  actor: string | null;
  channel: string | null;
}

/** A product's settings versions, newest first, each with who asked for it (null for the seed). The documents
 *  are returned as stored: the history shows old versions even if a later contract would reject them. */
export async function listSettingsChanges(db: DbOrTx, productId: string, limit = 100): Promise<SettingsChange[]> {
  return db
    .select({
      version: settingsHistory.version,
      settings: settingsHistory.settings,
      changedAt: settingsHistory.changedAt,
      requestId: settingsHistory.requestId,
      actor: operatorRequests.actor,
      channel: operatorRequests.channel,
    })
    .from(settingsHistory)
    .leftJoin(operatorRequests, eq(operatorRequests.id, settingsHistory.requestId))
    .where(eq(settingsHistory.productId, productId))
    .orderBy(desc(settingsHistory.version))
    .limit(limit);
}

/** The most recently published manifest of a pack (the worker publishes its installed packs at startup). */
export async function getLatestPackManifest(
  db: DbOrTx,
  packId: string,
): Promise<{ packId: string; version: string; manifest: Record<string, unknown>; publishedAt: Date } | null> {
  const [row] = await db
    .select()
    .from(packManifests)
    .where(eq(packManifests.packId, packId))
    .orderBy(desc(packManifests.publishedAt))
    .limit(1);
  return row ? { ...row, manifest: row.manifest as Record<string, unknown> } : null;
}
