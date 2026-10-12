// The gateway's `gateway-alive` heartbeat (BLUEPRINT §5.16, M07). With DATABASE_URL set, it pings only after a
// database round trip (a gateway that can't reach its database can't apply anything, so it should go quiet); without
// it, the process being up is all there is to report until M11b.
import { connect, databaseNow } from '@ads/db';
import { HEARTBEAT_MS, type PingLogger, ping, startHeartbeat } from './heartbeat.ts';

export interface GatewayAlive {
  stop(): Promise<void>;
}

export function startGatewayHeartbeat(
  env: Readonly<Record<string, string | undefined>>,
  logger: PingLogger & { info(obj: object, msg: string): void },
  opts: { fetch?: typeof fetch; everyMs?: number } = {},
): GatewayAlive {
  const url = env['HEALTHCHECK_GATEWAY_URL'];
  if (url === undefined || url === '') {
    logger.info({}, 'no HEALTHCHECK_GATEWAY_URL: no heartbeat');
    return { stop: () => Promise.resolve() };
  }
  const dbUrl = env['DATABASE_URL'];
  const database =
    dbUrl === undefined || dbUrl === '' ? null : connect(dbUrl, { max: 1, applicationName: 'ads-gateway' });
  const pingOpts = { ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }), logger };
  const heartbeat = startHeartbeat(async () => {
    if (database !== null) {
      try {
        await databaseNow(database.db);
      } catch (error) {
        logger.error({ err: error }, 'database unreachable: heartbeat reports a failure');
        await ping(url, { ...pingOpts, fail: true });
        return;
      }
    }
    await ping(url, pingOpts);
  }, opts.everyMs ?? HEARTBEAT_MS);
  return {
    async stop() {
      heartbeat.stop();
      await database?.close();
    },
  };
}
