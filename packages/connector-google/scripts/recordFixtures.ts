// The recording logic behind `pnpm --filter @ads/connector-google record` (scripts/record.ts), separate so the
// record → replay round trip can be tested against the hand-written fixtures. Sign-in uses the token provider's
// own fetch, never the recorder, so no token, assertion or key can reach a cassette.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Exchange, Redactor, findSecrets, recordingFetch, saveCassette } from '@ads/connector-testing';
import { type DateRange, type EntityRef, type EntityType, localDate, minusDays } from '@ads/contracts';
import { type AccessTokenProvider, GOOGLE_ADS_API_VERSION, GoogleAdsClient, GoogleReadClient } from '../src/index.ts';

/** What the replay test needs to make the same requests again (test/recorded.test.ts). */
export interface RecordManifest {
  source: string;
  recordedAt: string;
  account: string;
  loginCustomerId: string | null;
  range: DateRange;
  clickDay: string;
  conversionActionIds: string[];
  snapshotRefs: EntityRef[];
}

export interface RecordInput {
  tokens: AccessTokenProvider;
  account: string;
  loginCustomerId?: string;
  /** Metrics days to record, ending yesterday in the account's timezone. */
  days: number;
  conversionActionIds: string[];
  outDir: string;
  fetch?: typeof fetch;
  now?: Date;
}

const ENTITIES: EntityType[] = ['campaign', 'ad_group', 'keyword', 'budget'];

export async function recordGoogleFixtures(input: RecordInput) {
  const recorder = recordingFetch(input.fetch ?? fetch, new Redactor());
  const now = input.now ?? new Date();
  const api = new GoogleAdsClient({
    tokens: input.tokens,
    fetch: recorder.fetch,
    ...(input.loginCustomerId === undefined ? {} : { loginCustomerId: input.loginCustomerId }),
  });
  const client = new GoogleReadClient({ api, conversionActionIds: input.conversionActionIds, now: () => now });
  const cassettes: Record<string, Exchange[]> = {};
  const capture = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const start = recorder.exchanges.length;
    const result = await run();
    cassettes[name] = recorder.exchanges.slice(start);
    return result;
  };

  const info = await capture('account', () => client.getAccountInfo(input.account));
  const today = localDate(now, info.timezone);
  const range = { from: minusDays(today, input.days), to: minusDays(today, 1) };
  const clickDay = minusDays(today, 1);
  const entities = await capture('entities', () => client.listEntities(input.account, ENTITIES));
  const metrics: Record<string, number> = {};
  for (const level of ['campaign', 'ad_group', 'keyword'] as const) {
    metrics[level] = (
      await capture(`metrics-${level}`, () => client.getMetricsDaily(input.account, range, level))
    ).length;
  }
  const searchTerms = (await capture('search-terms', () => client.getSearchTerms(input.account, range))).length;
  const clicks = (await capture('clicks', () => client.getClickIds(input.account, clickDay))).length;
  const snapshotRefs: EntityRef[] = [];
  for (const type of ENTITIES) {
    const first = entities.find((e) => e.ref.type === type);
    if (first) snapshotRefs.push(first.ref);
  }
  await capture('snapshot', async () => {
    for (const ref of snapshotRefs) await client.snapshot(ref);
  });
  await capture('trust', () => client.trustSignals(input.account, range));

  const source = `recorded ${now.toISOString().slice(0, 10)} with Google Ads API ${GOOGLE_ADS_API_VERSION}`;
  for (const [name, exchanges] of Object.entries(cassettes)) {
    saveCassette(join(input.outDir, `${name}.json`), { source, exchanges });
  }
  const manifest: RecordManifest = {
    source,
    recordedAt: now.toISOString(),
    account: input.account,
    loginCustomerId: input.loginCustomerId ?? null,
    range,
    clickDay,
    conversionActionIds: input.conversionActionIds,
    snapshotRefs,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (findSecrets(text).length > 0) throw new Error('refusing to write the manifest: it holds a secret');
  writeFileSync(join(input.outDir, 'manifest.json'), text);
  return { operations: api.requestCount, entities: entities.length, metrics, searchTerms, clicks };
}
