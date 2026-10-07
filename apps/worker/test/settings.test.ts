// `ads seed`, `ads settings get|set|history` and `ads outcomes` (M05a); `ads docs get|set` (M05b).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutcomeEvent } from '@ads/contracts';
import { settingsFromPack } from '@ads/core';
import { connect, createProduct, findProductBySlug, getPackManifest, upsertAccount, upsertAdEntity } from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import propertySg from '@ads/pack-property-sg';
import snappool from '@ads/pack-saas-snappool';
import { createRegistry } from '@ads/pack-sdk';
import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type WorkerCliDeps } from '../src/cli.ts';
import { publishManifestsAtStartup } from '../src/startup.ts';

function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  cmd.commands.forEach(quiet);
  return cmd;
}

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());
afterEach(() => {
  process.exitCode = undefined;
});

const NOW = new Date('2026-10-06T04:00:00Z');
/** SnapPool's manifest with a stub source: three outcomes, one of them test traffic. */
const OUTCOMES: OutcomeEvent[] = [
  { sourceId: 'r1', stage: 'pool_request', occurredAt: '2026-10-01T02:00:00Z', isTest: false, ids: {} },
  { sourceId: 'r1', stage: 'signup', occurredAt: '2026-10-01T02:10:00Z', isTest: false, ids: { fbclid: 'f' } },
  { sourceId: 'r2', stage: 'signup', occurredAt: '2026-10-02T02:10:00Z', isTest: true, ids: {} },
];
const stubPacks = createRegistry([
  {
    manifest: snappool.manifest,
    runtime: {
      ...snappool.runtime,
      outcomeAdapter: () => ({
        fetchSince: () => Promise.resolve(OUTCOMES),
        healthcheck: () => Promise.resolve({ ok: true, latestActivityAt: new Date('2026-10-02T02:10:00Z') }),
      }),
    },
  },
  propertySg,
]);

function run(args: string[], env: NodeJS.ProcessEnv = {}, packs = stubPacks) {
  const printed: string[] = [];
  const deps: WorkerCliDeps = {
    env: { DATABASE_URL: t.url, OPERATOR_ACTORS: 'cli:tester', ADS_OPERATOR: 'tester', ...env },
    readStdin: () => Promise.resolve(''),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
    now: () => NOW,
    packs,
  };
  const done = quiet(buildProgram(deps)).parseAsync(['node', 'ads', ...args]);
  return {
    done,
    json: async () => (await done, JSON.parse(printed.join('\n')) as Record<string, unknown>),
    text: async () => (await done, printed.join('\n')),
  };
}

describe('ads seed', () => {
  it("creates the products from products/seed.json, each one's settings from its pack; a rerun creates nothing", async () => {
    expect(await run(['seed']).json()).toEqual({
      productsCreated: ['snappool', 'property-sg'],
      offeringsEnsured: 2,
      docsCreated: 6, // products/<slug>/STRATEGY.md, PLAYBOOK.md and LEARNINGS.md, as version 1
      flagsCreated: ['writes_enabled'],
    });
    const product = await findProductBySlug(t.db, 'snappool');
    expect(product?.settings).toEqual(settingsFromPack(snappool.manifest));
    expect(product?.settings.outcomes.primaryKpiStage).toBe('signup');
    const property = await findProductBySlug(t.db, 'property-sg');
    expect(property?.settings).toEqual(settingsFromPack(propertySg.manifest));
    expect(property?.status).toBe('dormant');
    expect(await run(['seed']).json()).toMatchObject({ productsCreated: [], docsCreated: 0, flagsCreated: [] });
  });
});

describe('ads settings', () => {
  it('get prints the current settings and their version', async () => {
    const out = await run(['settings', 'get', '--product', 'snappool']).json();
    expect(out).toMatchObject({ product: 'snappool', version: 1, current: true });
    expect((out['settings'] as { testTraffic: unknown }).testTraffic).toEqual({ emailDomains: [] });
  });

  it("set records a settings_patch: Marcus's starting settings become version 2", async () => {
    const patch = JSON.stringify({
      testTraffic: { emailDomains: ['example.com'] },
      spend: { monthlyCeilingMicros: '500000000', dailyCeilingMicros: '25000000' },
    });
    expect(await run(['settings', 'set', '--product', 'snappool', '--patch', patch]).json()).toMatchObject({
      product: 'snappool',
      status: 'done',
      version: 2,
    });
    const { rows } = await t.pool.query<{ actor: string; channel: string; status: string }>(
      `select actor, channel, status from operator_requests where kind = 'settings_patch' order by created_at limit 1`,
    );
    expect(rows[0]).toEqual({ actor: 'cli:tester', channel: 'cli', status: 'done' });
    const out = await run(['settings', 'get', '--product', 'snappool', '--version', '1']).json();
    expect(out).toMatchObject({ version: 1, current: false });
  });

  it('set refuses an unknown actor, a looser guard, and an invalid patch, with exit code 1', async () => {
    const r = run(['settings', 'set', '--product', 'snappool', '--patch', '{"notifications":{"digest":"off"}}'], {
      ADS_OPERATOR: 'someone',
    });
    expect(await r.json()).toMatchObject({ status: 'refused', reason: 'unknown actor' });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    const loose = await run([
      'settings',
      'set',
      '--product',
      'snappool',
      '--patch',
      '{"guardOverrides":{"maxBudgetChangePct":25}}',
    ]).json();
    expect(loose).toMatchObject({ status: 'refused' });
    expect(String(loose['reason'])).toContain('maxBudgetChangePct');
    await expect(run(['settings', 'set', '--product', 'snappool', '--patch', '[1]']).done).rejects.toThrow(
      'the patch must be a JSON object',
    );
  });

  it('history lists every version with what it changed', async () => {
    const out = await run(['settings', 'history', '--product', 'snappool']).json();
    expect((out['versions'] as { version: number; changed: string[] }[]).map((v) => [v.version, v.changed])).toEqual([
      [1, []],
      [2, ['spend.dailyCeilingMicros', 'spend.monthlyCeilingMicros', 'testTraffic.emailDomains']],
    ]);
  });
});

describe('ads docs', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ads-docs-'));
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it('get prints the latest version: the seeded document first; list shows every version', async () => {
    const strategy = await run(['docs', 'get', '--product', 'snappool', '--doc', 'strategy']).text();
    expect(strategy).toMatch(/^# SnapPool: Strategy/);
    const list = await run(['docs', 'list', '--product', 'snappool']).json();
    expect((list['docs'] as Record<string, unknown>[]).map((d) => [d['doc'], d['version']])).toEqual([
      ['strategy', 1],
      ['playbook', 1],
      ['learnings', 1],
    ]);
  });

  it('set records a product_doc_put: a new version, then get prints it; a stale base is refused', async () => {
    const file = join(dir, 'strategy.md');
    await writeFile(file, '# Strategy\n\nSignups at a low cost, beta first.\n');
    // The version edited must be named, so a version written meanwhile can't be overwritten unseen.
    const set = ['docs', 'set', '--product', 'snappool', '--doc', 'strategy', '--file', file];
    await expect(run(set).done).rejects.toThrow('--base-version is required');
    expect(await run([...set, '--base-version', '1']).json()).toMatchObject({
      product: 'snappool',
      doc: 'strategy',
      status: 'done',
      version: 2,
    });
    expect(await run(['docs', 'get', '--product', 'snappool', '--doc', 'strategy']).text()).toBe(
      '# Strategy\n\nSignups at a low cost, beta first.\n',
    );
    const stale = await run([
      'docs',
      'set',
      '--product',
      'snappool',
      '--doc',
      'strategy',
      '--file',
      file,
      '--base-version',
      '1',
    ]).json();
    expect(stale).toMatchObject({ status: 'refused', reason: 'product doc strategy: stale version 1, current is 2' });
    expect(process.exitCode).toBe(1);
  });

  it('set refuses an unknown actor; an unknown document name is a usage error', async () => {
    const file = join(dir, 'playbook.md');
    await writeFile(file, '# Playbook\n');
    const args = ['docs', 'set', '--product', 'snappool', '--doc', 'playbook', '--file', file, '--base-version', '1'];
    expect(await run(args, { ADS_OPERATOR: 'stranger' }).json()).toMatchObject({
      status: 'refused',
      reason: 'unknown actor',
    });
    await expect(run(['docs', 'get', '--product', 'snappool', '--doc', 'roadmap']).done).rejects.toThrow();
  });
});

describe('ads outcomes', () => {
  it('reads the source and prints 30 days by stage, test traffic apart; no ids or hashes', async () => {
    const r = run(['outcomes', '--product', 'snappool']);
    const out = await r.json();
    expect(out).toMatchObject({
      product: 'snappool',
      window: { days: 30, to: NOW.toISOString() },
      read: { outcome: 'read', events: 3, new: 3 },
      kpiStage: 'signup',
    });
    expect(
      (out['stages'] as Record<string, unknown>[]).map((s) => [s['stage'], s['kpi'], s['outcomes'], s['test']]),
    ).toEqual([
      ['pool_request', false, 1, 0],
      ['signup', true, 1, 1],
      ['activated', false, 0, 0],
      ['paid', false, 0, 0],
    ]);
    expect(JSON.stringify(out)).not.toContain('fbclid');
  });

  it('changing the KPI to paid with ads settings set changes the output, with no code change', async () => {
    await run(['settings', 'set', '--product', 'snappool', '--patch', '{"outcomes":{"primaryKpiStage":"paid"}}']).done;
    const out = await run(['outcomes', '--product', 'snappool', '--no-read']).json();
    expect(out).toMatchObject({ kpiStage: 'paid', read: { outcome: 'not_read' } });
    expect((out['stages'] as Record<string, unknown>[]).filter((s) => s['kpi']).map((s) => s['stage'])).toEqual([
      'paid',
    ]);
  });

  it("credits outcomes to campaigns and prints the KPI stage's attribution rate", async () => {
    const product = await createProduct(t.db, {
      slug: 'attr-rate',
      name: 'Attribution',
      packId: 'saas-snappool',
      settings: settingsFromPack(snappool.manifest),
    });
    const account = await upsertAccount(t.db, { productId: product.id, platform: 'meta', externalId: 'act_5550001' });
    await upsertAdEntity(t.db, {
      productId: product.id,
      accountId: account.id,
      platform: 'meta',
      type: 'campaign',
      externalId: '120210000000000001',
      name: 'Signups',
      status: 'active',
      rawStatus: 'ACTIVE',
    });
    const signup = (sourceId: string, ids: OutcomeEvent['ids'], isTest = false): OutcomeEvent => ({
      sourceId,
      stage: 'signup',
      occurredAt: '2026-10-03T02:00:00Z',
      isTest,
      ids,
    });
    const source: OutcomeEvent[] = [
      signup('a1', { metaCampaignId: '120210000000000001', fbclid: 'f1' }),
      signup('a2', { utmSource: 'meta', utmCampaign: 'Signups' }),
      signup('a3', { fbclid: 'f3' }), // Meta can't say which campaign an fbclid came from
      signup('o1', {}),
      signup('t1', { metaCampaignId: '120210000000000001' }, true),
    ];
    const packs = createRegistry([
      {
        manifest: snappool.manifest,
        runtime: {
          ...snappool.runtime,
          outcomeAdapter: () => ({
            fetchSince: () => Promise.resolve(source),
            healthcheck: () => Promise.resolve({ ok: true, latestActivityAt: new Date('2026-10-03T02:00:00Z') }),
          }),
        },
      },
    ]);
    const out = await run(['outcomes', '--product', 'attr-rate'], {}, packs).json();
    expect(out['attribution']).toEqual({
      stage: 'signup',
      outcomes: 4,
      attributed: 2,
      ratePct: 50,
      byMethod: { platform_ids: 1, gclid_lookup: 0, utm: 1, none: 2, pending: 0 },
      run: { checked: 5, attributed: { platform_ids: 2, gclid_lookup: 0, utm: 1 }, none: 2 },
    });
    const signups = (out['stages'] as Record<string, unknown>[]).find((s) => s['stage'] === 'signup');
    expect(signups).toMatchObject({ outcomes: 4, test: 1, attributed: 2 });
    // Without reading, nothing is attributed again and the stored rate is shown.
    const stored = await run(['outcomes', '--product', 'attr-rate', '--no-read'], {}, packs).json();
    expect(stored['attribution']).toMatchObject({ outcomes: 4, attributed: 2, ratePct: 50 });
    expect(stored['attribution']).not.toHaveProperty('run');
  });

  it('fails (exit 1) when the source cannot be read, and says why', async () => {
    const out = await run(['outcomes', '--product', 'snappool'], {}, createRegistry([snappool])).json();
    expect(out['read']).toMatchObject({ outcome: 'error' });
    expect(String((out['read'] as { detail: string }).detail)).toContain('SNAPPOOL_DATABASE_URL is not set');
    expect(process.exitCode).toBe(1);
  });
});

describe('publishing manifests at startup', () => {
  it('publishes the installed packs, or skips without DATABASE_URL', async () => {
    const logged: string[] = [];
    const logger = { info: (_: object, msg: string) => void logged.push(msg) };
    expect(await publishManifestsAtStartup({}, logger)).toBeNull();
    expect(await publishManifestsAtStartup({ DATABASE_URL: t.url }, logger)).toEqual([
      'property-sg@0.1.0',
      'saas-snappool@0.1.0',
    ]);
    expect(logged).toEqual(['no DATABASE_URL: pack manifests are not published', 'pack manifests published']);
    expect((await getPackManifest(t.db, 'saas-snappool', '0.1.0'))?.manifest).toMatchObject({ id: 'saas-snappool' });
    expect((await getPackManifest(t.db, 'property-sg', '0.1.0'))?.manifest).toMatchObject({
      id: 'property-sg',
      platformPolicy: { meta: { specialAdCategories: ['HOUSING'] } },
    });
  });
});
