// The worker process entry point. Logs `ready`, serves GET /healthz on localhost, publishes the pack manifests
// (M05a), resumes unfinished cycles (M04), exits cleanly on SIGTERM.
import { pino } from 'pino';
import { portFromEnv, startService } from './service.ts';
import { publishManifestsAtStartup, resumeCyclesAtStartup } from './startup.ts';

const logger = pino({ base: { service: 'worker' } });

async function main(): Promise<void> {
  const service = await startService({
    name: 'worker',
    logger,
    host: process.env.HEALTH_HOST ?? '127.0.0.1',
    port: portFromEnv(process.env.HEALTH_PORT, 8081),
  });

  // Publish the packs' manifests (M05a) and resume cycles a restart interrupted (M04). In the background: the
  // health endpoint is already up.
  publishManifestsAtStartup(process.env, logger).catch((err: unknown) => {
    logger.error({ err }, 'publishing pack manifests failed');
  });
  resumeCyclesAtStartup(process.env, logger).catch((err: unknown) => {
    logger.error({ err }, 'resuming unfinished cycles failed');
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'stopping');
    service.stop().then(
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
