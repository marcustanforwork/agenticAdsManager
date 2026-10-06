// Replays the real fixtures recorded by `pnpm --filter @ads/connector-google record` (the M03 live steps); that
// part is skipped until they exist. Every method must replay without an unmatched request, and every row must
// satisfy the contracts: this is where a difference between Google's docs and reality shows up.
// The round-trip test proves the recorder itself: record (from the hand-written fixtures) → replay.
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSecrets, loadCassette, replayFetch } from '@ads/connector-testing';
import { AdEntityRecord, ClickRow, MetricRow, SearchTermRow, TrustSignalRow } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { type RecordManifest, recordGoogleFixtures } from '../scripts/recordFixtures.ts';
import { GoogleAdsClient, GoogleReadClient, StaticTokenProvider } from '../src/index.ts';
import { ACCOUNT, FAKE_TOKEN, FIXTURES, KPI_ACTION, MANAGER, cassette } from './helpers.ts';

/** Replays every cassette in a recorded directory; returns the number of rows checked. */
async function replayRecorded(dir: string): Promise<number> {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as RecordManifest;
  let rows = 0;
  const run = async (name: string, call: (c: GoogleReadClient) => Promise<void>) => {
    const replay = replayFetch(loadCassette(join(dir, `${name}.json`)));
    const api = new GoogleAdsClient({
      tokens: new StaticTokenProvider(FAKE_TOKEN),
      fetch: replay.fetch,
      sleep: () => Promise.resolve(), // recordings may hold retried exchanges: never sleep for real
      ...(m.loginCustomerId === null ? {} : { loginCustomerId: m.loginCustomerId }),
    });
    await call(
      new GoogleReadClient({ api, conversionActionIds: m.conversionActionIds, now: () => new Date(m.recordedAt) }),
    );
    expect(replay.remaining(), `${name}: unused exchanges`).toBe(0);
  };
  await run('account', async (c) => {
    expect((await c.getAccountInfo(m.account)).timezone).not.toBe('');
  });
  await run('entities', async (c) => {
    for (const r of await c.listEntities(m.account, ['campaign', 'ad_group', 'keyword', 'budget'])) {
      rows += AdEntityRecord.parse(r) ? 1 : 0;
    }
  });
  for (const level of ['campaign', 'ad_group', 'keyword'] as const) {
    await run(`metrics-${level}`, async (c) => {
      for (const r of await c.getMetricsDaily(m.account, m.range, level)) rows += MetricRow.parse(r) ? 1 : 0;
    });
  }
  await run('search-terms', async (c) => {
    for (const r of await c.getSearchTerms(m.account, m.range)) rows += SearchTermRow.parse(r) ? 1 : 0;
  });
  await run('clicks', async (c) => {
    for (const r of await c.getClickIds(m.account, m.clickDay)) rows += ClickRow.parse(r) ? 1 : 0;
  });
  await run('snapshot', async (c) => {
    for (const ref of m.snapshotRefs) expect((await c.snapshot(ref)).hash).toMatch(/^[a-f0-9]{64}$/);
  });
  await run('trust', async (c) => {
    TrustSignalRow.parse(await c.trustSignals(m.account, m.range));
  });
  return rows;
}

const RECORDED = join(FIXTURES, 'recorded');

describe.skipIf(!existsSync(join(RECORDED, 'manifest.json')))('recorded Google fixtures', () => {
  it('replay through every method and satisfy the contracts', async () => {
    expect(await replayRecorded(RECORDED)).toBeGreaterThan(0);
  });
});

describe('record → replay round trip', () => {
  it('records redacted cassettes that replay on their own', async () => {
    // 10:30 in Singapore on 2026-10-01: 3 days back is the hand-written fixtures' 2026-09-28..30, clicks on the 30th.
    const now = new Date('2026-10-01T02:30:00Z');
    const live = replayFetch(
      [
        'account',
        'entities',
        'metrics-campaign-v1',
        'metrics-ad_group',
        'metrics-keyword',
        'search-terms',
        'clicks',
        'snapshot',
        'trust',
      ].map(cassette),
    );
    const dir = mkdtempSync(join(tmpdir(), 'recorded-google-'));
    const result = await recordGoogleFixtures({
      tokens: new StaticTokenProvider(FAKE_TOKEN),
      account: ACCOUNT,
      loginCustomerId: MANAGER,
      days: 3,
      conversionActionIds: [KPI_ACTION],
      outDir: dir,
      fetch: live.fetch,
      now,
    });
    expect(live.remaining()).toBe(0);
    expect(result).toMatchObject({ entities: 13, searchTerms: 2, clicks: 2 });
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(findSecrets(text), f).toEqual([]);
      expect(text).not.toContain(FAKE_TOKEN);
      expect(text).not.toContain('Signups - Search'); // names are replaced
      expect(text).not.toContain('photo sharing app for weddings'); // and search terms
    }
    expect(await replayRecorded(dir)).toBeGreaterThan(0);
  });
});
