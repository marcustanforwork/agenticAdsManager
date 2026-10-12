// The worker process entry point. Logs `ready`, serves GET /healthz on localhost, publishes the pack manifests
// (M05a), then starts the worker service (M07: startup reconciliation, the job queue, and on the leader the
// schedule, Telegram and the outbox). On SIGTERM the running cycle stops between stages and its job is released.
import { pino } from 'pino';
import { portFromEnv, startService } from './service.ts';
import { publishManifestsAtStartup } from './startup.ts';
import { type RunningWorker, startWorker } from './worker.ts';

const logger = pino({ base: { service: 'worker' } });

async function main(): Promise<void> {
  const service = await startService({
    name: 'worker',
    logger,
    host: process.env.HEALTH_HOST ?? '127.0.0.1',
    port: portFromEnv(process.env.HEALTH_PORT, 8081),
  });

  // Publish the packs' manifests (M05a), then start the work. The health endpoint is already up.
  await publishManifestsAtStartup(process.env, logger).catch((err: unknown) => {
    logger.error({ err }, 'publishing pack manifests failed');
  });
  let worker: RunningWorker | null = null;
  const shuttingDown = new AbortController();
  const starting = startWorker({ env: process.env, logger, signal: shuttingDown.signal }).then(
    (w) => {
      worker = w;
      return w;
    },
    (err: unknown) => {
      logger.fatal({ err }, 'the worker service failed to start');
      process.exit(1);
    },
  );

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'stopping');
    shuttingDown.abort();
    starting
      .then(() => (worker as RunningWorker | null)?.stop())
      .then(() => service.stop())
      .then(
        () => {
          logger.info('stopped');
          process.exit(0);
        },
        (err: unknown) => {
          logger.error({ err }, 'stop failed');
          process.exit(1);
        },
      );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
