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

  it('runs for Google too (M03); with no Google account linked it says so', async () => {
    const r = run(['--product', 'sync-cli', 'sync', '--platform', 'google', '--dry']);
    await r.done;
    const report = JSON.parse(r.printed.join('\n')) as { platform: string; warnings: string[]; accounts: unknown[] };
    expect(report.platform).toBe('google');
    expect(report.accounts).toEqual([]);
    expect(report.warnings).toContain('no google account is linked to sync-cli');
  });
});

describe('ads cycle', () => {
  const cycle = (args: string[]) => {
    const r = run(['--product', 'sync-cli', 'cycle', ...args]);
    return { ...r, summary: async () => (await r.done, JSON.parse(r.printed.join('\n')) as Record<string, unknown>) };
  };

  it('--until synced stops after the sync, and the next run resumes at the trust check (manual cycles)', async () => {
    const first = await cycle(['--kind', 'manual', '--until', 'synced']).summary();
    expect(first).toMatchObject({ product: 'sync-cli', kind: 'manual', outcome: 'stopped', stageReached: 'synced' });
    // The expired token is an account error: recorded, and the exit code says so.
    expect(first['sync']).toMatchObject({ accounts: [{ account: 'meta:act_42', outcome: 'error' }] });
    expect(process.exitCode).toBe(1);
  });

  it('runs a daily cycle to the end: the sync error leaves the data stale, so the trust check fails (exit 1)', async () => {
    const r = run(['--product', 'sync-cli', 'cycle', '--kind', 'daily', '--until', 'trust_checked']);
    await r.done;
    const summary = JSON.parse(r.printed.join('\n')) as { outcome: string; trustResult: string };
    expect(summary).toMatchObject({ outcome: 'finished', trustResult: 'fail' });
    expect(r.printed.join('\n')).not.toContain(TOKEN);
    expect(process.exitCode).toBe(1);
    // The same day again: already finished, nothing runs.
    process.exitCode = undefined;
    const again = run(['--product', 'sync-cli', 'cycle', '--kind', 'daily']);
    await again.done;
    expect(JSON.parse(again.printed.join('\n'))).toMatchObject({ outcome: 'already_finished' });
  });

  it('needs --kind, a known stage and a known product', async () => {
    await expect(run(['--product', 'sync-cli', 'cycle']).done).rejects.toThrow(/--kind/);
    await expect(
      run(['--product', 'sync-cli', 'cycle', '--kind', 'daily', '--until', 'analysed']).done,
    ).rejects.toThrow(/Allowed choices/);
    await expect(run(['--product', 'nope', 'cycle', '--kind', 'manual']).done).rejects.toThrow(/nope/);
  });
});
