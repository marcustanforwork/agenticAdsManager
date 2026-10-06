import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { replayFetch, type ReplayFetch } from '@ads/connector-testing';
import {
  getCycle,
  listCycles,
  listTrustChecks,
  setProductStatus,
  startManual,
  tryAdvisoryLock,
  upsertAccount,
} from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { parseMasterKey } from '@ads/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CycleDeps, STAGES, resumeUnfinishedCycles, runCycle } from '../src/index.ts';
import { NOW, type World, googleCassettes, makeWorld, metaCassettes, tokenFetch } from './support/world.ts';

let t: TestDatabase;
let world: World;
const keyText = `read-v1:${randomBytes(32).toString('base64')}`;
beforeEach(async () => {
  t = await createTestDatabase();
  world = await makeWorld(t.db, { slug: 'cycle', masterKey: parseMasterKey(keyText) });
});
afterEach(async () => t.drop());

const fixtures = (): ReplayFetch => replayFetch([...metaCassettes(NOW), ...googleCassettes(NOW)]);
const deps = (replay: ReplayFetch, extra: Partial<CycleDeps> = {}): CycleDeps => ({
  db: t.db,
  lockUrl: t.url,
  masterKey: world.masterKey,
  process: 'worker',
  fetch: replay.fetch,
  tokenFetch,
  now: () => NOW,
  ...extra,
});
const count = async (table: string): Promise<number> =>
  (
    await t.pool.query<{ n: number }>(`select count(*)::int as n from ${table} where product_id = $1`, [
      world.productId,
    ])
  ).rows[0]?.n ?? -1;

describe('runCycle', () => {
  it('runs a daily cycle: sync, then trust check, then finishes; stages are recorded in order', async () => {
    const stages: string[] = [];
    const replay = fixtures();
    const summary = await runCycle(deps(replay, { onStage: (s) => void stages.push(s) }), {
      productId: world.productId,
      kind: 'daily',
    });
    expect(replay.remaining()).toBe(0);
    expect(stages).toEqual(['synced', 'trust_checked']);
    expect(summary).toMatchObject({
      product: 'cycle',
      kind: 'daily',
      cycleDate: '2026-10-01', // the product's day (Singapore), not UTC's
      outcome: 'finished',
      stageReached: 'done',
      trustResult: 'degraded', // the Meta fixture's spending limit is 82% used
    });
    expect(summary.resumedFrom).toBeUndefined();
    expect(summary.sync?.accounts.map((a) => a.outcome)).toEqual(['synced', 'synced']);
    expect(summary.trust?.checks.find((c) => c.check === 'spend_cap_headroom')).toMatchObject({
      account: 'meta:act_1234567890',
      result: 'warn',
    });
    const cycle = await getCycle(t.db, summary.cycleId ?? '');
    expect(cycle.finishedAt).not.toBeNull();
    expect(await listTrustChecks(t.db, cycle.id)).toHaveLength(7);
  });

  it('scheduled cycles are unique per product, kind and day, even when two runs race', async () => {
    const replay = fixtures();
    const results = await Promise.all([
      runCycle(deps(replay), { productId: world.productId, kind: 'daily' }),
      runCycle(deps(replay), { productId: world.productId, kind: 'daily' }),
    ]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes[0]).toMatch(/^(already_finished|busy)$/);
    expect(outcomes[1]).toBe('finished');
    expect(new Set(results.map((r) => r.cycleId)).size).toBe(1);
    expect(await listCycles(t.db, world.productId)).toHaveLength(1);
    expect(await count('trust_checks')).toBe(7);

    // Run again later the same day: nothing to do, and no API call.
    const quiet = replayFetch([]);
    const again = await runCycle(deps(quiet), { productId: world.productId, kind: 'daily' });
    expect(again.outcome).toBe('already_finished');
    expect(quiet.calls).toHaveLength(0);
    // A manual cycle is never limited.
    const manual = await runCycle(deps(fixtures()), { productId: world.productId, kind: 'manual' });
    expect(manual.outcome).toBe('finished');
    expect(await listCycles(t.db, world.productId)).toHaveLength(2);
  });

  it('--until stops after that stage; the next run resumes from stage_reached without syncing again', async () => {
    const first = await runCycle(deps(fixtures()), { productId: world.productId, kind: 'daily', until: 'synced' });
    expect(first).toMatchObject({ outcome: 'stopped', stageReached: 'synced', trustResult: null });
    expect((await getCycle(t.db, first.cycleId ?? '')).finishedAt).toBeNull();
    const snapshots = await count('ad_entity_snapshots');

    const quiet = replayFetch([]);
    const second = await runCycle(deps(quiet), { productId: world.productId, kind: 'daily' });
    expect(second).toMatchObject({ cycleId: first.cycleId, outcome: 'finished', resumedFrom: 'synced' });
    expect(second.sync).toBeUndefined();
    expect(quiet.calls).toHaveLength(0); // the trust check reads only the database
    expect(await count('ad_entity_snapshots')).toBe(snapshots);
  });

  it('a failed trust check stops the cycle: later stages are skipped, the diagnostic report still runs', async () => {
    // An account that never synced (no credential) fails data_fresh.
    await upsertAccount(t.db, { productId: world.productId, platform: 'meta', externalId: 'act_999' });
    const ran: string[] = [];
    const later = (stage: 'detected' | 'reported') => ({
      stage,
      kinds: ['daily', 'weekly', 'manual'] as const,
      run: () => {
        ran.push(stage);
        return Promise.resolve({});
      },
    });
    const summary = await runCycle(deps(fixtures(), { stages: [...STAGES, later('detected'), later('reported')] }), {
      productId: world.productId,
      kind: 'daily',
    });
    expect(summary).toMatchObject({ outcome: 'finished', trustResult: 'fail', stageReached: 'done' });
    expect(ran).toEqual(['reported']);
  });

  it('a product that is not active runs no cycle', async () => {
    await setProductStatus(t.db, world.productId, 'dormant');
    const summary = await runCycle(deps(replayFetch([])), { productId: world.productId, kind: 'daily' });
    expect(summary).toMatchObject({ outcome: 'skipped', detail: 'product is dormant', cycleId: null });
  });
});

describe('recovery', () => {
  it('resumes unfinished cycles, closes stale ones, and leaves running ones alone', async () => {
    const stopped = await runCycle(deps(fixtures()), { productId: world.productId, kind: 'daily', until: 'synced' });
    const stale = await startManual(t.db, { productId: world.productId, cycleDate: '2026-09-28' });
    await t.pool.query(`update cycles set started_at = $2 where id = $1`, [
      stale.id,
      new Date(NOW.getTime() - 30 * 3_600_000),
    ]);
    const running = await startManual(t.db, { productId: world.productId, cycleDate: '2026-10-01' });
    await t.pool.query(`update cycles set started_at = $2 where id = $1`, [running.id, NOW]);
    const held = await tryAdvisoryLock(t.url, `cycle:${running.id}`);
    try {
      const out = await resumeUnfinishedCycles(deps(replayFetch([])));
      expect(out.errors).toEqual([]);
      expect(out.abandoned).toEqual([stale.id]);
      const byId = new Map(out.resumed.map((r) => [r.cycleId, r]));
      expect(byId.get(stopped.cycleId)).toMatchObject({ outcome: 'finished', resumedFrom: 'synced' });
      expect(byId.get(running.id)?.outcome).toBe('busy');
      expect((await getCycle(t.db, stale.id)).error).toMatch(/abandoned/);
      expect((await getCycle(t.db, running.id)).finishedAt).toBeNull();
    } finally {
      await held?.release();
    }
  });
});

describe('crash-resume', () => {
  it('a child process killed after the sync: the rerun resumes at the trust check, with no duplicate snapshots', async () => {
    const child = spawn(
      process.execPath,
      ['--conditions=@ads/source', join(import.meta.dirname, 'support', 'cycleChild.ts')],
      {
        env: { ...process.env, CYCLE_DB_URL: t.url, CYCLE_PRODUCT_ID: world.productId, CYCLE_MASTER_KEY: keyText },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    const exited = new Promise<NodeJS.Signals | number | null>((resolve) =>
      child.on('exit', (code, signal) => resolve(signal ?? code)),
    );
    const synced = new Promise<void>((resolve, reject) => {
      createInterface({ input: child.stdout }).on('line', (line) => line === 'synced' && resolve());
      void exited.then(() => reject(new Error(`the child exited before syncing: ${stderr}`)));
    });
    await synced;
    child.kill('SIGKILL');
    expect(await exited).toBe('SIGKILL');

    const [cycle] = await listCycles(t.db, world.productId);
    expect(cycle).toMatchObject({ stageReached: 'synced', finishedAt: null });
    const snapshots = await count('ad_entity_snapshots');
    expect(snapshots).toBe(21);

    // The dead process's lock went with its connection; allow Postgres a moment to notice.
    const quiet = replayFetch([]);
    let rerun = await runCycle(deps(quiet), { productId: world.productId, kind: 'daily' });
    for (let i = 0; rerun.outcome === 'busy' && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      rerun = await runCycle(deps(quiet), { productId: world.productId, kind: 'daily' });
    }
    expect(rerun).toMatchObject({
      cycleId: cycle?.id,
      outcome: 'finished',
      resumedFrom: 'synced',
      stageReached: 'done',
      trustResult: 'degraded',
    });
    expect(quiet.calls).toHaveLength(0);
    expect(await count('ad_entity_snapshots')).toBe(snapshots);
    expect(await listTrustChecks(t.db, cycle?.id ?? '')).toHaveLength(7);
    expect(await listCycles(t.db, world.productId)).toHaveLength(1);
  }, 60_000);
});
