// `ads phase`, `ads proposals list|show|approve|reject` and `ads eval replay` (M08).
import { connect, createProduct, createProposal, setFlag, upsertAccount, upsertAdEntity } from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type WorkerCliDeps } from '../src/cli.ts';

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

function run(args: string[]) {
  const printed: string[] = [];
  const deps: WorkerCliDeps = {
    env: { DATABASE_URL: t.url, OPERATOR_ACTORS: 'cli:tester', ADS_OPERATOR: 'tester' },
    readStdin: () => Promise.resolve(''),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
    packs: createRegistry([]),
  };
  const done = quiet(buildProgram(deps)).parseAsync(['node', 'ads', ...args]);
  return { json: async () => (await done, JSON.parse(printed.join('\n')) as Record<string, unknown>) };
}

describe('ads phase', () => {
  it('prints 0 until set, and sets it through a request with a note', async () => {
    expect(await run(['phase']).json()).toEqual({ phase: 0 });
    expect(await run(['phase', 'set', '1', '--note', 'Phase 0 gate passed']).json()).toMatchObject({
      status: 'done',
      phase: 1,
      previous: 0,
    });
    expect(await run(['phase']).json()).toEqual({ phase: 1 });
    await setFlag(t.db, 'phase', 0);
  });
});

describe('ads proposals', () => {
  it('lists, shows, approves and rejects, through operator requests', async () => {
    const product = await createProduct(t.db, {
      slug: 'cli-proposals',
      name: 'P',
      packId: 'test-pack',
      settings: TEST_SETTINGS,
    });
    const account = await upsertAccount(t.db, { productId: product.id, platform: 'google', externalId: '5550001' });
    const target = { platform: 'google' as const, accountId: '5550001', type: 'campaign' as const, externalId: '8' };
    await upsertAdEntity(t.db, {
      productId: product.id,
      accountId: account.id,
      platform: 'google',
      type: 'campaign',
      externalId: '8',
      name: 'c',
      status: 'active',
      rawStatus: 'ENABLED',
    });
    const make = (origin: 'agent' | 'operator') =>
      createProposal(t.db, {
        productId: product.id,
        origin,
        action: { action: 'pause_entity', target },
        undo: { action: 'resume_entity', target },
        preconditionHash: 'h',
        preconditionFields: ['status'],
        rationale: 'No signups in 14 days.',
        expectedEffect: 'The spend stops.',
      });
    const a = await make('agent');
    const b = await make('operator');
    const p = ['--product', 'cli-proposals', 'proposals'];

    const listed = await run([...p, 'list']).json();
    expect(listed).toMatchObject({ product: 'cli-proposals', phase: 0 });
    expect((listed['proposals'] as { id: string; change: unknown }[]).map((x) => x.id).sort()).toEqual(
      [a.shortId, b.shortId].sort(),
    );
    expect((listed['proposals'] as { change: unknown }[])[0]?.change).toEqual({
      action: 'pause_entity',
      target: 'google:5550001:campaign:8',
    });

    expect(await run([...p, 'show', a.shortId]).json()).toMatchObject({
      id: a.shortId,
      actionHash: a.actionHash,
      undo: { action: 'resume_entity' },
      precondition: { fields: ['status'], hash: 'h' },
      versions: [{ version: 1, actionHash: a.actionHash }],
    });

    expect(await run([...p, 'approve', a.shortId, '--version', '1']).json()).toMatchObject({
      status: 'done',
      decision: 'approve',
    });
    expect(await run([...p, 'reject', b.shortId, '--reason', 'not this week']).json()).toMatchObject({
      status: 'done',
      decision: 'reject',
      evalCase: false, // Marcus's own proposals are not eval data
    });
    expect(await run([...p, 'approve', b.shortId, '--version', '1']).json()).toMatchObject({ status: 'refused' });
    expect(process.exitCode).toBe(1);
    expect(((await run([...p, 'list']).json())['proposals'] as unknown[]).length).toBe(0);
    expect(((await run([...p, 'list', '--all']).json())['proposals'] as unknown[]).length).toBe(2);
  });
});

describe('ads eval replay', () => {
  it('scores the hand-written cases without a database, and the decisions in it with --product', async () => {
    expect(await run(['eval', 'replay', '--hand-written']).json()).toMatchObject({
      cases: 3,
      overall: { precisionPct: 75, recallPct: 75 },
    });
    expect(await run(['--product', 'cli-proposals', 'eval', 'replay']).json()).toMatchObject({
      product: 'cli-proposals',
      cases: 0,
      byType: [],
    });
  });
});
