// Startup reconciliation for the worker (BLUEPRINT §5.5): reclaim expired leases, process requests left queued,
// and (M04) resume unfinished cycles from `stage_reached`.
import { enqueueNotification, reclaimExpiredJobs, type Db } from '@ads/db';
import { type CycleDeps, resumeUnfinishedCycles } from './cycle/runCycle.ts';
import { processQueuedRequests, type RequestContext } from './requests/processor.ts';

export interface RecoverySummary {
  jobsRequeued: number;
  jobsFailed: number;
  requestsProcessed: number;
  /** With cycle deps: unfinished cycles run on to the end (or to their next stop). */
  cyclesResumed?: number;
  /** With cycle deps: cycles unfinished for too long, closed instead of resumed. */
  cyclesAbandoned?: number;
}

/** Runs at worker startup (and is safe to run again at any time). If anything was resumed, it queues a
 *  one-line note for Telegram. Cycles are resumed only when `cycles` (the sync's credentials and clients) is given. */
export async function recoverWorker(
  db: Db,
  ctx: RequestContext,
  opts: { onFault?: (requestId: string | null, error: unknown) => void; cycles?: CycleDeps } = {},
): Promise<RecoverySummary> {
  const { requeued, failed } = await reclaimExpiredJobs(db, { queue: 'worker' });
  // Requests are processed in the same transaction that locks them, so a crash leaves them `queued`, never
  // half-done: "re-queue stuck requests" means processing whatever is still queued.
  const requestsProcessed = await processQueuedRequests(db, ctx, opts);
  const summary: RecoverySummary = { jobsRequeued: requeued.length, jobsFailed: failed.length, requestsProcessed };
  if (opts.cycles !== undefined) {
    const cycles = await resumeUnfinishedCycles(opts.cycles);
    summary.cyclesResumed = cycles.resumed.filter((c) => c.outcome === 'finished' || c.outcome === 'stopped').length;
    summary.cyclesAbandoned = cycles.abandoned.length;
    for (const e of cycles.errors) opts.onFault?.(null, new Error(`cycle ${e.cycleId}: ${e.error}`));
  }
  const total =
    summary.jobsRequeued +
    summary.jobsFailed +
    summary.requestsProcessed +
    (summary.cyclesResumed ?? 0) +
    (summary.cyclesAbandoned ?? 0);
  if (total > 0) await enqueueNotification(db, { kind: 'worker_recovered', payload: { ...summary } });
  return summary;
}
