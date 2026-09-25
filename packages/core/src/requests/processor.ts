// The operator-request processor (BLUEPRINT §5.4): the one place that validates and acts on what a human asks
// for, from any surface. Each request is handled in one transaction: lock the row (SKIP LOCKED, so any worker
// replica can process), validate the schema, check the actor, check freshness, act, write `result`, and
// NOTIFY request_done. A refusal is recorded with its reason and changes nothing else.
import { GuardLoosenedError, OperatorRequest } from '@ads/contracts';
import {
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
import { HANDLERS, NOT_AVAILABLE_UNTIL, type RequestHandler } from './handlers.ts';
import { SettingsPatchError } from './settingsPatch.ts';

const { operatorRequests } = schema;

/** The channel request results are announced on; the payload is the request id. */
export const REQUEST_DONE_CHANNEL = 'request_done';

export interface RequestContext {
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

/** Errors that mean "refuse this request, with this reason". Anything else is a fault: the transaction rolls
 *  back, the request stays queued, and it is retried on the next pass. */
const isRefusal = (e: unknown): e is Error =>
  e instanceof RefusedError ||
  e instanceof StaleVersionError ||
  e instanceof NotFoundError ||
  e instanceof GuardLoosenedError ||
  e instanceof SettingsPatchError;

const refused = (reason: string, extra: RequestResult = {}): RequestOutcome => ({
  status: 'refused',
  result: { reason, ...extra },
});

async function decide(tx: Tx, row: OperatorRequestRow, ctx: RequestContext): Promise<RequestOutcome> {
  const parsed = OperatorRequest.safeParse(row.payload);
  if (!parsed.success) {
    return refused('invalid request', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  const request = parsed.data;
  if (request.kind !== row.kind) return refused(`the kind column (${row.kind}) does not match the request`);
  if (!ctx.actors.has(row.actor)) return refused('unknown actor');

  const handler = HANDLERS[request.kind] as RequestHandler<typeof request> | undefined;
  if (handler === undefined) {
    return refused(`not available yet (${NOT_AVAILABLE_UNTIL[request.kind] ?? 'a later milestone'})`);
  }
  try {
    // A savepoint, so a refusal part-way through leaves nothing behind.
    const result = await tx.transaction((sp) => handler(sp, request, row));
    return { status: 'done', result };
  } catch (error) {
    if (isRefusal(error)) return refused(error.message);
    throw error;
  }
}

/** Processes one queued request. Returns null if it's already processed or another worker holds it. */
export async function processRequest(db: Db, requestId: string, ctx: RequestContext): Promise<RequestOutcome | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(operatorRequests)
      .where(and(eq(operatorRequests.id, requestId), eq(operatorRequests.status, 'queued')))
      .for('update', { skipLocked: true });
    if (!row) return null;
    const outcome = await decide(tx, row, ctx);
    await completeOperatorRequest(tx, { id: row.id, status: outcome.status, result: outcome.result });
    await tx.execute(sql`select pg_notify(${REQUEST_DONE_CHANNEL}, ${row.id})`);
    return outcome;
  });
}

/** Drains the queue: processes queued requests until none is left or `limit` is reached.
 *  A request whose processing faults is left queued and logged, and the drain moves on to the next. */
export async function processQueuedRequests(
  db: Db,
  ctx: RequestContext,
  opts: { limit?: number; onFault?: (requestId: string | null, error: unknown) => void } = {},
): Promise<number> {
  const limit = opts.limit ?? 100;
  let processed = 0;
  const skip = new Set<string>();
  while (processed < limit) {
    let next: { id: string; outcome: RequestOutcome } | null;
    try {
      next = await processNextExcept(db, ctx, skip);
    } catch (error) {
      opts.onFault?.(error instanceof RequestFault ? error.requestId : null, error);
      if (error instanceof RequestFault) {
        skip.add(error.requestId);
        continue;
      }
      break;
    }
    if (next === null) break;
    processed++;
  }
  return processed;
}

class RequestFault extends Error {
  readonly requestId: string;
  constructor(requestId: string, cause: unknown) {
    super(`processing request ${requestId} failed`, { cause });
    this.name = 'RequestFault';
    this.requestId = requestId;
  }
}

async function processNextExcept(
  db: Db,
  ctx: RequestContext,
  skip: ReadonlySet<string>,
): Promise<{ id: string; outcome: RequestOutcome } | null> {
  const [candidate] = await db
    .select({ id: operatorRequests.id })
    .from(operatorRequests)
    .where(
      and(
        eq(operatorRequests.status, 'queued'),
        skip.size === 0 ? undefined : notInArray(operatorRequests.id, [...skip]),
      ),
    )
    .orderBy(asc(operatorRequests.createdAt))
    .limit(1);
  if (!candidate) return null;
  try {
    const outcome = await processRequest(db, candidate.id, ctx);
    return { id: candidate.id, outcome: outcome ?? { status: 'done', result: { handledElsewhere: true } } };
  } catch (error) {
    throw new RequestFault(candidate.id, error);
  }
}

/** The path for Telegram and the CLIs: record the request, then process it straight away, so the reply is
 *  instant. The dashboard only records (its role can't do more); a worker picks those up. */
export async function submitRequest(
  db: Db,
  input: { request: OperatorRequest; actor: string; channel: 'telegram' | 'web' | 'cli' },
  ctx: RequestContext,
): Promise<{ id: string; outcome: RequestOutcome }> {
  const row = await recordOperatorRequest(db, input);
  const outcome = await processRequest(db, row.id, ctx);
  if (outcome === null) throw new Error(`request ${row.id} was taken by another worker`);
  return { id: row.id, outcome };
}
