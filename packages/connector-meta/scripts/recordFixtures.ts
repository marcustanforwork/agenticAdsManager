// The recording logic behind `pnpm --filter @ads/connector-meta record` (scripts/record.ts), separate so the
// record → replay round trip can be tested against the hand-written fixtures.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Exchange, Redactor, findSecrets, recordingFetch, saveCassette } from '@ads/connector-testing';
import { type DateRange, type EntityRef, localDate, minusDays } from '@ads/contracts';
import { GRAPH_API_VERSION, GraphClient, MetaReadClient } from '../src/index.ts';

/** What the replay test needs to make the same requests again (test/recorded.test.ts). */
export interface RecordManifest {
  source: string;
  recordedAt: string;
  account: string;
  range: DateRange;
  datasetId: string | null;
  conversionActionTypes: string[];
  snapshotRefs: EntityRef[];
}

export interface RecordInput {
  accessToken: string;
  appSecret: string;
  account: string;
  /** Metrics days to record, ending yesterday in the account's timezone. */
  days: number;
  datasetId?: string;
  conversionActionTypes: string[];
  outDir: string;
  fetch?: typeof fetch;
  now?: Date;
}

export async function recordMetaFixtures(input: RecordInput) {
  const recorder = recordingFetch(input.fetch ?? fetch, new Redactor());
  const now = input.now ?? new Date();
  const graph = new GraphClient({ accessToken: input.accessToken, appSecret: input.appSecret, fetch: recorder.fetch });
  // A fresh client per cassette, so each one holds every request a fresh client makes (e.g. the account
  // read that fetches the currency), and replays on its own.
  const fresh = () =>
    new MetaReadClient({
      graph,
      conversionActionTypes: input.conversionActionTypes,
      ...(input.datasetId === undefined ? {} : { datasetId: input.datasetId }),
      now: () => now,
    });
  const cassettes: Record<string, Exchange[]> = {};
  const capture = async <T>(name: string, run: (c: MetaReadClient) => Promise<T>): Promise<T> => {
    const start = recorder.exchanges.length;
    const result = await run(fresh());
    cassettes[name] = recorder.exchanges.slice(start);
    return result;
  };

  const info = await capture('account', (c) => c.getAccountInfo(input.account));
  const today = localDate(now, info.timezone);
  const range = { from: minusDays(today, input.days), to: minusDays(today, 1) };
  const entities = await capture('entities', (c) => c.listEntities(input.account, ['campaign', 'ad_group', 'ad']));
  const metrics: Record<string, number> = {};
  for (const level of ['campaign', 'ad_group', 'ad'] as const) {
    metrics[level] = (await capture(`metrics-${level}`, (c) => c.getMetricsDaily(input.account, range, level))).length;
  }
  const snapshotRefs: EntityRef[] = [];
  for (const type of ['campaign', 'ad_group', 'ad'] as const) {
    const first = entities.find((e) => e.ref.type === type);
    if (first) snapshotRefs.push(first.ref);
  }
  await capture('snapshot', async (c) => {
    for (const ref of snapshotRefs) await c.snapshot(ref);
  });
  await capture('trust', (c) => c.trustSignals(input.account, range));

  const source = `recorded ${now.toISOString().slice(0, 10)} with Graph API ${GRAPH_API_VERSION}`;
  for (const [name, exchanges] of Object.entries(cassettes)) {
    saveCassette(join(input.outDir, `${name}.json`), { source, exchanges });
  }
  const manifest: RecordManifest = {
    source,
    recordedAt: now.toISOString(),
    account: input.account,
    range,
    datasetId: input.datasetId ?? null,
    conversionActionTypes: input.conversionActionTypes,
    snapshotRefs,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (findSecrets(text).length > 0) throw new Error('refusing to write the manifest: it holds a secret');
  writeFileSync(join(input.outDir, 'manifest.json'), text);
  return { requests: graph.requestCount, entities: entities.length, metrics, usage: graph.lastUsage };
}
