import { randomBytes } from 'node:crypto';
import { connect, createProduct, upsertAccount } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { parseMasterKey, put } from '@ads/vault';
import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type WorkerCliDeps } from '../src/cli.ts';

function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  cmd.commands.forEach(quiet);
  return cmd;
}

let t: TestDatabase;
const readKey = `read-v1:${randomBytes(32).toString('base64')}`;
const TOKEN = `EAA${'q'.repeat(40)}`;

beforeAll(async () => {
  t = await createTestDatabase();
  const product = await createProduct(t.db, {
    slug: 'sync-cli',
    name: 'Sync',
    packId: 'test-pack',
    settings: TEST_SETTINGS,
  });
  const account = await upsertAccount(t.db, { productId: product.id, platform: 'meta', externalId: 'act_42' });
  await put(t.db, account.id, 'read', { accessToken: TOKEN, appSecret: 's'.repeat(32) }, parseMasterKey(readKey));
});
afterAll(async () => t.drop());
afterEach(() => {
  process.exitCode = undefined;
});

/** Meta answers every call with a permanent error (code 190, an expired token). */
const expiredToken = (() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: { message: 'Error validating access token', code: 190 } }), { status: 400 }),
  )) as unknown as typeof fetch;

function run(args: string[], fetchFn: typeof fetch = expiredToken) {
  const printed: string[] = [];
  const deps: WorkerCliDeps = {
    env: { DATABASE_URL: t.url, VAULT_READ_KEY: readKey },
    readStdin: () => Promise.resolve(''),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
    fetch: fetchFn,
  };
  return { done: quiet(buildProgram(deps)).parseAsync(['node', 'ads', ...args]), printed };
}

describe('ads sync', () => {
  it('prints a JSON report, accepts --product after the subcommand, and fails the exit code on an account error', async () => {
    const r = run(['sync', '--product', 'sync-cli', '--platform', 'meta', '--dry']);
    await r.done;
    const report = JSON.parse(r.printed.join('\n')) as {
      dryRun: boolean;
      accounts: { account: string; outcome: string; detail: string }[];
    };
    expect(report.dryRun).toBe(true);
    expect(report.accounts).toMatchObject([{ account: 'meta:act_42', outcome: 'error' }]);
    expect(report.accounts[0]?.detail).toMatch(/\(190\)/);
    expect(r.printed.join('\n')).not.toContain(TOKEN);
    expect(process.exitCode).toBe(1);
  });

  it('only runs with --dry, and needs --product', async () => {
    await expect(run(['sync', '--product', 'sync-cli', '--platform', 'meta']).done).rejects.toThrow(/only --dry/);
    await expect(run(['sync', '--platform', 'meta', '--dry']).done).rejects.toThrow(/--product/);
    await expect(run(['--product', 'sync-cli', 'sync', '--platform', 'tiktok', '--dry']).done).rejects.toThrow(
      /Allowed choices/,
    );
  });

  it('refuses Google until M03', async () => {
    await expect(run(['--product', 'sync-cli', 'sync', '--platform', 'google', '--dry']).done).rejects.toThrow(/M03/);
  });
});
