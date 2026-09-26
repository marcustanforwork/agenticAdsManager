// Startup reconciliation for the worker (BLUEPRINT §5.5), a skeleton: reclaim expired leases and process
// requests left queued. M04 adds resuming unfinished cycles from `stage_reached`.
import { enqueueNotification, reclaimExpiredJobs, type Db } from '@ads/db';
import { processQueuedRequests, type RequestContext } from './requests/processor.ts';

export interface RecoverySummary {
  jobsRequeued: number;
  jobsFailed: number;
  requestsProcessed: number;
}

/** Runs at worker startup (and is safe to run again at any time). If anything was resumed, it queues a
 *  one-line note for Telegram. */
export async function recoverWorker(
  db: Db,
  ctx: RequestContext,
  opts: { onFault?: (requestId: string | null, error: unknown) => void } = {},
): Promise<RecoverySummary> {
  const { requeued, failed } = await reclaimExpiredJobs(db, { queue: 'worker' });
  // Requests are processed in the same transaction that locks them, so a crash leaves them `queued`, never
  // half-done: "re-queue stuck requests" means processing whatever is still queued.
  const requestsProcessed = await processQueuedRequests(db, ctx, opts);
  const summary = { jobsRequeued: requeued.length, jobsFailed: failed.length, requestsProcessed };
  if (summary.jobsRequeued + summary.jobsFailed + summary.requestsProcessed > 0) {
    await enqueueNotification(db, { kind: 'worker_recovered', payload: { ...summary } });
  }
  return summary;
}
