// The operator-request processor (BLUEPRINT §5.4): the one place that validates and acts on what a human asks
// for, from any surface. Each request is handled in one transaction: lock the row (SKIP LOCKED, so any worker
// replica can process), validate the schema, check the actor, check freshness, act, write `result`, and
// NOTIFY request_done. A refusal is recorded with its reason and changes nothing else. A fault (anything else that
// throws) rolls back and leaves the request queued for another try; after MAX_REQUEST_ATTEMPTS faults it is refused
// with its last error and Marcus is alerted (F2).
import { GuardLoosenedError, OperatorRequest } from '@ads/contracts';
import {
  InvalidSettingsError,
  addRequestAttempt,
  NotFoundError,
  RefusedError,
  StaleVersionError,
  completeOperatorRequest,
  recordOperatorRequest,
  schema,
  type Db,
  type OperatorRequestRow,
  type Tx,
} from '@ads/db';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { raiseRequestFailedAlert } from '../alerts.ts';
import { HANDLERS, NOT_AVAILABLE_UNTIL, type HandlerContext, type RequestHandler } from './handlers.ts';
import { FactsError } from './facts.ts';
import { SettingsPatchError } from './settingsPatch.ts';

const { operatorRequests } = schema;

/** The channel request results are announced on; the payload is the request id. */
export const REQUEST_DONE_CHANNEL = 'request_done';

export interface RequestContext extends HandlerContext {
  /** Who may make requests: Marcus's ids from config, e.g. `telegram:<user id>`, `web:<email>`, `cli:<name>`. */
  actors: ReadonlySet<string>;
}

export type RequestResult = Record<string, unknown>;
export interface RequestOutcome {
  status: 'done' | 'refused';
  result: RequestResult;
}

/** Reads the allowed actors from a comma-separated list (env `OPERATOR_ACTORS`; the ids live in Doppler). */
export function actorsFromEnv(text: string | undefined): ReadonlySet<string> {
  return new Set(
    (text ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );
}

/** How many faults a request gets before it is refused (F2). */
export const MAX_REQUEST_ATTEMPTS = 5;

/** Errors that mean "refuse this request, with this reason". Anything else is a fault: the transaction rolls
 *  back, the request stays queued, and it is retried on the next pass, up to MAX_REQUEST_ATTEMPTS. */
const isRefusal = (e: unknown): e is Error =>
  e instanceof RefusedError ||
  e instanceof InvalidSettingsError ||
  e instanceof StaleVersionError ||
  e instanceof NotFoundError ||
  e instanceof GuardLoosenedError ||
  e instanceof SettingsPatchError ||
  e instanceof FactsError;

const refused = (reason: string, extra: RequestResult = {}): RequestOutcome => ({
  status: 'refused',
  result: { reason, ...extra },
});

/** Binds the actor to who inserted the row (D-068, M10a). A role that can update requests (the worker, the owner
 *  running a CLI) may record any channel; any other role may record only web requests. A role that has the
 *  dashboard's privileges (inherits agent_dashboard) is never trusted, even if it can do more (a login created with
 *  extra privileges), unless it's a superuser. `inserted_by` is set by the database (`current_user`), never by the
 *  dashboard (roles.sql). An inserting role that no longer exists counts as untrusted. */
async function insertedByTrustedRole(tx: Tx, insertedBy: string): Promise<boolean> {
  const { rows } = await tx.execute<{ trusted: boolean }>(
    sql`select coalesce((select has_table_privilege(r.oid, 'operator_requests', 'UPDATE')
                                and (r.rolsuper or not pg_has_role(r.oid, 'agent_dashboard', 'USAGE'))
                           from pg_roles r where r.rolname = ${insertedBy}), false) as trusted`,
  );
  return rows[0]?.trusted === true;
}

async function decide(tx: Tx, row: OperatorRequestRow, ctx: RequestContext): Promise<RequestOutcome> {
  const parsed = OperatorRequest.safeParse(row.payload);
  if (!parsed.success) {
    return refused('invalid request', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  const request = parsed.data;
  if (request.kind !== row.kind) return refused(`the kind column (${row.kind}) does not match the request`);
  if (!(await insertedByTrustedRole(tx, row.insertedBy)) && (row.channel !== 'web' || !row.actor.startsWith('web:'))) {
    return refused('a request recorded by the dashboard must be a web request with a web: actor');
  }
  if (!ctx.actors.has(row.actor)) return refused('unknown actor');

  const handler = HANDLERS[request.kind] as RequestHandler<typeof request> | undefined;
  if (handler === undefined) {
    return refused(`not available yet (${NOT_AVAILABLE_UNTIL[request.kind] ?? 'a later milestone'})`);
  }
  try {
    // A savepoint, so a refusal part-way through leaves nothing behind.
    const result = await tx.transaction((sp) => handler(sp, request, row, ctx));
    return { status: 'done', result };
  } catch (error) {
    if (isRefusal(error)) return refused(error.message);
    throw error;
  }
}

/** Decides a request whose row this transaction has locked, records the result, and announces it at commit. */
async function handleLocked(tx: Tx, row: OperatorRequestRow, ctx: RequestContext): Promise<RequestOutcome> {
  const outcome = await decide(tx, row, ctx);
  await completeOperatorRequest(tx, { id: row.id, status: outcome.status, result: outcome.result });
  await tx.execute(sql`select pg_notify(${REQUEST_DONE_CHANNEL}, ${row.id})`);
  return outcome;
}

/** Counts a fault against a queued request, in its own transaction (the faulting one rolled back). At
 *  MAX_REQUEST_ATTEMPTS the request is refused with the error and Marcus is alerted; returns that outcome, or null
 *  while it has tries left (or is no longer queued). */
export async function recordRequestFault(db: Db, requestId: string, error: unknown): Promise<RequestOutcome | null> {
  return db.transaction(async (tx) => {
    const row = await addRequestAttempt(tx, requestId);
    if (row === null || row.attempts < MAX_REQUEST_ATTEMPTS) return null;
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
    const outcome = refused(`failed ${row.attempts} times on our side; the last error: ${message}`, {
      attempts: row.attempts,
    });
    await completeOperatorRequest(tx, { id: row.id, status: outcome.status, result: outcome.result });
    await raiseRequestFailedAlert(tx, {
      productId: row.productId,
      requestId: row.id,
      kind: row.kind,
      attempts: row.attempts,
      error: message,
    });
    await tx.execute(sql`select pg_notify(${REQUEST_DONE_CHANNEL}, ${row.id})`);
    return outcome;
  });
}

/** Processes one queued request. Returns null if it's already processed or another worker holds it. A fault is
 *  counted and thrown, except the last one, which returns the refusal. */
export async function processRequest(db: Db, requestId: string, ctx: RequestContext): Promise<RequestOutcome | null> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(operatorRequests)
        .where(and(eq(operatorRequests.id, requestId), eq(operatorRequests.status, 'queued')))
        .for('update', { skipLocked: true });
      return row ? handleLocked(tx, row, ctx) : null;
    });
  } catch (error) {
    const stopped = await recordRequestFault(db, requestId, error);
    if (stopped !== null) return stopped;
    throw error;
  }
}

/** Drains the queue: processes queued requests, oldest first, until none is left or `limit` is reached.
 *  Rows another worker holds are skipped (SKIP LOCKED), not waited for or counted. A request whose processing
 *  faults is reported through `onFault`, counted (`recordRequestFault`: refused at the limit, else left queued),
 *  and skipped for the rest of this pass. Returns how many requests this call processed (refusals at the limit
 *  included). */
export async function processQueuedRequests(
  db: Db,
  ctx: RequestContext,
  opts: { limit?: number; onFault?: (requestId: string | null, error: unknown) => void } = {},
): Promise<number> {
  const limit = opts.limit ?? 100;
  const skip = new Set<string>();
  let processed = 0;
  while (processed < limit) {
    let current: string | null = null;
    try {
      const handled = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(operatorRequests)
          .where(
            and(
              eq(operatorRequests.status, 'queued'),
              skip.size === 0 ? undefined : notInArray(operatorRequests.id, [...skip]),
            ),
          )
          .orderBy(asc(operatorRequests.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!row) return false;
        current = row.id;
        await handleLocked(tx, row, ctx);
        return true;
      });
      if (!handled) break;
      processed++;
    } catch (error) {
      opts.onFault?.(current, error);
      if (current === null) break; // couldn't even look: try again on the next pass
      skip.add(current);
      try {
        if ((await recordRequestFault(db, current, error)) !== null) processed++;
      } catch (countError) {
        opts.onFault?.(current, countError); // counted on a later pass instead
      }
    }
  }
  return processed;
}

/** The path for Telegram and the CLIs: record the request and process it in the same transaction, so the reply
 *  is instant and no other worker can pick it up half-way. The dashboard only records (its role can't do more);
 *  a worker picks those up. */
export async function submitRequest(
  db: Db,
  input: { request: OperatorRequest; actor: string; channel: 'telegram' | 'web' | 'cli' },
  ctx: RequestContext,
): Promise<{ id: string; outcome: RequestOutcome }> {
  return db.transaction(async (tx) => {
    const row = await recordOperatorRequest(tx, input);
    return { id: row.id, outcome: await handleLocked(tx, row, ctx) };
  });
}
