import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  releaseJob,
  getJob,
  heartbeatJob,
  reclaimExpiredJobs,
  type JobQueue,
} from '../src/queue/jobs.ts';
import { listUnsentNotifications } from '../src/repos/plumbing.ts';
import { jobs } from '../src/schema.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { uniq } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Each test uses its own job kind, so tests sharing this database never claim each other's jobs. */
const claim = (kind: string, workerId = 'w1', queue: JobQueue = 'worker', leaseMs?: number) =>
  claimJob(t.db, { queue, workerId, kinds: [kind], ...(leaseMs === undefined ? {} : { leaseMs }) });
const makeDue = (id: string) =>
  t.db
    .update(jobs)
    .set({ runAt: sql`now()` })
    .where(eq(jobs.id, id));

describe('claiming', () => {
  it('never gives the same job to two claimers', async () => {
    const kind = uniq('k');
    for (let i = 0; i < 20; i++) await enqueueJob(t.db, { queue: 'worker', kind });
    const claims = await Promise.all(Array.from({ length: 30 }, (_, i) => claim(kind, `w${i}`)));
    const ids = claims.filter((j) => j !== null).map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('respects priority, then run_at', async () => {
    const kind = uniq('k');
    const low = await enqueueJob(t.db, { queue: 'worker', kind, priority: 0, runAt: new Date(Date.now() - 60_000) });
    const high = await enqueueJob(t.db, { queue: 'worker', kind, priority: 100 });
    const midNew = await enqueueJob(t.db, { queue: 'worker', kind, priority: 50 });
    const midOld = await enqueueJob(t.db, { queue: 'worker', kind, priority: 50, runAt: new Date(Date.now() - 1000) });
    const order = [];
    for (let i = 0; i < 4; i++) order.push((await claim(kind))?.id);
    expect(order).toEqual([high.id, midOld.id, midNew.id, low.id]);
    expect(await claim(kind)).toBeNull();
  });

  it('keeps the two queues apart and skips jobs that are not due', async () => {
    const kind = uniq('k');
    await enqueueJob(t.db, { queue: 'gateway', kind });
    await enqueueJob(t.db, { queue: 'worker', kind, runAt: new Date(Date.now() + 60_000) });
    expect(await claim(kind, 'w1', 'worker')).toBeNull();
    const g = await claim(kind, 'g1', 'gateway');
    expect(g).toMatchObject({ queue: 'gateway', status: 'running', leasedBy: 'g1', attempts: 1 });
  });

  it('completes only while the lease is held', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind });
    await claim(kind, 'w1');
    expect(await completeJob(t.db, { jobId: job.id, workerId: 'someone-else' })).toBe(false);
    expect(await heartbeatJob(t.db, { jobId: job.id, workerId: 'w1' })).toBe(true);
    expect(await completeJob(t.db, { jobId: job.id, workerId: 'w1' })).toBe(true);
    expect(await getJob(t.db, job.id)).toMatchObject({ status: 'done', leasedBy: null });
    expect(await completeJob(t.db, { jobId: job.id, workerId: 'w1' })).toBe(false);
  });
});

describe('release', () => {
  it('hands a job back without counting the attempt', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind });
    await claim(kind, 'w1');
    expect(await releaseJob(t.db, { jobId: job.id, workerId: 'other' })).toBe(false);
    expect(await releaseJob(t.db, { jobId: job.id, workerId: 'w1' })).toBe(true);
    expect(await getJob(t.db, job.id)).toMatchObject({ status: 'queued', attempts: 0, leasedBy: null });
    expect((await claim(kind, 'w2'))?.id).toBe(job.id);
  });
});

describe('leases', () => {
  it('reclaims an expired lease; the old holder loses it', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind });
    await claim(kind, 'dead-worker', 'worker', 1);
    await delay(20);
    const { requeued } = await reclaimExpiredJobs(t.db, { queue: 'worker' });
    expect(requeued.map((j) => j.id)).toContain(job.id);
    expect(await getJob(t.db, job.id)).toMatchObject({
      status: 'queued',
      leasedBy: null,
      lastError: 'lease expired (held by dead-worker)',
    });
    expect(await heartbeatJob(t.db, { jobId: job.id, workerId: 'dead-worker' })).toBe(false);
    expect(await completeJob(t.db, { jobId: job.id, workerId: 'dead-worker' })).toBe(false);
    expect((await claim(kind, 'w2'))?.id).toBe(job.id);
  });

  it('does not reclaim a live lease, nor another queue', async () => {
    const kind = uniq('k');
    const live = await enqueueJob(t.db, { queue: 'worker', kind });
    await claim(kind, 'w1');
    const other = await enqueueJob(t.db, { queue: 'gateway', kind });
    await claim(kind, 'g1', 'gateway', 1);
    await delay(20);
    const { requeued } = await reclaimExpiredJobs(t.db, { queue: 'worker' });
    expect(requeued.map((j) => j.id)).not.toContain(live.id);
    expect(await getJob(t.db, other.id)).toMatchObject({ status: 'running' });
    await reclaimExpiredJobs(t.db, { queue: 'gateway' });
    expect(await getJob(t.db, other.id)).toMatchObject({ status: 'queued' });
  });

  it('fails a reclaimed job that has used all its attempts, and alerts', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind, maxAttempts: 1 });
    await claim(kind, 'w1', 'worker', 1);
    await delay(20);
    const { failed } = await reclaimExpiredJobs(t.db, { queue: 'worker' });
    expect(failed.map((j) => j.id)).toContain(job.id);
    const alerts = await listUnsentNotifications(t.db, 500);
    expect(
      alerts.some((n) => n.kind === 'job_failed' && (n.payload as Record<string, unknown>)['jobId'] === job.id),
    ).toBe(true);
  });
});

describe('failures', () => {
  it('backs off 1 min × 2^(attempt−1)', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind });
    const secondsUntilRun = async () => {
      const [row] = await t.db
        .select({ s: sql<number>`extract(epoch from (${jobs.runAt} - now()))::float8` })
        .from(jobs)
        .where(eq(jobs.id, job.id));
      return row?.s ?? NaN;
    };

    await claim(kind);
    expect(await failJob(t.db, { jobId: job.id, workerId: 'w1', error: 'boom 1' })).toBe('queued');
    expect(await secondsUntilRun()).toBeCloseTo(60, -1);
    expect(await claim(kind)).toBeNull(); // not due yet

    await makeDue(job.id);
    await claim(kind);
    expect(await failJob(t.db, { jobId: job.id, workerId: 'w1', error: 'boom 2' })).toBe('queued');
    expect(await secondsUntilRun()).toBeCloseTo(120, -1);
    expect(await getJob(t.db, job.id)).toMatchObject({ attempts: 2, lastError: 'boom 2', leasedBy: null });
  });

  it('marks the job failed after max_attempts and alerts Marcus', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind, maxAttempts: 2 });
    await claim(kind);
    expect(await failJob(t.db, { jobId: job.id, workerId: 'w1', error: 'once' })).toBe('queued');
    await makeDue(job.id);
    await claim(kind);
    expect(await failJob(t.db, { jobId: job.id, workerId: 'w1', error: 'twice' })).toBe('failed');
    expect(await getJob(t.db, job.id)).toMatchObject({ status: 'failed', attempts: 2 });
    await makeDue(job.id);
    expect(await claim(kind)).toBeNull();
    const alerts = await listUnsentNotifications(t.db, 500);
    const alert = alerts.find((n) => (n.payload as Record<string, unknown>)['jobId'] === job.id);
    expect(alert).toMatchObject({ kind: 'job_failed', payload: { jobKind: kind, attempts: 2, error: 'twice' } });
  });

  it('fails at once on a permanent error, and ignores a failure after the lease was lost', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'worker', kind });
    await claim(kind);
    expect(await failJob(t.db, { jobId: job.id, workerId: 'w1', error: 'bad input', permanent: true })).toBe('failed');
    expect(await failJob(t.db, { jobId: job.id, workerId: 'w1', error: 'again' })).toBeNull();
  });
});

describe('wake-ups', () => {
  it('NOTIFY jobs_<queue> arrives at commit, not before', async () => {
    const listener = new pg.Client({ connectionString: t.url });
    await listener.connect();
    const received: string[] = [];
    listener.on('notification', (m) => received.push(`${m.channel}:${m.payload ?? ''}`));
    await listener.query('listen jobs_gateway');
    try {
      const kind = uniq('k');
      let id = '';
      await t.db.transaction(async (tx) => {
        id = (await enqueueJob(tx, { queue: 'gateway', kind })).id;
        await delay(50);
        expect(received).toEqual([]);
      });
      await expect.poll(() => received, { timeout: 2000 }).toEqual([`jobs_gateway:${id}`]);
    } finally {
      await listener.end();
    }
  });
});

describe('database roles', () => {
  it('lets the gateway role claim and fail its jobs', async () => {
    const kind = uniq('k');
    const job = await enqueueJob(t.db, { queue: 'gateway', kind, maxAttempts: 1 });
    await t.db.transaction(async (tx) => {
      await tx.execute(sql`set local role agent_gateway`);
      const claimed = await claimJob(tx, { queue: 'gateway', workerId: 'gw', kinds: [kind] });
      expect(claimed?.id).toBe(job.id);
      expect(await failJob(tx, { jobId: job.id, workerId: 'gw', error: 'x' })).toBe('failed');
    });
  });
});
