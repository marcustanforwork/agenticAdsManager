// The gateway stub's heartbeat (M07): `gateway-alive` is pinged after a database round trip, `/fail` when the
// database can't be reached, and nothing at all without a check URL.
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startGatewayHeartbeat } from '../src/alive.ts';
import { ping } from '../src/heartbeat.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const silent = { info: () => undefined, error: () => undefined };
const recorder = () => {
  const urls: string[] = [];
  const fetch = (url: string | URL | Request) => {
    urls.push(url instanceof Request ? url.url : url.toString());
    return Promise.resolve(new Response('OK'));
  };
  return { urls, fetch: fetch };
};

describe('gateway heartbeat', () => {
  it('pings gateway-alive after a database round trip', async () => {
    const r = recorder();
    const alive = startGatewayHeartbeat(
      { HEALTHCHECK_GATEWAY_URL: 'https://hc.invalid/gw', DATABASE_URL: t.url },
      silent,
      { fetch: r.fetch },
    );
    await vi.waitFor(() => expect(r.urls).toEqual(['https://hc.invalid/gw']));
    await alive.stop();
  });

  it('reports a failure when the database is unreachable', async () => {
    const r = recorder();
    const alive = startGatewayHeartbeat(
      { HEALTHCHECK_GATEWAY_URL: 'https://hc.invalid/gw/', DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' },
      silent,
      { fetch: r.fetch },
    );
    await vi.waitFor(() => expect(r.urls).toEqual(['https://hc.invalid/gw/fail']), { timeout: 5_000 });
    await alive.stop();
  });

  it('does nothing without a check URL, and a failed ping never throws', async () => {
    const r = recorder();
    await startGatewayHeartbeat({}, silent, { fetch: r.fetch }).stop();
    expect(r.urls).toEqual([]);
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    expect(await ping('https://hc.invalid/x', { fetch: down })).toBe(false);
    expect(await ping(undefined)).toBe(false);
  });
});
