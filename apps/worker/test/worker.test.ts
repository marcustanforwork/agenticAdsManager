// The worker service end to end (M07), against a real Postgres and fake Telegram and healthchecks endpoints: the
// startup reconciliation resumes an interrupted cycle, the leader catches up the day's scheduled runs, the job
// runner runs every active product's cycle, the outbox reaches Telegram, and the heartbeats are pinged.
import { randomBytes } from 'node:crypto';
import { advance, createProduct, getCycle, listCycles, schema, startScheduled } from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SendOptions, TelegramApi } from '../src/telegram/bot.ts';
import { startWorker, telegramOwner, workerConfigured } from '../src/worker.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const OWNER = 515151;
// Monday 2026-10-12, 08:30 in Singapore: both the daily (06:00) and the weekly (07:00) runs are due today.
const NOW = new Date('2026-10-12T00:30:00Z');

describe('worker configuration', () => {
  it('without a database or key, the worker runs its health endpoint only', async () => {
    expect(workerConfigured({})).toBe(false);
    expect(await startWorker({ env: {}, logger: silent })).toBeNull();
  });
  it('reads Marcus’s Telegram id, refusing anything but a number', () => {
    expect(telegramOwner({})).toBeNull();
    expect(telegramOwner({ TELEGRAM_OWNER_ID: ' 123 ' })).toBe(123);
    expect(() => telegramOwner({ TELEGRAM_OWNER_ID: '@marcus' })).toThrow(/numeric/);
  });
});

describe('the worker service', () => {
  it('resumes, catches up the day, reports to Telegram, pings its heartbeats and stops cleanly', async () => {
    const product = await createProduct(t.db, {
      slug: 'svc',
      name: 'Service',
      packId: 'test-pack',
      timezone: 'Asia/Singapore',
      settings: TEST_SETTINGS,
    });
    await createProduct(t.db, {
      slug: 'asleep',
      name: 'Asleep',
      packId: 'test-pack',
      status: 'dormant',
      settings: TEST_SETTINGS,
    });
    // A daily cycle a restart interrupted after its sync.
    const interrupted = await startScheduled(t.db, {
      productId: product.id,
      kind: 'daily',
      cycleDate: '2026-10-12',
      startedAt: NOW,
    });
    await advance(t.db, interrupted.id, 'synced');

    const sent: { text: string; other?: SendOptions }[] = [];
    const api: TelegramApi = {
      sendMessage: (_chat, text, other) => {
        sent.push({ text, ...(other === undefined ? {} : { other }) });
        return Promise.resolve({ message_id: sent.length });
      },
      answerCallbackQuery: () => Promise.resolve(true),
      editMessageReplyMarkup: () => Promise.resolve(true),
      editMessageText: () => Promise.resolve(true),
    };
    let polling = 0;
    const pings: string[] = [];
    const worker = await startWorker({
      env: {
        DATABASE_URL: t.url,
        VAULT_READ_KEY: `read-v1:${randomBytes(32).toString('base64')}`,
        TELEGRAM_OWNER_ID: String(OWNER),
        HEALTHCHECK_WORKER_URL: 'https://hc.invalid/worker',
        HEALTHCHECK_DAILY_SYNC_URL: 'https://hc.invalid/daily',
      },
      logger: silent,
      now: () => NOW,
      packs: createRegistry([]),
      pingFetch: (url) => {
        pings.push(url instanceof Request ? url.url : url.toString());
        return Promise.resolve(new Response('OK'));
      },
      telegram: {
        api,
        startPolling: () => {
          polling += 1;
          return { stop: () => Promise.resolve(void (polling -= 1)) };
        },
      },
      leaderRetryMs: 50,
      queuePollMs: 100,
      outboxMs: 100,
      schedule: false,
    });
    if (worker === null) throw new Error('worker not started');
    try {
      // Startup reconciliation finished the interrupted cycle (no account: the trust check fails).
      expect(await getCycle(t.db, interrupted.id)).toMatchObject({ stageReached: 'done', trustResult: 'fail' });
      await vi.waitFor(() => expect(worker.isLeader()).toBe(true), { timeout: 5_000 });
      expect(polling).toBe(1);
      // The catch-up queued the daily and weekly runs: the weekly cycle ran (a diagnostic brief, the trust check
      // having failed), the daily one was already finished. The dormant product ran nothing.
      await vi.waitFor(
        async () => {
          const jobs = await t.db.select().from(schema.jobs);
          expect(jobs.map((j) => [j.kind, j.status]).sort()).toEqual([
            ['daily', 'done'],
            ['weekly', 'done'],
          ]);
        },
        { timeout: 10_000, interval: 100 },
      );
      const cycles = await listCycles(t.db, product.id);
      expect(cycles.map((c) => [c.kind, c.stageReached]).sort()).toEqual([
        ['daily', 'done'],
        ['weekly', 'done'],
      ]);
      // Telegram got the recovery note, the digest (a failed check is always sent) and the diagnostic brief, with
      // its feedback buttons, and an alert for each cycle whose trust check failed (M09a).
      await vi.waitFor(() => expect(sent).toHaveLength(5), { timeout: 5_000, interval: 50 });
      const texts = sent.map((m) => m.text).join('\n---\n');
      expect(texts).toContain('<b>The worker restarted and recovered its work</b>');
      expect(texts).toContain('cyclesResumed: 1');
      expect(texts.split('A trust check failed: this cycle stopped before the analysis')).toHaveLength(3);
      expect(texts).toContain('<b>Service · 2026-10-11</b>');
      expect(texts).toContain('<b>Service: diagnostic brief, 2026-10-05 to 2026-10-11</b>');
      expect(sent.some((m) => m.other?.reply_markup !== undefined)).toBe(true);
      // Heartbeats: the worker is alive, and the daily run reported in.
      expect(pings).toContain('https://hc.invalid/worker');
      await vi.waitFor(() => expect(pings).toContain('https://hc.invalid/daily'), { timeout: 5_000 });
      expect(pings.some((p) => p.endsWith('/fail'))).toBe(false);
    } finally {
      await worker.stop();
    }
    expect(polling).toBe(0);
  }, 30_000);
});
