import { join } from 'node:path';
import { type Cassette, loadCassette, replayFetch } from '@ads/connector-testing';
import {
  GoogleAdsClient,
  type GoogleAdsClientOptions,
  GoogleReadClient,
  type GoogleReadClientOptions,
  StaticTokenProvider,
} from '../src/index.ts';

export const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'google');
export const ACCOUNT = '1234567890';
export const MANAGER = '1112223333';
export const KPI_ACTION = '555';
/** A fake token in Google's format: it must never reach a fixture. */
export const FAKE_TOKEN = `ya29.${'x'.repeat(48)}`;

export const cassette = (name: string): Cassette => loadCassette(join(FIXTURES, `${name}.json`));

/** A client that replays the named cassettes; sleeps are recorded instead of waited. */
export function replayClient(
  names: string[] | Cassette[],
  opts: Partial<GoogleReadClientOptions> = {},
  api: Partial<GoogleAdsClientOptions> = {},
) {
  const replay = replayFetch(names.map((n) => (typeof n === 'string' ? cassette(n) : n)));
  const sleeps: number[] = [];
  const google = new GoogleAdsClient({
    tokens: new StaticTokenProvider(FAKE_TOKEN),
    loginCustomerId: MANAGER,
    fetch: replay.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...api,
  });
  const client = new GoogleReadClient({ api: google, conversionActionIds: [KPI_ACTION], ...opts });
  return { client, replay, sleeps, api: google };
}

/** One searchStream exchange written inline in a test. */
export function streamExchange(query: string, status: number, body: unknown): Cassette['exchanges'][number] {
  return {
    request: {
      method: 'POST',
      path: `/customers/${ACCOUNT}/googleAds:searchStream`,
      query: {},
      headers: { 'login-customer-id': MANAGER },
      body: { query },
    },
    response: { status, headers: {}, body },
  };
}
