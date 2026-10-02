import { connect, createProduct } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type WorkerCliDeps } from '../src/cli.ts';

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
});
