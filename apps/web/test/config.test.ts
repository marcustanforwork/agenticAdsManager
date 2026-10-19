// Which database the dashboard may use (M10a): previews never get the production URL.
import { describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../src/lib/config.ts';

const PROD = 'postgres://dash:pw@ep-prod-123-pooler.ap-southeast-1.aws.neon.tech/ads';
const DEV = 'postgres://dash:pw@ep-dev-456-pooler.ap-southeast-1.aws.neon.tech/ads';

describe('databaseUrlFromEnv', () => {
  it('production reads DASHBOARD_DATABASE_URL', () => {
    expect(databaseUrlFromEnv({ VERCEL_ENV: 'production', DASHBOARD_DATABASE_URL: PROD })).toBe(PROD);
  });

  it('a preview, a development deployment or a local run never reads the production URL, even if it is set', () => {
    for (const VERCEL_ENV of ['preview', 'development', undefined]) {
      const env = { DASHBOARD_DATABASE_URL: PROD, ...(VERCEL_ENV === undefined ? {} : { VERCEL_ENV }) };
      expect(() => databaseUrlFromEnv(env)).toThrow('DASHBOARD_DEV_DATABASE_URL is not set');
      expect(databaseUrlFromEnv({ ...env, DASHBOARD_DEV_DATABASE_URL: DEV })).toBe(DEV);
    }
  });

  it("on Vercel, the URL must be Neon's pooled host; locally any URL works", () => {
    const direct = 'postgres://dash:pw@ep-prod-123.ap-southeast-1.aws.neon.tech/ads';
    expect(() => databaseUrlFromEnv({ VERCEL_ENV: 'production', DASHBOARD_DATABASE_URL: direct })).toThrow(/pooled/);
    expect(databaseUrlFromEnv({ DASHBOARD_DEV_DATABASE_URL: 'postgres://localhost:5432/ads' })).toBe(
      'postgres://localhost:5432/ads',
    );
  });

  it('refuses a missing or malformed URL', () => {
    expect(() => databaseUrlFromEnv({ VERCEL_ENV: 'production' })).toThrow('DASHBOARD_DATABASE_URL is not set');
    expect(() => databaseUrlFromEnv({ DASHBOARD_DEV_DATABASE_URL: 'not a url' })).toThrow('not a URL');
  });
});
