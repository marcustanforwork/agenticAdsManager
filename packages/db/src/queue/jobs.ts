// The job queue (BLUEPRINT §5.3): enqueue, claim, heartbeat, complete, fail with backoff, reclaim expired leases.
// It lives in @ads/db, not core, because both the worker and the gateway run a queue and the gateway may not
// depend on core (BLUEPRINT §2, D-068). Enqueuing sends NOTIFY jobs_<queue>; Postgres delivers it at commit.
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { enqueueNotification } from '../repos/plumbing.ts';
import { jobs, type JOB_QUEUES, type JOB_STATUSES } from '../schema.ts';

export type JobQueue = (typeof JOB_QUEUES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type Job = typeof jobs.$inferSelect;

/** The NOTIFY channel a queue's listeners wait on. */
export const jobsChannel = (queue: JobQueue): string => `jobs_${queue}`;

/** A lease lasts 10 minutes; the runner's heartbeat extends it every 2 minutes (§5.3). */
export const DEFAULT_LEASE_MS = 10 * 60_000;
/** Backoff after the n-th failed attempt is 1 min × 2^(n−1), capped at 2^10 minutes. */
const MAX_BACKOFF_EXPONENT = 10;
const MAX_ERROR_LENGTH = 2_000;

export interface NewJob {
  queue: JobQueue;
  kind: string;
  productId?: string | null;
  payload?: Record<string, unknown>;
  /** Higher runs first. Marcus's spend-reducing actions use 100 (§5.4). */
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
}

/** Adds a job and wakes the queue's listeners (at commit, when called inside a transaction). */
export async function enqueueJob(db: DbOrTx, input: NewJob): Promise<Job> {
  const [row] = await db
    .insert(jobs)
    .values({
      queue: input.queue,
      kind: input.kind,
      productId: input.productId ?? null,
      payload: input.payload ?? {},
      priority: input.priority ?? 0,
      ...(input.runAt === undefined ? {} : { runAt: input.runAt }),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    })
    .returning();
  if (!row) throw new Error('insert into jobs returned nothing');
  await notifyQueue(db, input.queue, row.id);
  return row;
}

export async function notifyQueue(db: DbOrTx, queue: JobQueue, payload = ''): Promise<void> {
  await db.execute(sql`select pg_notify(${jobsChannel(queue)}, ${payload})`);
}

/** Leases the next runnable job on `queue`: highest priority first, then oldest `run_at`. SKIP LOCKED means
 *  concurrent claimers never get the same job. The claim counts as an attempt, so a job that keeps crashing
 *  its process still reaches `max_attempts`. Returns null when nothing is runnable. */
export async function claimJob(
  db: DbOrTx,
  input: { queue: JobQueue; workerId: string; leaseMs?: number; kinds?: string[] },
): Promise<Job | null> {
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.queue, input.queue),
        eq(jobs.status, 'queued'),
        lte(jobs.runAt, sql`now()`),
        input.kinds === undefined ? undefined : inArray(jobs.kind, input.kinds),
      ),
    )
    .orderBy(desc(jobs.priority), asc(jobs.runAt))
    .limit(1)
    .for('update', { skipLocked: true });
  const [row] = await db
    .update(jobs)
    .set({
      status: 'running',
      leasedBy: input.workerId,
      leasedUntil: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
      attempts: sql`${jobs.attempts} + 1`,
    })
    .where(inArray(jobs.id, next))
    .returning();
  return row ?? null;
}

/** Extends a lease. Returns false if the job is no longer leased by `workerId` (reclaimed or finished):
 *  the caller must then stop working on it. */
export async function heartbeatJob(
  db: DbOrTx,
  input: { jobId: string; workerId: string; leaseMs?: number },
): Promise<boolean> {
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const rows = await db
    .update(jobs)
    .set({ leasedUntil: sql`now() + make_interval(secs => ${leaseMs / 1000})` })
    .where(leasedBy(input.jobId, input.workerId))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Marks a leased job done. Returns false if the lease was lost first (the job was reclaimed). */
export async function completeJob(db: DbOrTx, input: { jobId: string; workerId: string }): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: 'done', leasedUntil: null, leasedBy: null })
    .where(leasedBy(input.jobId, input.workerId))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Records a failed attempt. The job is re-queued with backoff (1 min × 2^(attempt−1)), or marked `failed`
 *  after `max_attempts` (or at once when `permanent`), which also alerts Marcus through the outbox.
 *  Returns the new status, or null if the lease was lost first. */
export async function failJob(
  db: DbOrTx,
  input: { jobId: string; workerId: string; error: string; permanent?: boolean },
): Promise<'queued' | 'failed' | null> {
  const giveUp = sql`(${jobs.attempts} >= ${jobs.maxAttempts} or ${input.permanent === true})`;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(jobs)
      .set({
        status: sql`case when ${giveUp} then 'failed' else 'queued' end`,
        runAt: sql`case when ${giveUp} then ${jobs.runAt}
        else now() + make_interval(mins => power(2, least(${jobs.attempts} - 1, ${MAX_BACKOFF_EXPONENT}))::int) end`,
        leasedUntil: null,
        leasedBy: null,
        lastError: input.error.slice(0, MAX_ERROR_LENGTH),
      })
      .where(leasedBy(input.jobId, input.workerId))
      .returning();
    if (!row) return null;
    if (row.status === 'failed') await alertFailed(tx, row);
    return row.status === 'failed' ? 'failed' : 'queued';
  });
}

/** Returns jobs whose lease has expired (their process died or hung) to the queue, or fails them if they have
 *  used all their attempts. Pass `queue` to touch only that queue: each process reclaims its own. */
export async function reclaimExpiredJobs(
  db: DbOrTx,
  input: { queue?: JobQueue } = {},
): Promise<{ requeued: Job[]; failed: Job[] }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(jobs)
      .set({
        status: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then 'failed' else 'queued' end`,
        lastError: sql`'lease expired (held by ' || coalesce(${jobs.leasedBy}, '?') || ')'`,
        leasedUntil: null,
        leasedBy: null,
      })
      .where(
        and(
          eq(jobs.status, 'running'),
          sql`${jobs.leasedUntil} < now()`,
          input.queue === undefined ? undefined : eq(jobs.queue, input.queue),
        ),
      )
      .returning();
    const failed = rows.filter((j) => j.status === 'failed');
    const requeued = rows.filter((j) => j.status === 'queued');
    for (const job of failed) await alertFailed(tx, job);
    for (const queue of new Set(requeued.map((j) => j.queue))) await notifyQueue(tx, queue);
    return { requeued, failed };
  });
}

export async function getJob(db: DbOrTx, id: string): Promise<Job | null> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

function leasedBy(jobId: string, workerId: string) {
  return and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.leasedBy, workerId));
}

async function alertFailed(db: DbOrTx, job: Job): Promise<void> {
  await enqueueNotification(db, {
    productId: job.productId,
    kind: 'job_failed',
    payload: { jobId: job.id, queue: job.queue, jobKind: job.kind, attempts: job.attempts, error: job.lastError },
  });
}
