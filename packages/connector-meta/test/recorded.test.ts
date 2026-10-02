// Replays the real fixtures recorded by `pnpm --filter @ads/connector-meta record` (the M02 live steps); that
// part is skipped until they exist. Every method must replay without an unmatched request, and every row must
// satisfy the contracts: this is where a difference between Meta's docs and reality shows up.
// The round-trip test proves the recorder itself: record (from the hand-written fixtures) → replay.
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSecrets, loadCassette, replayFetch } from '@ads/connector-testing';
import { AdEntityRecord, MetricRow, TrustSignalRow } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { type RecordManifest, recordMetaFixtures } from '../scripts/recordFixtures.ts';
import { GraphClient, MetaReadClient } from '../src/index.ts';
import { ACT, FAKE_TOKEN, FIXTURES, LEAD, cassette } from './helpers.ts';

/** Replays every cassette in a recorded directory; returns the number of rows checked. */
async function replayRecorded(dir: string): Promise<number> {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as RecordManifest;
  let rows = 0;
  const run = async (name: string, call: (c: MetaReadClient) => Promise<void>) => {
    const replay = replayFetch(loadCassette(join(dir, `${name}.json`)));
    const c = new MetaReadClient({
      graph: new GraphClient({ accessToken: FAKE_TOKEN, appSecret: 'replay-secret-0123456789', fetch: replay.fetch }),
      conversionActionTypes: m.conversionActionTypes,
      ...(m.datasetId === null ? {} : { datasetId: m.datasetId }),
      now: () => new Date(m.recordedAt),
    });
    await call(c);
    expect(replay.remaining(), `${name}: unused exchanges`).toBe(0);
  };
  await run('account', async (c) => {
    expect((await c.getAccountInfo(m.account)).timezone).not.toBe('');
  });
  await run('entities', async (c) => {
    for (const r of await c.listEntities(m.account, ['campaign', 'ad_group', 'ad']))
      rows += AdEntityRecord.parse(r) ? 1 : 0;
  });
  for (const level of ['campaign', 'ad_group', 'ad'] as const) {
    await run(`metrics-${level}`, async (c) => {
      for (const r of await c.getMetricsDaily(m.account, m.range, level)) rows += MetricRow.parse(r) ? 1 : 0;
    });
  }
  await run('snapshot', async (c) => {
    for (const ref of m.snapshotRefs) expect((await c.snapshot(ref)).hash).toMatch(/^[a-f0-9]{64}$/);
  });
  await run('trust', async (c) => {
    TrustSignalRow.parse(await c.trustSignals(m.account, m.range));
  });
  return rows;
}

const RECORDED = join(FIXTURES, 'recorded');

describe.skipIf(!existsSync(join(RECORDED, 'manifest.json')))('recorded Meta fixtures', () => {
  it('replay through every method and satisfy the contracts', async () => {
    expect(await replayRecorded(RECORDED)).toBeGreaterThan(0);
  });
});

describe('record → replay round trip', () => {
  it('records redacted cassettes that replay on their own', async () => {
    // Serve the hand-written fixtures as if they were Meta, with dates moved to what the recorder asks for.
    const now = new Date('2026-10-01T02:30:00Z'); // 10:30 in Singapore: the range is the 7 days to 2026-09-30
    const shifted = ['entities', 'metrics-campaign-v1', 'metrics-adset', 'metrics-ad', 'snapshot', 'trust'].map((n) => {
      const c = cassette(n);
      return {
        ...c,
        exchanges: c.exchanges.map((x) => {
          const q = { ...x.request.query };
          if (q['time_range'] !== undefined) q['time_range'] = '{"since":"2026-09-24","until":"2026-09-30"}';
          return { ...x, request: { ...x.request, query: q } };
        }),
      };
    });
    // The recorder makes the account read several times (once per fresh client), so offer plenty.
    const account = cassette('account');
    const live = replayFetch([...shifted, ...Array.from({ length: 6 }, () => account)]);
    const dir = mkdtempSync(join(tmpdir(), 'recorded-'));
    const result = await recordMetaFixtures({
      accessToken: FAKE_TOKEN,
      appSecret: 'live-secret-0123456789',
      account: ACT,
      days: 7,
      datasetId: '987654321012345',
      conversionActionTypes: [LEAD],
      outDir: dir,
      fetch: live.fetch,
      now,
    });
    expect(result.entities).toBe(8);
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(findSecrets(text), f).toEqual([]);
      expect(text).not.toContain('Signups - Advantage+'); // names are replaced
    }
    expect(await replayRecorded(dir)).toBeGreaterThan(0);
  });
});
