import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tryAdvisoryLock } from '../src/queue/locks.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe('named advisory locks', () => {
  it('lets one holder at a time take a name, and frees it on release', async () => {
    const first = await tryAdvisoryLock(t.url, 'cycle:a');
    expect(first).not.toBeNull();
    expect(await tryAdvisoryLock(t.url, 'cycle:a')).toBeNull();
    const other = await tryAdvisoryLock(t.url, 'cycle:b'); // another name is independent
    expect(other).not.toBeNull();
    await first?.release();
    await first?.release(); // twice is fine
    const again = await tryAdvisoryLock(t.url, 'cycle:a');
    expect(again).not.toBeNull();
    await again?.release();
    await other?.release();
  });

  it('is freed when the holding session ends without releasing (a killed process)', async () => {
    const held = await tryAdvisoryLock(t.url, 'cycle:c', { applicationName: 'ads-lock-test' });
    expect(held).not.toBeNull();
    // Kill the holder's backend from outside, as if its process had died.
    const admin = new pg.Client({ connectionString: t.url });
    await admin.connect();
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where application_name = 'ads-lock-test' and datname = current_database()`,
    );
    await admin.end();
    const next = await tryAdvisoryLock(t.url, 'cycle:c');
    expect(next).not.toBeNull();
    await next?.release();
    await held?.release(); // its connection is gone: still safe
  });
});
