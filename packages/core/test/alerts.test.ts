// Alerts through the outbox (M09a): the routing table, once per key, drift on an entity with an open proposal, and a
// failed scheduled cycle.
import {
  createProposal,
  listAccounts,
  listUnsentNotifications,
  recordDrift,
  transitionProposal,
  type Notification,
} from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { parseMasterKey } from '@ads/vault';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CycleDeps,
  type CycleEvent,
  type StageStep,
  alertOnCycleEvent,
  driftOnOpenProposals,
  routeCycleEvent,
  runCycle,
} from '../src/index.ts';
import { makeAdWorld } from './support/adWorld.ts';

describe('the alert routing table', () => {
  const cases: [string, CycleEvent, string | null][] = [
    ['trust ok', { event: 'trust_checked', result: 'ok', failed: [] }, null],
    ['trust degraded', { event: 'trust_checked', result: 'degraded', failed: [] }, null],
    [
      'trust failed',
      { event: 'trust_checked', result: 'fail', failed: [{ check: 'data_fresh', account: 'meta:act_1' }] },
      'trust_check_failed',
    ],
    ['no drift on open proposals', { event: 'drift', onOpenProposals: [] }, null],
    [
      'drift on an open proposal',
      {
        event: 'drift',
        onOpenProposals: [{ target: 'google:1:campaign:2', fields: ['status'], proposals: ['abcdefgh'] }],
      },
      'drift_on_open_proposal',
    ],
    ['daily cycle failed', { event: 'failed', kind: 'daily', stage: 'synced', error: 'boom' }, 'cycle_failed'],
    ['weekly cycle failed', { event: 'failed', kind: 'weekly', stage: 'analysed', error: 'boom' }, 'cycle_failed'],
    ['manual cycle failed', { event: 'failed', kind: 'manual', stage: 'synced', error: 'boom' }, null],
  ];
  it.each(cases)('%s', (_name, event, alert) => {
    expect(routeCycleEvent(event)?.alert ?? null).toBe(alert);
  });

  it('keeps an error short', () => {
    const routed = routeCycleEvent({ event: 'failed', kind: 'daily', stage: 'synced', error: 'x'.repeat(2000) });
    expect(String(routed?.payload['error']).length).toBe(500);
  });
});

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const alertsOf = async (productId: string): Promise<Notification[]> =>
  (await listUnsentNotifications(t.db, 1000)).filter((n) => n.kind === 'alert' && n.productId === productId);

describe('raising alerts', () => {
  it('queues one alert per (alert, cycle), whatever the retries', async () => {
    const w = await makeAdWorld(t.db, { slug: `al-${randomBytes(3).toString('hex')}` });
    const cycleId = '00000000-0000-4000-8000-000000000001';
    const event: CycleEvent = {
      event: 'trust_checked',
      result: 'fail',
      failed: [{ check: 'data_fresh', account: null }],
    };
    expect(await alertOnCycleEvent(t.db, { productId: w.productId, cycleId, event })).toBe(true);
    expect(await alertOnCycleEvent(t.db, { productId: w.productId, cycleId, event })).toBe(false);
    expect(
      await alertOnCycleEvent(t.db, { productId: w.productId, cycleId, event: { ...event, result: 'degraded' } }),
    ).toBe(false);
    expect((await alertsOf(w.productId)).map((n) => n.payload)).toEqual([
      {
        alert: 'trust_check_failed',
        key: `trust_check_failed:${cycleId}`,
        cycleId,
        failed: [{ check: 'data_fresh', account: null }],
      },
    ]);
  });

  it('finds drift on entities with an open proposal only, grouped by entity', async () => {
    const w = await makeAdWorld(t.db, { slug: `dr-${randomBytes(3).toString('hex')}` });
    const since = new Date(Date.now() - 1000);
    const watched = await w.entity('google', 'campaign', '77');
    const other = await w.entity('google', 'campaign', '78');
    const closed = await w.entity('google', 'campaign', '79');
    const google = (await listAccounts(t.db, w.productId)).find((a) => a.platform === 'google')?.externalId ?? '';
    const ref = (externalId: string) => ({
      platform: 'google' as const,
      accountId: google,
      type: 'campaign' as const,
      externalId,
    });
    const pause = (externalId: string) =>
      createProposal(t.db, {
        productId: w.productId,
        origin: 'operator',
        action: { action: 'pause_entity', target: ref(externalId) },
        undo: { action: 'resume_entity', target: ref(externalId) },
        preconditionHash: 'h',
        preconditionFields: ['status'],
        rationale: 'r',
        expectedEffect: 'e',
      });
    const open = await pause('77');
    const done = await pause('79');
    await transitionProposal(t.db, { proposalId: done.id, to: 'rejected' });
    for (const [entity, field] of [
      [watched, 'status'],
      [watched, 'dailyBudgetMicros'],
      [watched, 'status'],
      [other, 'status'],
      [closed, 'status'],
    ] as const) {
      await recordDrift(t.db, { productId: w.productId, adEntityId: entity.id, field, expected: 'a', observed: 'b' });
    }
    expect(await driftOnOpenProposals(t.db, { productId: w.productId, since })).toEqual([
      { target: `google:${google}:campaign:77`, fields: ['dailyBudgetMicros', 'status'], proposals: [open.shortId] },
    ]);
    expect(await driftOnOpenProposals(t.db, { productId: w.productId, since: new Date(Date.now() + 60_000) })).toEqual(
      [],
    );
  });
});

describe('a failed cycle', () => {
  const failing: StageStep = {
    stage: 'synced',
    kinds: ['daily', 'weekly', 'manual'],
    run: () => Promise.reject(new Error('the platform is down')),
  };
  const deps = (): CycleDeps => ({
    db: t.db,
    lockUrl: t.url,
    masterKey: parseMasterKey(`read-v1:${randomBytes(32).toString('base64')}`),
    process: 'worker',
    now: () => new Date(),
    env: {},
    stages: [failing],
  });

  it('alerts once for a scheduled cycle, even when the job retries it; never for a manual one', async () => {
    const w = await makeAdWorld(t.db, { slug: `cf-${randomBytes(3).toString('hex')}` });
    await expect(runCycle(deps(), { productId: w.productId, kind: 'daily' })).rejects.toThrow('the platform is down');
    await expect(runCycle(deps(), { productId: w.productId, kind: 'daily' })).rejects.toThrow('the platform is down');
    const alerts = await alertsOf(w.productId);
    expect(alerts.map((n) => n.payload)).toEqual([
      expect.objectContaining({
        alert: 'cycle_failed',
        kind: 'daily',
        stage: 'synced',
        error: 'Error: the platform is down',
      }),
    ]);
    await expect(runCycle(deps(), { productId: w.productId, kind: 'manual' })).rejects.toThrow('the platform is down');
    expect(await alertsOf(w.productId)).toHaveLength(1);
  });
});
