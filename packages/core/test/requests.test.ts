import type { OperatorRequest } from '@ads/contracts';
import {
  claimJob,
  createProduct,
  enqueueJob,
  getJob,
  getOperatorRequest,
  getProduct,
  getSettingsHistory,
  insertBrief,
  getBrief,
  listUnsentNotifications,
  setProductStatus,
} from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HANDLERS } from '../src/requests/handlers.ts';
import { applySettingsPatch } from '../src/requests/settingsPatch.ts';
import {
  actorsFromEnv,
  processQueuedRequests,
  processRequest,
  submitRequest,
  type RequestContext,
} from '../src/requests/processor.ts';
import { recoverWorker } from '../src/recovery.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const MARCUS = 'telegram:1001';
const ctx: RequestContext = { actors: actorsFromEnv(` ${MARCUS}, cli:marcus ,`) };

const makeProduct = (status: 'active' | 'dormant' = 'active') =>
  createProduct(t.db, {
    slug: `p-${randomBytes(4).toString('hex')}`,
    name: 'Test',
    packId: 'test-pack',
    status,
    settings: TEST_SETTINGS,
  });

const submit = (request: OperatorRequest, actor = MARCUS) =>
  submitRequest(t.db, { request, actor, channel: 'telegram' }, ctx);

/** Records a raw row the way the dashboard does: its role may only insert, and nothing validates it yet. */
async function dashboardInsert(kind: string, payload: unknown, actor = 'web:marcus@example.com'): Promise<string> {
  const client = await t.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role agent_dashboard');
    const { rows } = await client.query<{ id: string }>(
      `insert into operator_requests (kind, payload, actor, channel) values ($1, $2, $3, 'web') returning id`,
      [kind, JSON.stringify(payload), actor],
    );
    await client.query('commit');
    return rows[0]?.id ?? '';
  } finally {
    client.release();
  }
}

describe('actor and schema checks', () => {
  it('parses the allowed actors from config', () => {
    expect([...ctx.actors].sort()).toEqual(['cli:marcus', MARCUS]);
    expect(actorsFromEnv(undefined).size).toBe(0);
  });

  it('refuses an unknown actor and changes nothing', async () => {
    const p = await makeProduct();
    const { id, outcome } = await submit({ kind: 'halt', productId: p.id }, 'telegram:666');
    expect(outcome).toEqual({ status: 'refused', result: { reason: 'unknown actor' } });
    expect((await getProduct(t.db, p.id)).status).toBe('active');
    expect(await getOperatorRequest(t.db, id)).toMatchObject({
      status: 'refused',
      processedAt: expect.any(Date) as unknown,
    });
  });

  it('refuses a malformed row from the dashboard, and a kind that does not match its payload', async () => {
    const bad = await dashboardInsert('halt', { kind: 'halt', productId: 'not-a-uuid' });
    const mismatched = await dashboardInsert('resume_agent', { kind: 'halt', productId: null });
    await processRequest(t.db, bad, ctx);
    await processRequest(t.db, mismatched, ctx);
    expect(await getOperatorRequest(t.db, bad)).toMatchObject({
      status: 'refused',
      result: { reason: 'invalid request', issues: [expect.stringContaining('productId')] },
    });
    expect((await getOperatorRequest(t.db, mismatched)).result).toEqual({
      reason: 'the kind column (resume_agent) does not match the request',
    });
  });

  it('refuses kinds that later milestones add, naming the milestone', async () => {
    const p = await makeProduct();
    const cases: [OperatorRequest, string][] = [
      [{ kind: 'approve', proposalId: randomUUID(), version: 1, actionHash: 'h' }, 'M09a'],
      [{ kind: 'pause_all', productId: p.id }, 'M09b'],
      [
        {
          kind: 'budget',
          target: { platform: 'google', accountId: '1', type: 'campaign', externalId: '2' },
          newDailyBudgetMicros: '1000000',
        },
        'M14',
      ],
      [{ kind: 'facts_put', productId: p.id, offeringKey: 'x', facts: {} }, 'M05a'],
      [{ kind: 'resolve_attention', proposalId: randomUUID(), resolution: 'applied', note: 'checked' }, 'M11b'],
    ];
    for (const [request, milestone] of cases) {
      const { outcome } = await submit(request);
      expect(outcome).toEqual({ status: 'refused', result: { reason: `not available yet (${milestone})` } });
    }
  });
});

describe('halt and resume_agent', () => {
  it('halts one product and resumes it', async () => {
    const p = await makeProduct();
    expect((await submit({ kind: 'halt', productId: p.id })).outcome).toEqual({
      status: 'done',
      result: { halted: [p.slug] },
    });
    expect((await getProduct(t.db, p.id)).status).toBe('halted');
    expect((await submit({ kind: 'halt', productId: p.id })).outcome.result).toEqual({ halted: [] }); // already
    expect((await submit({ kind: 'resume_agent', productId: p.id })).outcome.result).toEqual({ resumed: [p.slug] });
    expect((await getProduct(t.db, p.id)).status).toBe('active');
  });

  it('halt all stops every active product and leaves dormant ones dormant; resume all undoes only that', async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const dormant = await makeProduct('dormant');
    const { outcome } = await submit({ kind: 'halt', productId: null });
    expect(outcome.result['halted']).toEqual(expect.arrayContaining([a.slug, b.slug]));
    expect(outcome.result['halted']).not.toContain(dormant.slug);
    expect((await getProduct(t.db, dormant.id)).status).toBe('dormant');

    await submit({ kind: 'resume_agent', productId: null });
    expect((await getProduct(t.db, a.id)).status).toBe('active');
    expect((await getProduct(t.db, b.id)).status).toBe('active');
    expect((await getProduct(t.db, dormant.id)).status).toBe('dormant');
  });

  it('an unknown product cannot even be recorded (the foreign key refuses it)', async () => {
    await expect(submit({ kind: 'halt', productId: randomUUID() })).rejects.toThrow(/Failed query/);
  });
});

describe('settings_patch', () => {
  const patch = (productId: string, baseVersion: number, body: Record<string, unknown>) =>
    submit({ kind: 'settings_patch', productId, baseVersion, patch: body });

  it('a valid patch creates a new version, recorded in the history with its request', async () => {
    const p = await makeProduct();
    const { id, outcome } = await patch(p.id, 1, {
      spend: { dailyCeilingMicros: '20000000' },
      notifications: { digest: 'always' },
      guardOverrides: { maxBudgetChangePct: 15, cooldownDays: 10 },
    });
    expect(outcome).toEqual({ status: 'done', result: { version: 2 } });
    const now = await getProduct(t.db, p.id);
    expect(now.settingsVersion).toBe(2);
    expect(now.settings.spend).toEqual({ ...TEST_SETTINGS.spend, dailyCeilingMicros: '20000000' });
    expect(now.settings.notifications.digest).toBe('always');
    expect(now.settings.trust).toEqual(TEST_SETTINGS.trust); // untouched sections are kept
    const history = await getSettingsHistory(t.db, p.id);
    expect(history.map((h) => [h.version, h.requestId])).toEqual([
      [1, null],
      [2, id],
    ]);
  });

  it('null unsets a nullable setting, and arrays are replaced', async () => {
    const p = await makeProduct();
    await patch(p.id, 1, { spend: { dailyCeilingMicros: '5000000' }, copy: { bannedPhrases: ['a', 'b'] } });
    await patch(p.id, 2, { spend: { dailyCeilingMicros: null }, copy: { bannedPhrases: ['c'] } });
    const now = await getProduct(t.db, p.id);
    expect(now.settings.spend.dailyCeilingMicros).toBeNull();
    expect(now.settings.copy.bannedPhrases).toEqual(['c']);
  });

  it('refuses a looser guard override, against the core and each platform default', async () => {
    const p = await makeProduct();
    const core = await patch(p.id, 1, { guardOverrides: { maxBudgetChangePct: 50 } });
    expect(core.outcome.status).toBe('refused');
    expect(core.outcome.result['reason']).toMatch(/loosens maxBudgetChangePct/);
    const meta = await patch(p.id, 1, { guardOverrides: { maxBudgetChangePct: 25 } }); // Meta's default is 20
    expect(meta.outcome.status).toBe('refused');
    const cooldown = await patch(p.id, 1, { guardOverrides: { cooldownDays: 1 } });
    expect(cooldown.outcome.result['reason']).toMatch(/loosens cooldownDays/);
    expect((await getProduct(t.db, p.id)).settingsVersion).toBe(1);
  });

  it('refuses a stale baseVersion', async () => {
    const p = await makeProduct();
    await patch(p.id, 1, { notifications: { digest: 'off' } });
    const stale = await patch(p.id, 1, { notifications: { digest: 'always' } });
    expect(stale.outcome).toEqual({
      status: 'refused',
      result: { reason: 'settings: stale version 1, current is 2' },
    });
    expect((await getProduct(t.db, p.id)).settings.notifications.digest).toBe('off');
  });

  it('refuses invalid values and unknown settings, naming them', async () => {
    const p = await makeProduct();
    const invalid = await patch(p.id, 1, { agent: { feedbackDailyCap: -1 } });
    expect(invalid.outcome.status).toBe('refused');
    expect(invalid.outcome.result['reason']).toMatch(/invalid settings: agent\.feedbackDailyCap/);
    const typo = await patch(p.id, 1, { spend: { dailyCeiling: '1' } });
    expect(typo.outcome.result['reason']).toBe('not a setting: spend.dailyCeiling');
    // zod's record parser already drops a __proto__ key; the merge refuses one too, in case it gets through.
    expect(() =>
      applySettingsPatch(TEST_SETTINGS, JSON.parse('{"spend": {"__proto__": {"x": 1}}}') as Record<string, unknown>),
    ).toThrow('not a setting: spend.__proto__');
    expect((await getProduct(t.db, p.id)).settingsVersion).toBe(1);
  });
});

describe('brief_feedback', () => {
  it('records Marcus’s feedback on a brief, and refuses an unknown brief', async () => {
    const p = await makeProduct();
    const brief = await insertBrief(t.db, { productId: p.id, kind: 'weekly', numbers: {}, markdown: '# Brief' });
    const { outcome } = await submit({ kind: 'brief_feedback', briefId: brief.id, useful: true, newInfo: false });
    expect(outcome.status).toBe('done');
    expect(await getBrief(t.db, brief.id)).toMatchObject({ feedbackUseful: true, feedbackNewInfo: false });
    const missing = await submit({ kind: 'brief_feedback', briefId: randomUUID(), useful: true, newInfo: true });
    expect(missing.outcome.status).toBe('refused');
  });
});

describe('processing', () => {
  it('announces request_done at commit', async () => {
    const listener = new pg.Client({ connectionString: t.url });
    await listener.connect();
    const got: string[] = [];
    listener.on('notification', (m) => got.push(m.payload ?? ''));
    await listener.query('listen request_done');
    try {
      const p = await makeProduct();
      const { id } = await submit({ kind: 'halt', productId: p.id });
      await expect.poll(() => got, { timeout: 2000 }).toContain(id);
    } finally {
      await listener.end();
    }
  });

  it('processes a request once, even with two workers racing', async () => {
    const p = await makeProduct();
    const id = await dashboardInsert('halt', { kind: 'halt', productId: p.id }, MARCUS);
    const results = await Promise.all([processRequest(t.db, id, ctx), processRequest(t.db, id, ctx)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await processRequest(t.db, id, ctx)).toBeNull(); // already done
  });

  it('drains queued requests; a request whose handler faults stays queued and the drain moves on', async () => {
    const p = await makeProduct();
    const q = await makeProduct();
    const original = HANDLERS.resume_agent;
    if (original === undefined) throw new Error('resume_agent has a handler');
    HANDLERS.resume_agent = () => Promise.reject(new Error('database hiccup'));
    const faults: (string | null)[] = [];
    try {
      const faulty = await dashboardInsert('resume_agent', { kind: 'resume_agent', productId: p.id }, MARCUS);
      const fine = await dashboardInsert('halt', { kind: 'halt', productId: q.id }, MARCUS);
      await processQueuedRequests(t.db, ctx, { onFault: (id) => faults.push(id) });
      expect(faults).toEqual([faulty]);
      expect((await getOperatorRequest(t.db, faulty)).status).toBe('queued');
      expect((await getOperatorRequest(t.db, fine)).status).toBe('done');
      expect((await getProduct(t.db, q.id)).status).toBe('halted');
    } finally {
      HANDLERS.resume_agent = original;
    }
    await processQueuedRequests(t.db, ctx); // clean up for later tests
  });
});

describe('draining with other workers', () => {
  it('skips a request another worker holds instead of spinning on it or counting it', async () => {
    const p = await makeProduct();
    const q = await makeProduct();
    const held = await dashboardInsert('halt', { kind: 'halt', productId: p.id }, MARCUS);
    const free = await dashboardInsert('halt', { kind: 'halt', productId: q.id }, MARCUS);
    const other = await t.pool.connect(); // "another worker" mid-way through `held`
    try {
      await other.query('begin');
      await other.query('select 1 from operator_requests where id = $1 for update', [held]);
      expect(await processQueuedRequests(t.db, ctx)).toBe(1);
      expect((await getOperatorRequest(t.db, free)).status).toBe('done');
      expect((await getOperatorRequest(t.db, held)).status).toBe('queued');
    } finally {
      await other.query('rollback');
      other.release();
    }
    expect(await processQueuedRequests(t.db, ctx)).toBe(1); // now free to take
  });

  it('submit records and processes in one transaction: a fault leaves nothing behind', async () => {
    const p = await makeProduct();
    const original = HANDLERS.halt;
    if (original === undefined) throw new Error('halt has a handler');
    HANDLERS.halt = () => Promise.reject(new Error('database hiccup'));
    try {
      await expect(submit({ kind: 'halt', productId: p.id })).rejects.toThrow('database hiccup');
    } finally {
      HANDLERS.halt = original;
    }
    const [row] = (
      await t.pool.query<{ n: number }>(`select count(*)::int as n from operator_requests where product_id = $1`, [
        p.id,
      ])
    ).rows;
    expect(row?.n).toBe(0);
  });
});

describe('worker recovery', () => {
  it('reclaims expired worker leases, processes queued requests, and leaves a note', async () => {
    const p = await makeProduct();
    await setProductStatus(t.db, p.id, 'active');
    const job = await enqueueJob(t.db, { queue: 'worker', kind: 'recovery-test' });
    await claimJob(t.db, { queue: 'worker', workerId: 'crashed', leaseMs: 1, kinds: ['recovery-test'] });
    await new Promise((r) => setTimeout(r, 20));
    const request = await dashboardInsert('halt', { kind: 'halt', productId: p.id }, MARCUS);

    const summary = await recoverWorker(t.db, ctx);
    expect(summary.jobsRequeued).toBeGreaterThanOrEqual(1);
    expect(summary.requestsProcessed).toBeGreaterThanOrEqual(1);
    expect(await getJob(t.db, job.id)).toMatchObject({ status: 'queued' });
    expect((await getOperatorRequest(t.db, request)).status).toBe('done');
    const notes = await listUnsentNotifications(t.db, 500);
    expect(notes.some((n) => n.kind === 'worker_recovered')).toBe(true);

    const again = await recoverWorker(t.db, ctx);
    expect(again).toEqual({ jobsRequeued: 0, jobsFailed: 0, requestsProcessed: 0 });
  });
});
