import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob, getJob } from '../src/queue/jobs.ts';
import { contendForLeadership } from '../src/queue/leader.ts';
import { PermanentJobError, startQueueRunner, type QueueRunner } from '../src/queue/runner.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const HOUR = 3_600_000;

describe('queue runner', () => {
  let runner: QueueRunner | null = null;
  const stopRunner = async () => {
    await runner?.stop();
    runner = null;
  };

  it('wakes on NOTIFY and completes the job (polling alone would take an hour)', async () => {
    const seen: string[] = [];
    runner = startQueueRunner({
      db: t.db,
      listenUrl: t.url,
      queue: 'worker',
      pollMs: HOUR,
      handlers: {
        echo: (job) => {
          seen.push(String((job.payload as Record<string, unknown>)['n']));
          return Promise.resolve();
        },
      },
    });
    try {
      await new Promise((r) => setTimeout(r, 300)); // let the listener connect and the first empty claim sleep
      const job = await enqueueJob(t.db, { queue: 'worker', kind: 'echo', payload: { n: 7 } });
      await expect.poll(() => seen, { timeout: 3000 }).toEqual(['7']);
      await expect.poll(async () => (await getJob(t.db, job.id))?.status, { timeout: 3000 }).toBe('done');
    } finally {
      await stopRunner();
    }
  });

  it('falls back to polling without a listener, and records failures', async () => {
    runner = startQueueRunner({
      db: t.db,
      queue: 'gateway',
      pollMs: 50,
      handlers: {
        flaky: () => Promise.reject(new Error('platform timeout')),
        broken: () => Promise.reject(new PermanentJobError('bad payload')),
      },
    });
    try {
      const flaky = await enqueueJob(t.db, { queue: 'gateway', kind: 'flaky' });
      const broken = await enqueueJob(t.db, { queue: 'gateway', kind: 'broken' });
      const unknown = await enqueueJob(t.db, { queue: 'gateway', kind: 'no-such-kind' });
      await expect
        .poll(async () => (await getJob(t.db, flaky.id))?.lastError, { timeout: 3000 })
        .toBe('platform timeout');
      expect(await getJob(t.db, flaky.id)).toMatchObject({ status: 'queued', attempts: 1 }); // backed off
      await expect.poll(async () => (await getJob(t.db, broken.id))?.status, { timeout: 3000 }).toBe('failed');
      await expect.poll(async () => (await getJob(t.db, unknown.id))?.status, { timeout: 3000 }).toBe('failed');
      expect((await getJob(t.db, unknown.id))?.lastError).toBe('no handler for job kind "no-such-kind"');
    } finally {
      await stopRunner();
    }
  });

  it('stop() aborts the running job and waits for it', async () => {
    let aborted = false;
    runner = startQueueRunner({
      db: t.db,
      queue: 'worker',
      pollMs: 50,
      handlers: {
        slow: (_job, { signal }) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('stopped'));
            });
          }),
      },
    });
    const job = await enqueueJob(t.db, { queue: 'worker', kind: 'slow' });
    await expect.poll(async () => (await getJob(t.db, job.id))?.status, { timeout: 3000 }).toBe('running');
    await stopRunner();
    expect(aborted).toBe(true);
    expect(await getJob(t.db, job.id)).toMatchObject({ status: 'queued', lastError: 'stopped' });
  });
});

describe('leader lock', () => {
  it('a second contender waits, and takes over when the leader disconnects', async () => {
    const lockKey = 4242;
    const a = contendForLeadership({ url: t.url, lockKey, retryMs: 50 });
    await expect.poll(() => a.isLeader(), { timeout: 3000 }).toBe(true);
    const b = contendForLeadership({ url: t.url, lockKey, retryMs: 50 });
    try {
      await new Promise((r) => setTimeout(r, 300)); // several retries
      expect(b.isLeader()).toBe(false);
      await a.stop();
      expect(a.isLeader()).toBe(false);
      await expect.poll(() => b.isLeader(), { timeout: 3000 }).toBe(true);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('loses leadership when its connection is killed, and Postgres releases the lock', async () => {
    const lockKey = 4343;
    let lost = 0;
    const a = contendForLeadership({ url: t.url, lockKey, retryMs: 60_000, onLost: () => lost++, onError: () => {} });
    await expect.poll(() => a.isLeader(), { timeout: 3000 }).toBe(true);
    const admin = new pg.Client({ connectionString: t.url });
    await admin.connect();
    try {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_locks
         where locktype = 'advisory' and objid = $1 and pid <> pg_backend_pid()`,
        [lockKey],
      );
      await expect.poll(() => a.isLeader(), { timeout: 3000 }).toBe(false);
      expect(lost).toBe(1);
      const res = await admin.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [lockKey]);
      expect(res.rows[0]?.locked).toBe(true); // released by the dead session
    } finally {
      await admin.end();
      await a.stop();
    }
  });
});
