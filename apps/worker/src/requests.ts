// Processing the requests that other surfaces only record (M10a): the dashboard inserts operator requests through
// Neon's pooler and can't process them (its role can only insert). Every replica LISTENs for `request_queued`
// (an insert trigger, migration 0007) on its direct connection and drains the queue; a poll covers a lost
// wake-up. SKIP LOCKED in the processor keeps two replicas from handling the same request.
import { type RequestContext, processQueuedRequests } from '@ads/core';
import { type Db, listen } from '@ads/db';
import type { WorkerLogger } from './worker.ts';

/** The channel the insert trigger notifies, with the request id as the payload. */
export const REQUEST_QUEUED_CHANNEL = 'request_queued';

export interface RequestProcessing {
  /** Drains the queue now; resolves to how many requests this pass (and any it was asked to repeat) processed. */
  drainNow(): Promise<number>;
  stop(): Promise<void>;
}

export function startRequestProcessing(opts: {
  db: Db;
  listenUrl: string;
  ctx: RequestContext;
  logger: WorkerLogger;
  pollMs?: number;
}): RequestProcessing {
  const { db, ctx, logger } = opts;
  let stopped = false;
  let inFlight: Promise<number> | null = null;
  let again = false;

  // One drain at a time: a wake-up during a drain asks for one more pass, so nothing recorded meanwhile waits for
  // the next poll.
  const drainNow = (): Promise<number> => {
    if (inFlight !== null) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      let total = 0;
      do {
        again = false;
        if (stopped) break;
        total += await processQueuedRequests(db, ctx, {
          onFault: (requestId, error) => logger.error({ requestId, err: error }, 'request processing fault'),
        });
      } while (again);
      if (total > 0) logger.info({ processed: total }, 'operator requests processed');
      return total;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  const wake = (): void => {
    drainNow().catch((error: unknown) => logger.error({ err: error }, 'request drain failed'));
  };

  const listener = listen({
    url: opts.listenUrl,
    channels: [REQUEST_QUEUED_CHANNEL],
    onNotify: wake,
    onError: (error) => logger.warn({ err: error }, 'request listener error: polling until it reconnects'),
    applicationName: 'ads-worker-requests',
  });
  const timer = setInterval(wake, opts.pollMs ?? 30_000);
  wake();

  return {
    drainNow,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await listener.close();
      await inFlight?.catch(() => undefined);
    },
  };
}
