import { replayFetch, type Cassette } from '@ads/connector-testing';
import type { WriteOp } from '@ads/contracts';
import {
  createProposal,
  findAccount,
  getProduct,
  getSearchTerms,
  insertChange,
  listEntities,
  listUnacknowledgedDrift,
  trustSignalsOf,
  upsertAccount,
} from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoogleQuotaError } from '@ads/connector-google';
import { MetaApiError, MetaRateLimitError } from '@ads/connector-meta';
import { changedFields, clickDaysToSync, explainedBy, refKey, stopsTheSync, syncStage } from '../src/index.ts';
import {
  GOOGLE_ACCOUNT,
  META_ACCOUNT,
  NOW,
  type World,
  eachObject,
  editResponses,
  googleCassettes,
  makeWorld,
  metaCassettes,
  tokenFetch,
} from './support/world.ts';

// A database per test: the fixtures' account ids are fixed, and an account belongs to one product.
let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => t.drop());

const count = async (sql: string, params: unknown[]): Promise<number> =>
  (await t.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
const snapshots = (productId: string) =>
  count('select count(*)::int as n from ad_entity_snapshots where product_id = $1', [productId]);

async function sync(world: World, cassettes: Cassette[], now = NOW) {
  const replay = replayFetch(cassettes);
  const product = await getProduct(t.db, world.productId);
  const result = await syncStage(
    { db: t.db, masterKey: world.masterKey, process: 'cli', fetch: replay.fetch, tokenFetch, now: () => now },
    product,
  );
  return { result, replay };
}
const both = (meta = metaCassettes(NOW), google = googleCassettes(NOW)) => [...meta, ...google];

/** An applied change of ours, as the gateway records it (M11b). */
async function applied(productId: string, action: WriteOp) {
  const proposal = await createProposal(t.db, {
    productId,
    origin: 'agent',
    action,
    undo: null,
    preconditionHash: null,
    preconditionFields: [],
    rationale: 'r',
    expectedEffect: 'e',
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await insertChange(t.db, {
    productId,
    proposalId: proposal.id,
    action,
    undo: null,
    before: {},
    after: {},
    approvedBy: 'marcus',
    verified: true,
  });
}

describe('syncStage', () => {
  it('stores both platforms: entities under their parents, one snapshot each, metrics, terms, clicks, signals', async () => {
    const world = await makeWorld(t.db, { slug: 'sync-first' });
    const { result, replay } = await sync(world, both());
    expect(replay.remaining()).toBe(0);
    expect(result.warnings).toEqual([]);
    const [google, meta] = result.accounts;
    expect(google).toMatchObject({
      account: `google:${GOOGLE_ACCOUNT}`,
      outcome: 'synced',
      entities: { listed: 13, new: 13, snapshots: 13, drift: 0, removed: 0 },
      clickIds: { days: 1 },
    });
    expect(google?.searchTerms).toBeGreaterThan(0);
    // The KPI action's conversions per term are stored (M06a); another action's are not.
    const terms = await getSearchTerms(t.db, { productId: world.productId, from: '2000-01-01', to: '2100-01-01' });
    expect(Object.fromEntries(terms.map((r) => [r.term, Number(r.conversions)]))).toEqual({
      'photo sharing app for weddings': 1.5,
      'free event photo pool': 0,
    });
    expect(meta).toMatchObject({
      account: `meta:${META_ACCOUNT}`,
      outcome: 'synced',
      entities: { listed: 8, new: 8, snapshots: 8, drift: 0, removed: 0 },
    });
    expect(google?.metricRows).toBeGreaterThan(0);
    expect(meta?.metricRows).toBeGreaterThan(0);
    expect(await snapshots(world.productId)).toBe(21);

    // Parents: a Meta ad sits under its ad set, a Google keyword under its ad group.
    const all = await listEntities(t.db, world.productId);
    const byExternal = new Map(all.map((e) => [`${e.type}:${e.externalId}`, e]));
    expect(byExternal.get('ad:120220000000000001')?.parentId).toBe(byExternal.get('ad_group:120210000000000001')?.id);
    expect(byExternal.get('keyword:211~311')?.parentId).toBe(byExternal.get('ad_group:211')?.id);
    // A budget Google may share is never treated as unshared.
    expect(byExternal.get('budget:412')?.budgetShared).toBe(true);

    const metaAccount = await findAccount(t.db, 'meta', META_ACCOUNT);
    expect(metaAccount).toMatchObject({ timezone: 'Asia/Singapore', currency: 'SGD', lastSyncError: null });
    expect(metaAccount?.lastSyncedAt).toEqual(NOW);
    const signals = metaAccount && trustSignalsOf(metaAccount);
    expect(signals).toMatchObject({ range: { from: '2026-09-25', to: '2026-10-01' }, readAt: NOW.toISOString() });
    expect(signals?.spendCapMicros).not.toBeNull();
    const googleAccount = await findAccount(t.db, 'google', GOOGLE_ACCOUNT);
    expect(googleAccount?.clicksSyncedThrough).toBe('2026-09-30');
    expect(googleAccount && trustSignalsOf(googleAccount)?.autoTaggingEnabled).toBe(true);
    expect(await count('select count(*)::int as n from google_clicks where product_id = $1', [world.productId])).toBe(
      google?.clickIds?.rows,
    );
    // Summaries carry counts only: no entity names or search terms.
    expect(JSON.stringify(result)).not.toMatch(/Signups|photo|Brand/);
  });

  it('a second sync of unchanged entities stores no snapshot; restated metrics overwrite the old rows', async () => {
    const world = await makeWorld(t.db, { slug: 'sync-again' });
    await sync(world, both());
    const before = await snapshots(world.productId);
    const { result } = await sync(
      world,
      both(
        metaCassettes(NOW, ['entities', 'metrics-campaign-v2', 'metrics-adset', 'metrics-ad', 'trust']),
        googleCassettes(NOW, [
          'account',
          'entities',
          'metrics-campaign-v2',
          'metrics-ad_group',
          'metrics-keyword',
          'search-terms',
          'clicks',
          'trust',
        ]),
      ),
    );
    expect(result.accounts.map((a) => a.entities)).toEqual([
      { listed: 13, new: 0, snapshots: 0, drift: 0, removed: 0 },
      { listed: 8, new: 0, snapshots: 0, drift: 0, removed: 0 },
    ]);
    expect(await snapshots(world.productId)).toBe(before);
    // v2 restates some campaign days: the rows are overwritten in place (no duplicates).
    const rows = await count(
      `select count(*)::int as n from metrics_daily m join ad_entities e on e.id = m.ad_entity_id
        where m.product_id = $1 and e.type = 'campaign' group by m.ad_entity_id, m.date order by n desc limit 1`,
      [world.productId],
    );
    expect(rows).toBe(1);
  });

  it('records drift for changes made outside the system, but not for our own changes (fixture pairs)', async () => {
    const world = await makeWorld(t.db, { slug: 'sync-drift' });
    await sync(world, both());
    const metaRef = { platform: 'meta' as const, accountId: META_ACCOUNT };
    const googleRef = { platform: 'google' as const, accountId: GOOGLE_ACCOUNT };
    // Our own changes since the first sync: Meta campaign 2 resumed, Google budget 411 raised to 25.
    await applied(world.productId, {
      action: 'resume_entity',
      target: { ...metaRef, type: 'campaign', externalId: '120200000000000002' },
    });
    await applied(world.productId, {
      action: 'adjust_budget',
      target: { ...googleRef, type: 'budget', externalId: '411' },
      newDailyBudgetMicros: '25000000',
      netIncrease: true,
    });

    // v2 of the listings: changed in the platforms' own UIs, plus the effects of our two changes.
    const meta = editResponses(metaCassettes(NOW), (body) =>
      eachObject(body, (o) => {
        if (o['id'] === '120200000000000001') {
          Object.assign(o, { status: 'PAUSED', effective_status: 'PAUSED', daily_budget: '3000', name: 'Renamed' });
        }
        if (o['id'] === '120200000000000002') Object.assign(o, { status: 'ACTIVE', effective_status: 'ACTIVE' });
      }),
    );
    const google = editResponses(googleCassettes(NOW), (body) =>
      eachObject(body, (o) => {
        if (o['id'] === '111' && 'biddingStrategyType' in o) o['status'] = 'PAUSED';
        if (o['id'] === '112' && 'biddingStrategyType' in o) o['biddingStrategyType'] = 'TARGET_SPEND';
        // Budget 411's amount, seen on the budget and on campaign 111 (which reads its budget).
        if (o['amountMicros'] === '20000000') o['amountMicros'] = '25000000';
      }),
    );
    const { result } = await sync(world, both(meta, google));
    expect(result.accounts.map((a) => a.entities?.drift)).toEqual([2, 3]);

    const drift = await listUnacknowledgedDrift(t.db, world.productId);
    const entities = new Map((await listEntities(t.db, world.productId)).map((e) => [e.id, e]));
    const seen = drift
      .map((d) => [entities.get(d.adEntityId)?.externalId, d.field, d.expected, d.observed])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(seen).toEqual([
      ['111', 'status', { value: 'ENABLED' }, { value: 'PAUSED' }],
      ['112', 'bidStrategy', { value: 'MANUAL_CPC' }, { value: 'TARGET_SPEND' }],
      ['120200000000000001', 'dailyBudgetMicros', { value: '20000000' }, { value: '30000000' }],
      ['120200000000000001', 'name', { value: 'Signups - Advantage+' }, { value: 'Renamed' }],
      ['120200000000000001', 'status', { value: 'ACTIVE' }, { value: 'PAUSED' }],
    ]);
    // The platform is the truth: the entity rows carry the new values.
    const c1 = [...entities.values()].find((e) => e.externalId === '120200000000000001');
    expect(c1).toMatchObject({ name: 'Renamed', status: 'paused', dailyBudgetMicros: 30_000_000n });
  });

  it('reads a known entity missing from a listing by id; one the platform says is gone becomes removed', async () => {
    const world = await makeWorld(t.db, { slug: 'sync-missing' });
    await sync(world, both());
    // v2: the ads listing leaves out ad 3 (deleted) and the ad sets listing leaves out ad set 2 (archived?).
    const listing = editResponses(metaCassettes(NOW), (body, path) => {
      const data = (body as { data?: { id: string }[] }).data;
      if (path.endsWith('/ads') && data)
        (body as { data: unknown[] }).data = data.filter((d) => d.id !== '120220000000000003');
      if (path.endsWith('/adsets') && data)
        (body as { data: unknown[] }).data = data.filter((d) => d.id !== '120210000000000002');
    });
    const [byId] = metaCassettes(NOW, ['snapshot']);
    const adRequest = byId?.exchanges.find((x) => x.request.path === '/120220000000000001')?.request;
    const adSet = byId?.exchanges.find((x) => x.request.path === '/120210000000000002');
    if (!adRequest || !adSet) throw new Error('fixture changed');
    const gone: Cassette = {
      source: 'hand-written: Meta error 100/33 for an object that no longer exists (GOTCHAS)',
      exchanges: [
        adSet,
        {
          request: { ...adRequest, path: '/120220000000000003' },
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            body: {
              error: {
                message: "Unsupported get request. Object with ID '120220000000000003' does not exist",
                type: 'GraphMethodException',
                code: 100,
                error_subcode: 33,
                fbtrace_id: 'AbCdEf',
              },
            },
          },
        },
      ],
    };
    const { result, replay } = await sync(world, [...listing, gone, ...googleCassettes(NOW)]);
    expect(replay.remaining()).toBe(0);
    expect(result.accounts[1]).toMatchObject({ outcome: 'synced', entities: { listed: 6, removed: 1, drift: 1 } });
    const ads = await listEntities(t.db, world.productId, { type: 'ad' });
    expect(ads.find((e) => e.externalId === '120220000000000003')).toMatchObject({
      status: 'removed',
      rawStatus: 'NOT_FOUND',
    });
    // Read by id, the ad set is still there and unchanged: no snapshot, no drift.
    const sets = await listEntities(t.db, world.productId, { type: 'ad_group' });
    expect(sets.find((e) => e.externalId === '120210000000000002')?.status).toBe('paused');
    const [d] = await listUnacknowledgedDrift(t.db, world.productId);
    expect([d?.field, d?.observed]).toEqual(['status', { value: 'NOT_FOUND' }]);
  });

  it('records a failing account and carries on with the others', async () => {
    const world = await makeWorld(t.db, { slug: 'sync-fail' });
    const broken = await upsertAccount(t.db, { productId: world.productId, platform: 'meta', externalId: 'act_999' });
    const { result } = await sync(world, both());
    expect(result.accounts.map((a) => [a.account, a.outcome])).toEqual([
      [`google:${GOOGLE_ACCOUNT}`, 'synced'],
      [`meta:${META_ACCOUNT}`, 'synced'],
      ['meta:act_999', 'error'],
    ]);
    const row = await findAccount(t.db, 'meta', 'act_999');
    expect(row?.id).toBe(broken.id);
    expect(row?.lastSyncError).toMatch(/credential/);
    expect(row?.lastSyncedAt).toBeNull();
  });
});

describe('drift rules', () => {
  const ref = { platform: 'google' as const, accountId: '1234567890', type: 'campaign' as const, externalId: '111' };
  const targets = new Set([refKey(ref)]);
  const change = (field: 'status' | 'dailyBudgetMicros' | 'name' | 'bidStrategy', observed: unknown) => ({
    field,
    expected: null,
    observed,
  });

  it('compares the status a person sets: Meta configured status, Google status', () => {
    const before = { name: 'n', status: 'active', rawStatus: 'ACTIVE', configuredStatus: 'ACTIVE', bidStrategy: null };
    // A parent pause moves Meta's effective status only: not drift on the child.
    expect(changedFields('meta', before, { ...before, status: 'paused', rawStatus: 'CAMPAIGN_PAUSED' })).toEqual([]);
    expect(changedFields('meta', before, { ...before, configuredStatus: 'PAUSED' })).toEqual([
      { field: 'status', expected: 'ACTIVE', observed: 'PAUSED' },
    ]);
    const g = { name: 'n', status: 'active', rawStatus: 'ENABLED', dailyBudgetMicros: '1', bidStrategy: 'MANUAL_CPC' };
    expect(changedFields('google', g, { ...g, status: 'limited' })).toEqual([]); // primary status moves on its own
    expect(changedFields('google', g, { ...g, dailyBudgetMicros: '2', bidStrategy: 'TARGET_SPEND' })).toEqual([
      { field: 'dailyBudgetMicros', expected: '1', observed: '2' },
      { field: 'bidStrategy', expected: 'MANUAL_CPC', observed: 'TARGET_SPEND' },
    ]);
  });

  it('explains a change only by our action on that entity setting that value', () => {
    expect(explainedBy(change('status', 'PAUSED'), { action: 'pause_entity', target: ref }, targets)).toBe(true);
    expect(explainedBy(change('status', 'ENABLED'), { action: 'pause_entity', target: ref }, targets)).toBe(false);
    expect(explainedBy(change('status', 'ENABLED'), { action: 'resume_entity', target: ref }, targets)).toBe(true);
    const other = { ...ref, externalId: '999' };
    expect(explainedBy(change('status', 'PAUSED'), { action: 'pause_entity', target: other }, targets)).toBe(false);
    const budget = (micros: string) => ({
      action: 'adjust_budget' as const,
      target: ref,
      newDailyBudgetMicros: micros,
      netIncrease: true,
    });
    expect(explainedBy(change('dailyBudgetMicros', '5000000'), budget('5000000'), targets)).toBe(true);
    expect(explainedBy(change('dailyBudgetMicros', '6000000'), budget('5000000'), targets)).toBe(false);
    expect(explainedBy(change('name', 'x (abandoned)'), { action: 'mark_abandoned', target: ref }, targets)).toBe(true);
    expect(explainedBy(change('bidStrategy', 'TARGET_SPEND'), budget('5000000'), targets)).toBe(false);
  });
});

describe('errors while reading one entity', () => {
  it('stop the account only for quota, rate limits and refused sign-ins', () => {
    expect(stopsTheSync(new GoogleQuotaError('cap'))).toBe(true);
    expect(stopsTheSync(new MetaRateLimitError({ status: 400, message: 'm', code: 17, retryAfterMs: 60_000 }))).toBe(
      true,
    );
    expect(stopsTheSync(new MetaApiError({ status: 400, message: 'token expired', code: 190 }))).toBe(true);
    expect(stopsTheSync(new MetaApiError({ status: 400, message: 'bad field', code: 100 }))).toBe(false);
    expect(stopsTheSync(new Error('unexpected shape'))).toBe(false);
  });
});

describe('click-id days', () => {
  it('re-reads the last stored day, reads up to yesterday, and never more than 90 days back', () => {
    expect(clickDaysToSync('2026-09-28', '2026-10-01')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(clickDaysToSync('2026-09-30', '2026-10-01')).toEqual(['2026-09-30']);
    expect(clickDaysToSync('2026-10-01', '2026-10-01')).toEqual([]);
    const first = clickDaysToSync(null, '2026-10-01');
    expect(first).toHaveLength(89); // 90 days including today, which is incomplete
    expect([first[0], first.at(-1)]).toEqual(['2026-07-04', '2026-09-30']);
    expect(clickDaysToSync('2026-01-01', '2026-10-01')[0]).toBe('2026-07-04');
  });
});
