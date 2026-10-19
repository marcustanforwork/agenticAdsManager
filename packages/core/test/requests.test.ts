import type { EditSpec, EntityRef, OperatorRequest, WriteOp } from '@ads/contracts';
import {
  claimJob,
  createProduct,
  createProposal,
  getCurrentApproval,
  listProposalVersions,
  getPhase,
  getProposal,
  insertFinding,
  listEvalCases,
  startManual,
  ensureOffering,
  enqueueJob,
  findOffering,
  getProductDoc,
  getJob,
  getOperatorRequest,
  getProduct,
  getSettingsHistory,
  insertBrief,
  getBrief,
  listUnsentNotifications,
  setProductStatus,
  insertChange,
  listAccounts,
  listProposals,
  markReverted,
  schema,
} from '@ads/db';
import { fingerprintOf } from '@ads/contracts';
import { eq } from 'drizzle-orm';
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
import { createRegistry } from '@ads/pack-sdk';
import { z } from 'zod';
import { PRODUCT_DOC_MAX_CHARS } from '../src/requests/handlers.ts';
import { TEST_PACKS } from './support/world.ts';
import { makeAdWorld } from './support/adWorld.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const MARCUS = 'telegram:1001';
const ctx: RequestContext = { actors: actorsFromEnv(` ${MARCUS}, cli:marcus ,`), packs: TEST_PACKS };

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
    const cases: [OperatorRequest, string][] = [
      [
        {
          kind: 'budget',
          target: { platform: 'google', accountId: '1', type: 'campaign', externalId: '2' },
          newDailyBudgetMicros: '1000000',
        },
        'M14',
      ],
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

describe('facts_put', () => {
  /** A pack with a fact schema of its own (the shared test pack has none). */
  const base = TEST_PACKS.get('test-pack');
  const factsPacks = createRegistry([
    {
      runtime: base.runtime,
      manifest: {
        ...base.manifest,
        id: 'facts-pack',
        facts: {
          schema: z.object({
            district: z.string().regex(/^D\d{2}$/),
            unitMix: z.array(z.object({ type: z.string(), units: z.number().int().min(0).optional() })).optional(),
            launchDates: z.object({ teaser: z.string().optional() }),
          }),
          requiredForCopy: [],
        },
      },
    },
  ]);
  const factsCtx: RequestContext = { ...ctx, packs: factsPacks };
  const withOffering = async (packId = 'facts-pack') => {
    const p = await createProduct(t.db, {
      slug: `f-${randomBytes(4).toString('hex')}`,
      name: 'Facts',
      packId,
      settings: TEST_SETTINGS,
    });
    await ensureOffering(t.db, { productId: p.id, kind: 'project', key: 'tower-one', name: 'Tower One' });
    return p;
  };
  const put = (productId: string, facts: Record<string, unknown>, offeringKey = 'tower-one') =>
    submitRequest(
      t.db,
      { request: { kind: 'facts_put', productId, offeringKey, facts }, actor: MARCUS, channel: 'telegram' },
      factsCtx,
    );

  it("stores facts the pack's schema accepts, as a new facts version", async () => {
    const p = await withOffering();
    const facts = {
      district: 'D19',
      unitMix: [{ type: '2-bedroom', units: 40 }],
      launchDates: { teaser: '2026-10-01' },
    };
    expect((await put(p.id, facts)).outcome).toEqual({
      status: 'done',
      result: { offering: 'tower-one', factsVersion: 2 },
    });
    const offering = await findOffering(t.db, p.id, 'tower-one');
    expect(offering?.facts).toEqual(facts);
    expect((await put(p.id, { district: 'D05', launchDates: {} })).outcome.result).toEqual({
      offering: 'tower-one',
      factsVersion: 3,
    });
  });

  it("refuses facts the pack's schema rejects, naming them, and changes nothing", async () => {
    const p = await withOffering();
    const { outcome } = await put(p.id, { district: 'nineteen', launchDates: {} });
    expect(outcome.status).toBe('refused');
    expect(outcome.result['reason']).toMatch(/^invalid facts: district: /);
    expect((await findOffering(t.db, p.id, 'tower-one'))?.factsVersion).toBe(1);
  });

  it('refuses unknown keys by name, inside lists too', async () => {
    const p = await withOffering();
    const { outcome } = await put(p.id, {
      district: 'D19',
      launchDates: { teaser: '2026-10-01', soft_launch: '2026-09-01' },
      unitMix: [{ type: '2-bedroom', size: 700 }],
      developr: 'typo',
    });
    expect(outcome).toEqual({
      status: 'refused',
      // In the order of the stored request (jsonb orders keys by length, then by name).
      result: { reason: 'not a fact: unitMix.0.size; developr; launchDates.soft_launch' },
    });
    expect((await findOffering(t.db, p.id, 'tower-one'))?.factsVersion).toBe(1);
  });

  it('refuses an unknown offering, and a product whose pack is not installed', async () => {
    const p = await withOffering();
    expect((await put(p.id, { district: 'D19', launchDates: {} }, 'tower-two')).outcome).toEqual({
      status: 'refused',
      result: { reason: 'offering not found: tower-two' },
    });
    const orphan = await withOffering('no-such-pack');
    expect((await put(orphan.id, { district: 'D19', launchDates: {} })).outcome).toEqual({
      status: 'refused',
      result: { reason: "the no-such-pack pack is not installed, so its facts can't be checked" },
    });
  });
});

describe('product_doc_put', () => {
  const putDoc = (productId: string, baseVersion: number, markdown: string) =>
    submit({ kind: 'product_doc_put', productId, doc: 'strategy', baseVersion, markdown });

  it('writes versions that increase, each recorded with its request', async () => {
    const p = await makeProduct();
    const first = await putDoc(p.id, 0, '# Strategy\n\nFirst.');
    expect(first.outcome).toEqual({ status: 'done', result: { doc: 'strategy', version: 1 } });
    const second = await putDoc(p.id, 1, '# Strategy\n\nSecond.');
    expect(second.outcome).toEqual({ status: 'done', result: { doc: 'strategy', version: 2 } });
    const latest = await getProductDoc(t.db, p.id, 'strategy');
    expect(latest).toMatchObject({ version: 2, markdown: '# Strategy\n\nSecond.', requestId: second.id });
    expect(await getProductDoc(t.db, p.id, 'playbook')).toBeNull();
  });

  it('refuses a stale baseVersion and keeps the current version', async () => {
    const p = await makeProduct();
    await putDoc(p.id, 0, 'v1');
    await putDoc(p.id, 1, 'v2');
    expect((await putDoc(p.id, 1, 'based on v1')).outcome).toEqual({
      status: 'refused',
      result: { reason: 'product doc strategy: stale version 1, current is 2' },
    });
    expect((await putDoc(p.id, 5, 'from the future')).outcome.status).toBe('refused');
    expect((await getProductDoc(t.db, p.id, 'strategy'))?.markdown).toBe('v2');
  });

  it('refuses a document longer than the cap', async () => {
    const p = await makeProduct();
    const { outcome } = await putDoc(p.id, 0, 'x'.repeat(PRODUCT_DOC_MAX_CHARS + 1));
    expect(outcome).toEqual({
      status: 'refused',
      result: { reason: `the strategy document has ${PRODUCT_DOC_MAX_CHARS + 1} characters; at most 20000` },
    });
    expect((await putDoc(p.id, 0, 'x'.repeat(PRODUCT_DOC_MAX_CHARS))).outcome.status).toBe('done');
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

describe('set_phase (D-082)', () => {
  it('sets the phase with a note, and refuses one outside 0–5 or without a note', async () => {
    expect((await submit({ kind: 'set_phase', phase: 1, note: 'Phase 0 gate passed' })).outcome).toEqual({
      status: 'done',
      result: { phase: 1, previous: 0 },
    });
    expect(await getPhase(t.db)).toBe(1);
    for (const payload of [
      { kind: 'set_phase', phase: 6, note: 'too high' },
      { kind: 'set_phase', phase: 2, note: '' },
    ]) {
      const id = await dashboardInsert('set_phase', payload);
      await processRequest(t.db, id, ctx);
      expect((await getOperatorRequest(t.db, id)).status).toBe('refused');
    }
    expect(await getPhase(t.db)).toBe(1);
    expect((await submit({ kind: 'set_phase', phase: 0, note: 'back to read-only' })).outcome.result).toEqual({
      phase: 0,
      previous: 1,
    });
  });
});

describe('approve and reject (M08)', () => {
  async function proposalWorld() {
    const w = await makeAdWorld(t.db, { slug: `decide-${randomBytes(3).toString('hex')}` });
    const campaign = await w.entity('google', 'campaign', '77');
    const cycle = await startManual(t.db, { productId: w.productId, cycleDate: '2026-10-08' });
    const finding = await insertFinding(t.db, {
      productId: w.productId,
      cycleId: cycle.id,
      type: 'zero_outcome_spend',
      source: 'detector',
      targetEntityId: campaign.id,
      analystVerdict: 'confirmed',
      summary: 's',
      evidence: {
        windowDays: 14,
        impressions: 1,
        clicks: 1,
        spendMicros: '1',
        outcomesByStage: {},
        from: '2026-09-24',
        to: '2026-10-07',
        dataDays: 14,
      },
      passedThreshold: true,
    });
    const target = { platform: 'google' as const, accountId: '1', type: 'campaign' as const, externalId: '77' };
    const make = (
      origin: 'agent' | 'operator' = 'agent',
      change: { action: WriteOp; undo: WriteOp | null; expiresAt?: Date } = {
        action: { action: 'pause_entity', target },
        undo: { action: 'resume_entity', target },
      },
    ) =>
      createProposal(t.db, {
        productId: w.productId,
        cycleId: origin === 'agent' ? cycle.id : null,
        findingId: origin === 'agent' ? finding.id : null,
        origin,
        action: change.action,
        undo: change.undo,
        ...(change.expiresAt === undefined ? {} : { expiresAt: change.expiresAt }),
        preconditionHash: 'h',
        preconditionFields: ['status'],
        rationale: 'r',
        expectedEffect: 'e',
      });
    return { w, make, cycle, finding, target };
  }

  it('approves the version and hash Marcus saw, records an eval case, and a double tap is harmless', async () => {
    const { w, make, cycle, finding } = await proposalWorld();
    const p = await make();
    const request = { kind: 'approve' as const, proposalId: p.id, version: 1, actionHash: p.actionHash };
    const first = await submitRequest(t.db, { request, actor: 'cli:marcus', channel: 'cli' }, ctx);
    expect(first.outcome).toEqual({
      status: 'done',
      result: { proposal: p.shortId, version: 1, decision: 'approve', duplicate: false, evalCase: true },
    });
    expect((await getCurrentApproval(t.db, p.id))?.channel).toBe('cli');
    const again = await submitRequest(t.db, { request, actor: 'cli:marcus', channel: 'cli' }, ctx);
    expect(again.outcome.result).toMatchObject({ duplicate: true, evalCase: false });
    const cases = await listEvalCases(t.db, w.productId);
    expect(cases.map((c) => c.evalCase)).toEqual([
      expect.objectContaining({
        cycleId: cycle.id,
        findingId: finding.id,
        proposalId: p.id,
        decision: 'approve',
        findingType: 'zero_outcome_spend',
        target: expect.stringMatching(/^google:111000\d{4}:campaign:77$/) as unknown,
      }),
    ]);
  });

  it('every rejection creates a case with its reason; operator proposals make none', async () => {
    const { w, make } = await proposalWorld();
    const p = await make();
    const { outcome } = await submit({ kind: 'reject', proposalId: p.id, version: 1, reason: 'seasonal dip' });
    expect(outcome.result).toMatchObject({ decision: 'reject', evalCase: true });
    expect((await getProposal(t.db, p.id)).status).toBe('rejected');
    const own = await make('operator');
    expect(
      (await submit({ kind: 'reject', proposalId: own.id, version: 1, reason: 'changed my mind' })).outcome.result,
    ).toMatchObject({ evalCase: false });
    expect((await listEvalCases(t.db, w.productId)).map((c) => [c.evalCase.decision, c.evalCase.reason])).toEqual([
      ['reject', 'seasonal dip'],
    ]);
  });

  it('refuses a stale version, a changed hash, a decided proposal and an unknown one, changing nothing', async () => {
    const { make } = await proposalWorld();
    const p = await make();
    const reasons = async (request: OperatorRequest) => (await submit(request)).outcome;
    expect(await reasons({ kind: 'approve', proposalId: p.id, version: 2, actionHash: p.actionHash })).toMatchObject({
      status: 'refused',
    });
    expect(await reasons({ kind: 'approve', proposalId: p.id, version: 1, actionHash: 'other' })).toMatchObject({
      status: 'refused',
      result: { reason: expect.stringContaining('the action changed') as unknown },
    });
    expect(await reasons({ kind: 'reject', proposalId: randomUUID(), version: 1, reason: 'gone' })).toMatchObject({
      status: 'refused',
    });
    expect((await getProposal(t.db, p.id)).status).toBe('pending');
    await submit({ kind: 'reject', proposalId: p.id, version: 1, reason: 'no thanks' });
    expect(await reasons({ kind: 'approve', proposalId: p.id, version: 1, actionHash: p.actionHash })).toMatchObject({
      status: 'refused',
    });
  });

  describe('edit_approve (M09a)', () => {
    const negative = (target: EntityRef) => ({
      action: {
        action: 'add_negative_keyword' as const,
        target: { ...target, type: 'ad_group' as const },
        text: 'free photos',
        matchType: 'EXACT' as const,
      },
      undo: {
        action: 'remove_negative_keyword' as const,
        target: { ...target, type: 'ad_group' as const },
        criterionId: 'set-at-apply',
      },
    });
    const budget = (target: EntityRef) => ({
      action: { action: 'adjust_budget' as const, target, newDailyBudgetMicros: '80000000', netIncrease: false },
      undo: { action: 'adjust_budget' as const, target, newDailyBudgetMicros: '100000000', netIncrease: true },
    });

    it('makes a new version from the edit and approves that version, with its own undo and an eval case', async () => {
      const { w, make, target } = await proposalWorld();
      const p = await make('agent', budget(target));
      const { outcome } = await submit({
        kind: 'edit_approve',
        proposalId: p.id,
        version: 1,
        edit: { field: 'budget', newDailyBudgetMicros: '90000000' },
      });
      expect(outcome).toMatchObject({
        status: 'done',
        result: {
          proposal: p.shortId,
          version: 2,
          decision: 'approve',
          evalCase: true,
          edited: 'budget',
          previousVersion: 1,
        },
      });
      const after = await getProposal(t.db, p.id);
      expect(after).toMatchObject({ status: 'approved', version: 2, preconditionHash: 'h' });
      expect(after.action).toEqual({ ...budget(target).action, newDailyBudgetMicros: '90000000', netIncrease: false });
      expect(after.undo).toEqual(budget(target).undo); // back to the budget before the change
      expect(await getCurrentApproval(t.db, p.id)).toMatchObject({ proposalVersion: 2, actionHash: after.actionHash });
      expect((await listProposalVersions(t.db, p.id)).map((v) => v.version)).toEqual([1, 2]);
      const cases = await listEvalCases(t.db, w.productId);
      expect(cases.map((c) => [c.evalCase.decision, c.evalCase.reason])).toEqual([
        ['approve', 'edited (budget) and approved'],
      ]);
    });

    it('edits a negative keyword text and match type', async () => {
      const { make, target } = await proposalWorld();
      const text = await make('operator', negative(target));
      expect(
        (
          await submit({
            kind: 'edit_approve',
            proposalId: text.id,
            version: 1,
            edit: { field: 'negative_text', text: '  free   pics ' },
          })
        ).outcome.status,
      ).toBe('done');
      expect((await getProposal(t.db, text.id)).action).toMatchObject({ text: 'free pics', matchType: 'EXACT' });
      const match = await make('operator', negative(target));
      expect(
        (
          await submit({
            kind: 'edit_approve',
            proposalId: match.id,
            version: 1,
            edit: { field: 'match_type', matchType: 'PHRASE' },
          })
        ).outcome.status,
      ).toBe('done');
      expect((await getProposal(t.db, match.id)).action).toMatchObject({ text: 'free photos', matchType: 'PHRASE' });
    });

    it('refuses an edit that does not fit, breaks the guard, changes nothing, or comes too late, changing nothing', async () => {
      const { make, target } = await proposalWorld();
      const refusal = async (p: { id: string }, edit: EditSpec, version = 1) =>
        (await submit({ kind: 'edit_approve', proposalId: p.id, version, edit })).outcome;
      const pause = await make('operator');
      expect(await refusal(pause, { field: 'budget', newDailyBudgetMicros: '1000000' })).toMatchObject({
        status: 'refused',
        result: { reason: 'a budget edit needs a budget change, not pause_entity' },
      });
      const b = await make('operator', budget(target));
      for (const [edit, reason] of [
        [{ field: 'budget', newDailyBudgetMicros: '131000000' }, 'a budget may change by at most 30% at a time'],
        [
          { field: 'budget', newDailyBudgetMicros: '90005000' },
          'the new budget must be in steps of 10000 micros (0.01)',
        ],
        [{ field: 'budget', newDailyBudgetMicros: '100000000' }, 'the new budget is the current budget'],
        [{ field: 'budget', newDailyBudgetMicros: '80000000' }, 'the edit changes nothing'],
        [{ field: 'negative_text', text: 'x' }, 'a keyword edit needs a negative keyword, not adjust_budget'],
      ] as const) {
        expect(await refusal(b, edit)).toEqual({ status: 'refused', result: { reason } });
      }
      expect(await refusal(b, { field: 'budget', newDailyBudgetMicros: '90000000' }, 2)).toMatchObject({
        status: 'refused',
      });
      expect(await getProposal(t.db, b.id)).toMatchObject({ status: 'pending', version: 1 });
      const expired = await make('operator', { ...budget(target), expiresAt: new Date(Date.now() - 1000) });
      expect(await refusal(expired, { field: 'budget', newDailyBudgetMicros: '90000000' })).toEqual({
        status: 'refused',
        result: { reason: `proposal ${expired.shortId} has expired` },
      });
      await submit({ kind: 'reject', proposalId: b.id, version: 1, reason: 'not now' });
      expect(await refusal(b, { field: 'budget', newDailyBudgetMicros: '90000000' })).toEqual({
        status: 'refused',
        result: { reason: `proposal ${b.shortId} is rejected, not pending` },
      });
    });
  });
});

describe('pause, pause_all and undo (M09b, Phase 1 behaviour)', () => {
  const HALF_HOUR = 30 * 60_000;

  async function pauseWorld() {
    const w = await makeAdWorld(t.db, { slug: `pause-${randomBytes(3).toString('hex')}` });
    const accounts = new Map((await listAccounts(t.db, w.productId)).map((a) => [a.platform, a.externalId]));
    const ref = (e: { platform: 'google' | 'meta'; type: EntityRef['type']; externalId: string }): EntityRef => ({
      platform: e.platform,
      accountId: accounts.get(e.platform) ?? '',
      type: e.type,
      externalId: e.externalId,
    });
    return { w, ref };
  }

  it('a pause becomes an operator proposal with a planned undo, a fingerprint and a 30-minute expiry', async () => {
    const { w, ref } = await pauseWorld();
    const campaign = await w.entity('google', 'campaign', '501');
    const before = Date.now();
    const { outcome } = await submit({ kind: 'pause', target: ref(campaign) });
    expect(outcome.status).toBe('done');
    expect(outcome.result).toMatchObject({ created: true, version: 1 });
    const p = await getProposal(t.db, outcome.result['proposalId'] as string);
    expect(p).toMatchObject({
      origin: 'operator',
      status: 'pending',
      cycleId: null,
      findingId: null,
      action: { action: 'pause_entity', target: ref(campaign) },
      undo: { action: 'resume_entity', target: ref(campaign) },
      preconditionFields: ['status'],
      preconditionHash: fingerprintOf({ status: 'active' }, ['status']),
      rationale: 'Your own request, from telegram.',
    });
    expect(outcome.result['shortId']).toBe(p.shortId);
    expect(outcome.result['actionHash']).toBe(p.actionHash);
    expect(p.expiresAt.getTime() - before).toBeGreaterThanOrEqual(HALF_HOUR - 1000);
    expect(p.expiresAt.getTime() - before).toBeLessThanOrEqual(HALF_HOUR + 5000);

    // Asking again returns the same open proposal; the confirm tap is an ordinary approval.
    const again = await submit({ kind: 'pause', target: ref(campaign) });
    expect(again.outcome.result).toMatchObject({ proposalId: p.id, created: false });
    const confirmed = await submit({ kind: 'approve', proposalId: p.id, version: 1, actionHash: p.actionHash });
    expect(confirmed.outcome.status).toBe('done');
    expect((await getProposal(t.db, p.id)).status).toBe('approved');
    expect(await listEvalCases(t.db, w.productId)).toEqual([]); // Marcus's own actions aren't eval data
  });

  it('a pause past its expiry is replaced, not returned', async () => {
    const { w, ref } = await pauseWorld();
    const campaign = await w.entity('meta', 'campaign', '502');
    const first = (await submit({ kind: 'pause', target: ref(campaign) })).outcome.result['proposalId'] as string;
    await t.db
      .update(schema.proposals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.proposals.id, first));
    const { outcome } = await submit({ kind: 'pause', target: ref(campaign) });
    expect(outcome.result).toMatchObject({ created: true });
    expect(outcome.result['proposalId']).not.toBe(first);
    expect((await getProposal(t.db, first)).status).toBe('expired');
  });

  it('refuses an unknown account, an entity not synced, one not active, and a level it cannot pause', async () => {
    const { w, ref } = await pauseWorld();
    const paused = await w.entity('google', 'campaign', '503', { status: 'paused' });
    const keyword = await w.entity('google', 'keyword', '504');
    const cases: [EntityRef, string][] = [
      [
        { platform: 'google', accountId: '999999999', type: 'campaign', externalId: '1' },
        'unknown google account 999999999',
      ],
      [ref({ platform: 'google', type: 'campaign', externalId: '404' }), 'no synced campaign 404'],
      [ref(paused), 'the campaign is paused, not active'],
      [ref(keyword), "a keyword can't be paused from here"],
    ];
    for (const [target, reason] of cases) {
      expect((await submit({ kind: 'pause', target })).outcome).toEqual({ status: 'refused', result: { reason } });
    }
    expect(await listProposals(t.db, w.productId)).toEqual([]);
  });

  it('pause_all: one proposal per active campaign, also for a halted product; again returns the same ones', async () => {
    const { w } = await pauseWorld();
    const g = await w.entity('google', 'campaign', '601');
    await w.entity('meta', 'campaign', '602');
    await w.entity('google', 'campaign', '603', { status: 'paused' });
    await w.entity('google', 'ad_group', '604', { parent: g });
    await submit({ kind: 'halt', productId: w.productId });

    const { outcome } = await submit({ kind: 'pause_all', productId: w.productId });
    expect(outcome.status).toBe('done');
    const refs = outcome.result['proposals'] as { proposalId: string; created: boolean }[];
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.created)).toBe(true);
    const targets = await Promise.all(refs.map(async (r) => (await getProposal(t.db, r.proposalId)).action));
    expect(targets.map((a) => (a.action === 'pause_entity' ? a.target.externalId : '')).sort()).toEqual(['601', '602']);
    const again = (await submit({ kind: 'pause_all', productId: w.productId })).outcome.result['proposals'] as {
      proposalId: string;
      created: boolean;
    }[];
    expect(again.map((r) => [r.proposalId, r.created]).sort()).toEqual(refs.map((r) => [r.proposalId, false]).sort());
  });

  it('pause_all refuses a product with nothing active', async () => {
    const { w } = await pauseWorld();
    expect((await submit({ kind: 'pause_all', productId: w.productId })).outcome).toMatchObject({
      status: 'refused',
      result: { reason: expect.stringContaining('has no active campaign to pause') as unknown },
    });
  });

  it('undo shows the stored undo of a change; refuses one without an undo, one already undone, an unknown one', async () => {
    const { w, ref } = await pauseWorld();
    const campaign = await w.entity('google', 'campaign', '701');
    const target = ref(campaign);
    const proposalId = (await submit({ kind: 'pause', target })).outcome.result['proposalId'] as string;
    const change = (undoOp: WriteOp | null) =>
      insertChange(t.db, {
        productId: w.productId,
        proposalId,
        action: { action: 'pause_entity', target },
        undo: undoOp,
        before: { status: 'active' },
        after: { status: 'paused' },
        approvedBy: MARCUS,
        verified: true,
      });
    const rev = await change({ action: 'resume_entity', target });
    expect((await submit({ kind: 'undo', revisionId: rev })).outcome).toEqual({
      status: 'done',
      result: {
        revisionId: rev,
        productId: w.productId,
        action: { action: 'pause_entity', target },
        undo: { action: 'resume_entity', target },
      },
    });
    const none = await change(null);
    expect((await submit({ kind: 'undo', revisionId: none })).outcome.result['reason']).toBe(
      `${none} (pause_entity) cannot be undone`,
    );
    const later = await change({ action: 'resume_entity', target });
    await markReverted(t.db, rev, later);
    expect((await submit({ kind: 'undo', revisionId: rev })).outcome.result['reason']).toBe(
      `${rev} was already undone by ${later}`,
    );
    expect((await submit({ kind: 'undo', revisionId: 'rev_nope' })).outcome.status).toBe('refused');
    expect(await listProposals(t.db, w.productId)).toHaveLength(1); // Phase 1: no undo proposal
  });
});
