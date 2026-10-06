import { randomBytes } from 'node:crypto';
import { advance, createProduct, getCycle, startScheduled } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resumeCyclesAtStartup } from '../src/startup.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const logged: string[] = [];
const logger = { info: (_: object, msg: string) => void logged.push(msg) };

describe('worker startup', () => {
  it('without a database or key, resumes nothing (the no-secrets smoke test)', async () => {
    expect(await resumeCyclesAtStartup({}, logger)).toBeNull();
    expect(logged.at(-1)).toMatch(/not resumed/);
  });

  it('resumes a daily cycle that a restart interrupted after its sync', async () => {
    const now = new Date();
    const product = await createProduct(t.db, {
      slug: 'restart',
      name: 'R',
      packId: 'test-pack',
      settings: TEST_SETTINGS,
    });
    const cycle = await startScheduled(t.db, {
      productId: product.id,
      kind: 'daily',
      cycleDate: '2026-10-01',
      startedAt: now,
    });
    await advance(t.db, cycle.id, 'synced');
    const env = { DATABASE_URL: t.url, VAULT_READ_KEY: `read-v1:${randomBytes(32).toString('base64')}` };
    const out = await resumeCyclesAtStartup(env, logger, () => now);
    expect(out?.resumed).toMatchObject([{ cycleId: cycle.id, outcome: 'finished', resumedFrom: 'synced' }]);
    // No account linked: the trust check fails, and the cycle still finishes.
    expect(await getCycle(t.db, cycle.id)).toMatchObject({ stageReached: 'done', trustResult: 'fail' });
  });
});
