// The gateway process entry point. Logs `ready`, serves GET /healthz on localhost, exits cleanly on SIGTERM.
import { pino } from 'pino';
import { portFromEnv, startService } from './service.ts';

const logger = pino({ base: { service: 'gateway' } });

async function main(): Promise<void> {
  const service = await startService({
    name: 'gateway',
    logger,
    host: process.env.HEALTH_HOST ?? '127.0.0.1',
    port: portFromEnv(process.env.HEALTH_PORT, 8082),
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
