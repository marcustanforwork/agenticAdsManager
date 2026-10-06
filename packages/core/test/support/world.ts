// Test support for the sync stage and the cycle (M04): the connectors' hand-written fixtures with their dates moved
// to the run's windows, and a product with one Meta and one Google account whose read credentials are in the vault.
// Plain TypeScript without vitest, so the crash-resume child process can import it too.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { type Cassette, loadCassette } from '@ads/connector-testing';
import { GOOGLE_TOKEN_URL } from '@ads/connector-google';
import { localDate, minusDays, type ProductSettings } from '@ads/contracts';
import { type DbOrTx, createProduct, setAccountLoginCustomerId, setClicksSyncedThrough, upsertAccount } from '@ads/db';
import { TEST_SETTINGS } from '@ads/db/testing';
import { type MasterKey, parseMasterKey, put } from '@ads/vault';

const PACKAGES = join(import.meta.dirname, '..', '..', '..');
export const META_FIXTURES = join(PACKAGES, 'connector-meta', 'fixtures', 'meta');
export const GOOGLE_FIXTURES = join(PACKAGES, 'connector-google', 'fixtures', 'google');

export const META_ACCOUNT = 'act_1234567890';
export const META_DATASET = '987654321012345';
export const GOOGLE_ACCOUNT = '1234567890';
export const GOOGLE_MANAGER = '1112223333';
/** 2026-10-01 01:30 in Singapore: "today" there is 2026-10-01. */
export const NOW = new Date('2026-09-30T17:30:00Z');

export const META_ALL = ['entities', 'metrics-campaign-v1', 'metrics-adset', 'metrics-ad', 'trust'];
export const GOOGLE_ALL = [
  'account',
  'entities',
  'metrics-campaign-v1',
  'metrics-ad_group',
  'metrics-keyword',
  'search-terms',
  'clicks',
  'trust',
];

export const SETTINGS: ProductSettings = {
  ...TEST_SETTINGS,
  outcomes: {
    ...TEST_SETTINGS.outcomes,
    feedback: [
      { stage: 'signup', platform: 'meta', destinationId: META_DATASET, eventName: 'Lead' },
      { stage: 'signup', platform: 'google', destinationId: '555' },
    ],
  },
};

/** Meta's fixtures with their date parameters moved to the windows a run at `now` asks for. */
export function metaCassettes(now: Date, names: string[] = META_ALL): Cassette[] {
  const today = localDate(now, 'Asia/Singapore');
  const window = JSON.stringify({ since: minusDays(today, 27), until: today });
  const trust = JSON.stringify({ since: minusDays(today, 6), until: today });
  const end = Math.floor(now.getTime() / 3_600_000) * 3_600;
  return names.map((n) => {
    const c = loadCassette(join(META_FIXTURES, `${n}.json`));
    return {
      ...c,
      exchanges: c.exchanges.map((x) => {
        const q = { ...x.request.query };
        if (q['time_range'] !== undefined) q['time_range'] = q['level'] === 'account' ? trust : window;
        if (q['start_time'] !== undefined) q['start_time'] = String(end - 7 * 86_400);
        if (q['end_time'] !== undefined) q['end_time'] = String(end);
        return { ...x, request: { ...x.request, query: q } };
      }),
    };
  });
}

/** Google's fixtures with the dates in their queries moved to the windows a run at `now` asks for. */
export function googleCassettes(now: Date, names: string[] = GOOGLE_ALL): Cassette[] {
  const today = localDate(now, 'Asia/Singapore');
  const window = `BETWEEN '${minusDays(today, 27)}' AND '${today}'`;
  const trust = `BETWEEN '${minusDays(today, 6)}' AND '${today}'`;
  return names.map((n) => {
    const c = loadCassette(join(GOOGLE_FIXTURES, `${n}.json`));
    return {
      ...c,
      exchanges: c.exchanges.map((x) => {
        const body = x.request.body as { query?: string } | undefined;
        if (body?.query === undefined) return x;
        const query = body.query
          .replace("BETWEEN '2026-09-28' AND '2026-09-30'", body.query.includes('FROM customer WHERE') ? trust : window)
          .replace("segments.date = '2026-09-30'", `segments.date = '${minusDays(today, 1)}'`);
        return { ...x, request: { ...x.request, body: { query } } };
      }),
    };
  });
}

/** A deep copy of the cassettes whose response bodies `edit` may change: the "v2" side of a fixture pair. */
export function editResponses(cassettes: Cassette[], edit: (body: unknown, path: string) => void): Cassette[] {
  const copy = structuredClone(cassettes);
  for (const c of copy) for (const x of c.exchanges) edit(x.response.body, x.request.path);
  return copy;
}

/** Calls `visit` on every object inside `value` (response bodies are nested arrays and objects). */
export function eachObject(value: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) for (const v of value) eachObject(v, visit);
  else if (value !== null && typeof value === 'object') {
    visit(value as Record<string, unknown>);
    for (const v of Object.values(value)) eachObject(v, visit);
  }
}

/** Google's token endpoint, faked: sign-in never goes through the recorded or replayed fetch (D-072). */
export const tokenFetch: typeof fetch = () =>
  Promise.resolve(new Response(JSON.stringify({ access_token: `ya29.${'t'.repeat(30)}`, expires_in: 3599 })));

export interface World {
  productId: string;
  metaAccountId: string;
  googleAccountId: string;
  masterKey: MasterKey;
}

/** A product with one Meta and one Google account (manager stored, click ids synced through yesterday, so a sync
 *  re-reads only that day: the one click fixture), and their read credentials. Keys are made at run time. */
export async function makeWorld(
  db: DbOrTx,
  input: { slug: string; masterKey?: MasterKey; now?: Date },
): Promise<World> {
  const masterKey = input.masterKey ?? parseMasterKey(`read-v1:${randomBytes(32).toString('base64')}`);
  const product = await createProduct(db, { slug: input.slug, name: 'World', packId: 'test-pack', settings: SETTINGS });
  const meta = await upsertAccount(db, { productId: product.id, platform: 'meta', externalId: META_ACCOUNT });
  await put(db, meta.id, 'read', { accessToken: `EAA${'z'.repeat(40)}`, appSecret: 's'.repeat(32) }, masterKey);
  const google = await upsertAccount(db, { productId: product.id, platform: 'google', externalId: GOOGLE_ACCOUNT });
  await setAccountLoginCustomerId(db, google.id, GOOGLE_MANAGER);
  const today = localDate(input.now ?? NOW, 'Asia/Singapore');
  await setClicksSyncedThrough(db, google.id, minusDays(today, 1));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await put(
    db,
    google.id,
    'read',
    {
      type: 'service_account',
      client_email: 'ads-agent-read@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: GOOGLE_TOKEN_URL,
    },
    masterKey,
  );
  return { productId: product.id, metaAccountId: meta.id, googleAccountId: google.id, masterKey };
}
