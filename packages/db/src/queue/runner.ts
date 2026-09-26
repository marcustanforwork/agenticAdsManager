// Runs one queue's jobs, one at a time: claim → handler (with heartbeats) → complete or fail. It wakes on
// NOTIFY jobs_<queue> and also polls every `pollMs` (30 s) as the fallback, which also picks up backed-off jobs
// and reclaims expired leases on its queue.
import { hostname } from 'node:os';
import type { Db } from '../client.ts';
import {
  DEFAULT_LEASE_MS,
  claimJob,
  completeJob,
  failJob,
  heartbeatJob,
  jobsChannel,
  reclaimExpiredJobs,
  releaseJob,
  type Job,
  type JobQueue,
} from './jobs.ts';
import { listen, type Listener } from './listener.ts';

export interface JobContext {
  /** Aborted when the lease is lost or the runner stops: stop work and don't write results. */
  signal: AbortSignal;
}
export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;

/** Thrown by a handler for a failure that retrying can't fix: the job fails at once. */
export class PermanentJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export interface RunnerLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface QueueRunnerOptions {
  db: Db;
  /** The direct (unpooled) connection string, for LISTEN. Omit to rely on polling alone. */
  listenUrl?: string;
  queue: JobQueue;
  handlers: Record<string, JobHandler>;
  workerId?: string;
  pollMs?: number;
  heartbeatMs?: number;
  leaseMs?: number;
  logger?: RunnerLogger;
}

export interface QueueRunner {
  readonly workerId: string;
  /** Checks the queue now (e.g. after enqueuing in-process). */
  wake(): void;
  /** Stops claiming, aborts the running job's signal, and waits for the loop to finish. */
  stop(): Promise<void>;
}

export const defaultWorkerId = (role: string): string => `${role}@${hostname()}:${process.pid}`;

export function startQueueRunner(opts: QueueRunnerOptions): QueueRunner {
  const workerId = opts.workerId ?? defaultWorkerId(opts.queue);
  const pollMs = opts.pollMs ?? 30_000;
  const heartbeatMs = opts.heartbeatMs ?? 2 * 60_000;
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const stopping = new AbortController();
  let wakeUp: (() => void) | null = null;
  let pendingWake = false;

  const wake = (): void => {
    pendingWake = true;
    wakeUp?.();
  };
  const sleep = (): Promise<void> =>
    new Promise((resolve) => {
      if (pendingWake || stopping.signal.aborted) return resolve();
      const timer = setTimeout(done, pollMs);
      function done(): void {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      }
      wakeUp = done;
    });

  const log = (level: 'info' | 'error', obj: object, msg: string): void => opts.logger?.[level](obj, msg);

  let listener: Listener | null = null;
  if (opts.listenUrl !== undefined) {
    listener = listen({
      url: opts.listenUrl,
      channels: [jobsChannel(opts.queue)],
      onNotify: wake,
      onError: (err) => log('error', { err, queue: opts.queue }, 'queue listener error'),
      applicationName: `ads-${opts.queue}-listen`,
    });
  }

  /** Never lets a bookkeeping error escape the loop: it's logged, and the lease expiring recovers the job. */
  const safely = async <T>(what: string, jobId: string, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (err) {
      log('error', { err, jobId }, `${what} failed`);
      return undefined;
    }
  };

  const runOne = async (job: Job): Promise<void> => {
    const lease = new AbortController();
    const onStop = (): void => lease.abort();
    stopping.signal.addEventListener('abort', onStop);
    let lastBeat = Date.now();
    const beat = setInterval(() => {
      heartbeatJob(opts.db, { jobId: job.id, workerId, leaseMs }).then(
        (held) => {
          if (held) lastBeat = Date.now();
          else lease.abort(); // reclaimed: someone else may run it now
        },
        (err: unknown) => {
          log('error', { err, jobId: job.id }, 'heartbeat failed');
          // Can't prove we still hold the lease: once it may have expired, stop before another worker starts.
          if (Date.now() - lastBeat >= leaseMs) lease.abort();
        },
      );
    }, heartbeatMs);
    let outcome: { ok: true } | { ok: false; err: unknown };
    try {
      const handler = opts.handlers[job.kind];
      if (handler === undefined) throw new PermanentJobError(`no handler for job kind "${job.kind}"`);
      await handler(job, { signal: lease.signal });
      outcome = { ok: true };
    } catch (err) {
      outcome = { ok: false, err };
    } finally {
      clearInterval(beat);
      stopping.signal.removeEventListener('abort', onStop);
    }
    if (outcome.ok) {
      // Outside the handler's try: a failed bookkeeping write must not count as a failed attempt (and re-run a
      // job whose work is done). If it fails, the lease expires and the job is reclaimed.
      await safely('complete', job.id, () => completeJob(opts.db, { jobId: job.id, workerId }));
    } else if (stopping.signal.aborted) {
      // Interrupted by shutdown, not failed: hand it back without using up an attempt.
      await safely('release', job.id, () => releaseJob(opts.db, { jobId: job.id, workerId }));
      log('info', { jobId: job.id, kind: job.kind }, 'job released at shutdown');
    } else {
      const { err } = outcome;
      const status = await safely('fail', job.id, () =>
        failJob(opts.db, {
          jobId: job.id,
          workerId,
          error: err instanceof Error ? err.message : String(err),
          permanent: err instanceof PermanentJobError,
        }),
      );
      log('error', { err, jobId: job.id, kind: job.kind, status }, 'job failed');
    }
  };

  // Only claim kinds this process can run, so an older replica never fails a newer kind (rolling deploys).
  const kinds = Object.keys(opts.handlers);
  let lastReclaim = 0;

  const loop = async (): Promise<void> => {
    while (!stopping.signal.aborted) {
      pendingWake = false;
      if (Date.now() - lastReclaim >= pollMs) {
        // Leases left by a crashed or hung process are reclaimed here, every poll, not only at startup.
        lastReclaim = Date.now();
        try {
          await reclaimExpiredJobs(opts.db, { queue: opts.queue });
        } catch (err) {
          log('error', { err, queue: opts.queue }, 'reclaim failed');
        }
      }
      let job: Job | null = null;
      try {
        job = await claimJob(opts.db, { queue: opts.queue, workerId, leaseMs, kinds });
      } catch (err) {
        log('error', { err, queue: opts.queue }, 'claim failed');
      }
      if (job === null) {
        await sleep();
        continue;
      }
      await runOne(job);
    }
  };

  const done = loop();
  return {
    workerId,
    wake,
    async stop() {
      stopping.abort();
      wakeUp?.();
      await done;
      await listener?.close();
    },
  };
}
