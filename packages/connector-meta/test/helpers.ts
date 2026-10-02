import { join } from 'node:path';
import { type Cassette, loadCassette, replayFetch } from '@ads/connector-testing';
import { GraphClient, MetaReadClient, type MetaReadClientOptions } from '../src/index.ts';

export const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'meta');
export const ACT = 'act_1234567890';
export const LEAD = 'offsite_conversion.fb_pixel_lead';
/** A fake token in Meta's format: it must never reach a fixture. */
export const FAKE_TOKEN = `EAA${'x'.repeat(48)}`;

export const cassette = (name: string): Cassette => loadCassette(join(FIXTURES, `${name}.json`));

/** A client that replays the named cassettes; sleeps are recorded instead of waited. */
export function replayClient(names: string[], opts: Partial<MetaReadClientOptions> = {}) {
  const replay = replayFetch(names.map(cassette));
  const sleeps: number[] = [];
  const graph = new GraphClient({
    accessToken: FAKE_TOKEN,
    appSecret: 'test-app-secret-0123456789',
    fetch: replay.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  const client = new MetaReadClient({ graph, conversionActionTypes: [LEAD], ...opts });
  return { client, replay, sleeps, graph };
}

/** A client over exchanges written inline in a test. */
export function inlineClient(exchanges: Cassette['exchanges'], opts: Partial<MetaReadClientOptions> = {}) {
  const replay = replayFetch({ source: 'inline test', exchanges });
  const graph = new GraphClient({
    accessToken: FAKE_TOKEN,
    appSecret: 'test-app-secret-0123456789',
    fetch: replay.fetch,
  });
  return new MetaReadClient({ graph, conversionActionTypes: [], ...opts });
}

export const ACCOUNT_FIELDS = 'id,name,currency,timezone_name,spend_cap,amount_spent,account_status';
