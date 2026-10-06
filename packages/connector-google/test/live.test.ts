// A live smoke test against the real Google Ads API, skipped unless LIVE=1 (BLUEPRINT M03). Read credentials
// only; it reads one account and records nothing:
//   LIVE=1 GOOGLE_CREDENTIAL=/path/to/key.json GOOGLE_ACCOUNT=1234567890 [GOOGLE_MANAGER=1112223333] \
//     pnpm test packages/connector-google/test/live.test.ts
import { readFileSync } from 'node:fs';
import { AdEntityRecord, MetricRow, localDate, minusDays } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import { GoogleAdsClient, GoogleReadClient, tokenProviderFor } from '../src/index.ts';

const env = process.env;

describe.skipIf(env['LIVE'] !== '1')('live Google Ads API (LIVE=1)', () => {
  it('signs in and reads the account, its campaigns and a week of campaign metrics', async () => {
    const account = env['GOOGLE_ACCOUNT'] ?? '';
    const manager = env['GOOGLE_MANAGER'];
    const api = new GoogleAdsClient({
      tokens: tokenProviderFor(JSON.parse(readFileSync(env['GOOGLE_CREDENTIAL'] ?? '', 'utf8'))),
      ...(manager === undefined ? {} : { loginCustomerId: manager }),
    });
    const client = new GoogleReadClient({ api, conversionActionIds: [] });
    const info = await client.getAccountInfo(account);
    expect(info.manager).toBe(false);
    for (const r of await client.listEntities(account, ['campaign'])) AdEntityRecord.parse(r);
    const today = localDate(new Date(), info.timezone);
    const rows = await client.getMetricsDaily(
      account,
      { from: minusDays(today, 7), to: minusDays(today, 1) },
      'campaign',
    );
    for (const r of rows) MetricRow.parse(r);
    expect(api.requestCount).toBeLessThanOrEqual(5);
  }, 60_000);
});
