// Runs one queue's jobs, one at a time: claim → handler (with heartbeats) → complete or fail. It wakes on
// NOTIFY jobs_<queue> and also polls every `pollMs` (30 s) as the fallback, which also picks up backed-off jobs.
import { hostname } from 'node:os';
import type { Db } from '../client.ts';
import {
  DEFAULT_LEASE_MS,
  claimJob,
  completeJob,
  failJob,
  heartbeatJob,
  jobsChannel,
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

  let listener: Listener | null = null;
  if (opts.listenUrl !== undefined) {
    listener = listen({
      url: opts.listenUrl,
      channels: [jobsChannel(opts.queue)],
      onNotify: wake,
      onError: (err) => opts.logger?.error({ err, queue: opts.queue }, 'queue listener error'),
      applicationName: `ads-${opts.queue}-listen`,
    });
  }

  const runOne = async (job: Job): Promise<void> => {
    const lease = new AbortController();
    const onStop = (): void => lease.abort();
    stopping.signal.addEventListener('abort', onStop);
    const beat = setInterval(() => {
      heartbeatJob(opts.db, { jobId: job.id, workerId, leaseMs }).then(
        (held) => {
          if (!held) lease.abort();
        },
        (err: unknown) => opts.logger?.error({ err, jobId: job.id }, 'heartbeat failed'),
      );
    }, heartbeatMs);
    try {
      const handler = opts.handlers[job.kind];
      if (handler === undefined) throw new PermanentJobError(`no handler for job kind "${job.kind}"`);
      await handler(job, { signal: lease.signal });
      await completeJob(opts.db, { jobId: job.id, workerId });
    } catch (err) {
      const status = await failJob(opts.db, {
        jobId: job.id,
        workerId,
        error: err instanceof Error ? err.message : String(err),
        permanent: err instanceof PermanentJobError,
      });
      opts.logger?.error({ err, jobId: job.id, kind: job.kind, status }, 'job failed');
    } finally {
      clearInterval(beat);
      stopping.signal.removeEventListener('abort', onStop);
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopping.signal.aborted) {
      pendingWake = false;
      let job: Job | null = null;
      try {
        job = await claimJob(opts.db, { queue: opts.queue, workerId, leaseMs });
      } catch (err) {
        opts.logger?.error({ err, queue: opts.queue }, 'claim failed');
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
