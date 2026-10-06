import { connect, createProduct } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, withoutLeadingDashes, type WorkerCliDeps } from '../src/cli.ts';

function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  cmd.commands.forEach(quiet);
  return cmd;
}

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  for (const slug of ['acc-a', 'acc-b'])
    await createProduct(t.db, { slug, name: slug, packId: 'test-pack', settings: TEST_SETTINGS });
});
afterAll(async () => t.drop());

async function run(args: string[]): Promise<string[]> {
  const printed: string[] = [];
  const deps: WorkerCliDeps = {
    env: { DATABASE_URL: t.url },
    readStdin: () => Promise.resolve(''),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
  };
  await quiet(buildProgram(deps)).parseAsync(['node', 'ads', ...args]);
  return printed;
}

describe('ads accounts', () => {
  it('links an account once, lists it, and pauses it', async () => {
    expect(await run(['accounts', 'link', '--product', 'acc-a', '--platform', 'meta', '--account', 'act_777'])).toEqual(
      ['linked meta:act_777 to acc-a'],
    );
    expect(await run(['--product', 'acc-a', 'accounts', 'link', '--platform', 'meta', '--account', 'act_777'])).toEqual(
      ['meta:act_777 is already linked to acc-a (active)'],
    );
    expect(
      await run([
        'accounts',
        'set-status',
        '--product',
        'acc-a',
        '--platform',
        'meta',
        '--account',
        'act_777',
        '--status',
        'paused',
      ]),
    ).toEqual(['meta:act_777 is now paused']);
    const [line] = await run(['accounts', 'list', '--product', 'acc-a']);
    expect(line).toMatch(/^meta:act_777 {2}paused/);
  });

  it('stores the manager account of a Google account, and refuses it elsewhere', async () => {
    const link = (...extra: string[]) =>
      run(['accounts', 'link', '--product', 'acc-a', '--platform', 'google', '--account', '1234567890', ...extra]);
    expect(await link('--manager', '1112223333')).toEqual([
      'linked google:1234567890 to acc-a through manager 1112223333',
    ]);
    expect(await link('--manager', '1112223333')).toEqual(['google:1234567890 is already linked to acc-a (active)']);
    expect(await link('--manager', '4445556666')).toEqual([
      'google:1234567890 is linked to acc-a through manager 4445556666',
    ]);
    const lines = await run(['accounts', 'list', '--product', 'acc-a']);
    expect(lines.find((l) => l.startsWith('google:'))).toMatch(/via manager 4445556666$/);
    expect(await link('--no-manager')).toEqual(['google:1234567890 is linked to acc-a, with direct access']);
    const direct = await run(['accounts', 'list', '--product', 'acc-a']);
    expect(direct.find((l) => l.startsWith('google:'))).not.toMatch(/via manager/);
    await expect(link('--manager', '111-222-3333')).rejects.toThrow(/10 digits/);
    await expect(
      run([
        'accounts',
        'link',
        '--product',
        'acc-a',
        '--platform',
        'meta',
        '--account',
        'act_1',
        '--manager',
        '1112223333',
      ]),
    ).rejects.toThrow(/Google accounts only/);
  });

  it("refuses another product's account and malformed ids", async () => {
    await expect(
      run(['accounts', 'link', '--product', 'acc-b', '--platform', 'meta', '--account', 'act_777']),
    ).rejects.toThrow(/another product/);
    await expect(
      run([
        'accounts',
        'set-status',
        '--product',
        'acc-b',
        '--platform',
        'meta',
        '--account',
        'act_777',
        '--status',
        'active',
      ]),
    ).rejects.toThrow(/not found|acc-b account/i);
    await expect(
      run(['accounts', 'link', '--product', 'acc-b', '--platform', 'meta', '--account', '777']),
    ).rejects.toThrow(/act_<digits>/);
    await expect(
      run(['accounts', 'link', '--product', 'acc-b', '--platform', 'google', '--account', '123-456-7890']),
    ).rejects.toThrow(/10 digits/);
    await expect(run(['accounts', 'list'])).rejects.toThrow(/--product/);
    expect(await run(['accounts', 'list', '--product', 'acc-b'])).toEqual(['no accounts are linked to acc-b']);
  });

  it('checks arguments before opening the database', async () => {
    const printed: string[] = [];
    const deps: WorkerCliDeps = {
      env: {}, // no DATABASE_URL: an argument error must come first
      readStdin: () => Promise.resolve(''),
      print: (line) => printed.push(line),
      connect: () => {
        throw new Error('connected');
      },
    };
    const program = () => quiet(buildProgram(deps));
    await expect(program().parseAsync(['node', 'ads', 'accounts', 'list'])).rejects.toThrow(/--product/);
    await expect(
      program().parseAsync([
        'node',
        'ads',
        'accounts',
        'link',
        '--product',
        'x',
        '--platform',
        'meta',
        '--account',
        '9',
      ]),
    ).rejects.toThrow(/act_<digits>/);
  });

  it('drops the -- that pnpm passes on', () => {
    expect(withoutLeadingDashes(['node', 'ads', '--', 'accounts', 'list'])).toEqual([
      'node',
      'ads',
      'accounts',
      'list',
    ]);
    expect(withoutLeadingDashes(['node', 'ads', 'sync', '--', 'x'])).toEqual(['node', 'ads', 'sync', '--', 'x']);
  });
});
