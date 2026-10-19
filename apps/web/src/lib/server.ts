// Server-only helpers for pages, route handlers and server actions: the database (one small pool per server
// instance) and the signed-in operator, checked again here so that pages never rely on the proxy alone.
import { connect, type Db } from '@ads/db';
import { headers } from 'next/headers';
import { ACCESS_HEADER, accessConfigFromEnv, verifyAccessToken, type Operator } from './access.ts';
import { databaseUrlFromEnv } from './config.ts';

const cache = globalThis as typeof globalThis & { adsDashboardDb?: Db };

export function db(): Db {
  cache.adsDashboardDb ??= connect(databaseUrlFromEnv(process.env), { max: 3, applicationName: 'ads-dashboard' }).db;
  return cache.adsDashboardDb;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized: sign in through Cloudflare Access.');
    this.name = 'UnauthorizedError';
  }
}

/** The verified operator for the current request; throws UnauthorizedError without a valid Access token. */
export async function requireOperator(): Promise<Operator> {
  const token = (await headers()).get(ACCESS_HEADER);
  const operator = await verifyAccessToken(token, accessConfigFromEnv(process.env));
  if (operator === null) throw new UnauthorizedError();
  return operator;
}
