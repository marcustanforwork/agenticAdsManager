import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from 'pino';

export interface ServiceOptions {
  name: string;
  logger: Logger;
  /** The health endpoint listens here only. 0 = any free port (tests). */
  host: string;
  port: number;
}

export interface RunningService {
  port: number;
  stop(): Promise<void>;
}

/** Starts the process's health endpoint (GET /healthz) and logs `ready`. No work loop yet (M01b adds it). */
export async function startService(opts: ServiceOptions): Promise<RunningService> {
  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: opts.name }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  opts.logger.info({ health: `http://${opts.host}:${port}/healthz` }, 'ready');
  return {
    port,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

/** Parses a port from the environment; throws on anything that isn't 0–65535. */
export function portFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65_535) throw new Error(`invalid port: ${value}`);
  return Number(value);
}
