import { randomBytes } from 'node:crypto';
import { connect, createProduct, upsertAccount } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram, type CliDeps } from '../src/cli.ts';

/** Throw instead of exiting, and stay silent, on every subcommand too (exitOverride isn't inherited). */
function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  cmd.commands.forEach(quiet);
  return cmd;
}

let t: TestDatabase;
let externalId: string;
const readKey = `read-v1:${randomBytes(32).toString('base64')}`;
const SECRET = 'refresh-token-value-123';

beforeAll(async () => {
  t = await createTestDatabase();
  const product = await createProduct(t.db, {
    slug: 'cli-test',
    name: 'CLI',
    packId: 'test-pack',
    settings: TEST_SETTINGS,
  });
  externalId = `act_${randomBytes(5).toString('hex')}`;
  await upsertAccount(t.db, { productId: product.id, platform: 'meta', externalId });
});
afterAll(async () => t.drop());

function run(args: string[], opts: { stdin?: string; env?: NodeJS.ProcessEnv } = {}) {
  const printed: string[] = [];
  const deps: CliDeps = {
    env: opts.env ?? { DATABASE_URL: t.url, VAULT_READ_KEY: readKey },
    readStdin: () => Promise.resolve(opts.stdin ?? ''),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
  };
  const program = quiet(buildProgram(deps));
  return { done: program.parseAsync(['node', 'ads', ...args]), printed };
}

describe('ads credentials', () => {
  it('put reads the token from stdin; check opens it without printing it', async () => {
    const put = run(['credentials', 'put', '--account', `meta:${externalId}`, '--role', 'read'], {
      stdin: JSON.stringify({ access_token: SECRET }),
    });
    await put.done;
    expect(put.printed).toEqual([`stored the read credential for meta:${externalId} (sealed with read-v1)`]);

    const check = run(['credentials', 'check', '--account', externalId, '--role', 'read']);
    await check.done;
    expect(check.printed[0]).toContain('fields: access_token');
    expect([...put.printed, ...check.printed].join('\n')).not.toContain(SECRET);
  });

  it('never takes the token as an argument', async () => {
    const r = run(['credentials', 'put', '--account', externalId, '--role', 'read', '{"access_token":"x"}']);
    await expect(r.done).rejects.toThrow(/too many arguments|unknown/i);
  });

  it('only handles read credentials, with a read key', async () => {
    await expect(
      run(['credentials', 'put', '--account', externalId, '--role', 'write'], { stdin: '{}' }).done,
    ).rejects.toThrow(/Allowed choices are read/);
    const writeKey = `write-v1:${randomBytes(32).toString('base64')}`;
    await expect(
      run(['credentials', 'put', '--account', externalId, '--role', 'read'], {
        stdin: '{}',
        env: { DATABASE_URL: t.url, VAULT_READ_KEY: writeKey },
      }).done,
    ).rejects.toThrow(/must hold a read key/);
  });

  it('refuses a token that is not a JSON object, without quoting it', async () => {
    const r = run(['credentials', 'put', '--account', externalId, '--role', 'read'], { stdin: `not json ${SECRET}` });
    const error: unknown = await r.done.catch((e: unknown) => e);
    expect(String(error)).toMatch(/JSON object/);
    expect(String(error)).not.toContain(SECRET);
  });

  it('rotates to the key in VAULT_READ_KEY_NEW', async () => {
    const newKey = `read-v2:${randomBytes(32).toString('base64')}`;
    const r = run(['credentials', 'rotate-key'], {
      env: { DATABASE_URL: t.url, VAULT_READ_KEY: readKey, VAULT_READ_KEY_NEW: newKey },
    });
    await r.done;
    expect(r.printed).toEqual(['re-wrapped 1 credential(s) from read-v1 to read-v2']);
    const check = run(['credentials', 'check', '--account', externalId, '--role', 'read'], {
      env: { DATABASE_URL: t.url, VAULT_READ_KEY: newKey },
    });
    await check.done;
    expect(check.printed[0]).toContain('opens with read-v2');
  });
});
