// The gateway process entry point. Logs `ready`, serves GET /healthz on localhost, pings its `gateway-alive`
// heartbeat (M07: the stub sends heartbeats only; the apply loop arrives in M11b), exits cleanly on SIGTERM.
import { pino } from 'pino';
import { startGatewayHeartbeat } from './alive.ts';
import { portFromEnv, startService } from './service.ts';

const logger = pino({ base: { service: 'gateway' } });

async function main(): Promise<void> {
  const service = await startService({
    name: 'gateway',
    logger,
    host: process.env.HEALTH_HOST ?? '127.0.0.1',
    port: portFromEnv(process.env.HEALTH_PORT, 8082),
  });
  const alive = startGatewayHeartbeat(process.env, logger);

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'stopping');
    alive
      .stop()
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
