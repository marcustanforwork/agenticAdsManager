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
const writeKey = `write-v1:${randomBytes(32).toString('base64')}`;

beforeAll(async () => {
  t = await createTestDatabase();
  const product = await createProduct(t.db, {
    slug: 'gw-cli',
    name: 'CLI',
    packId: 'test-pack',
    settings: TEST_SETTINGS,
  });
  externalId = String(1_000_000_000 + randomBytes(3).readUIntBE(0, 3));
  await upsertAccount(t.db, { productId: product.id, platform: 'google', externalId });
});
afterAll(async () => t.drop());

function run(args: string[], stdin = '', env: NodeJS.ProcessEnv = { DATABASE_URL: t.url, VAULT_WRITE_KEY: writeKey }) {
  const printed: string[] = [];
  const deps: CliDeps = {
    env,
    readStdin: () => Promise.resolve(stdin),
    print: (line) => printed.push(line),
    connect: (url) => connect(url, { max: 1 }),
  };
  const program = quiet(buildProgram(deps));
  return { done: program.parseAsync(['node', 'ads-gw', ...args]), printed };
}

describe('ads-gw credentials', () => {
  it('stores and checks write and feedback credentials with the write key', async () => {
    for (const role of ['write', 'feedback']) {
      const put = run(
        ['credentials', 'put', '--account', `google:${externalId}`, '--role', role],
        '{"refresh_token":"r"}',
      );
      await put.done;
      expect(put.printed[0]).toBe(`stored the ${role} credential for google:${externalId} (sealed with write-v1)`);
      const check = run(['credentials', 'check', '--account', externalId, '--role', role]);
      await check.done;
      expect(check.printed[0]).toContain('fields: refresh_token');
    }
  });

  it('does not handle read credentials, nor accept a read key', async () => {
    await expect(run(['credentials', 'put', '--account', externalId, '--role', 'read'], '{}').done).rejects.toThrow(
      /Allowed choices are write, feedback/,
    );
    const readKey = `read-v1:${randomBytes(32).toString('base64')}`;
    await expect(
      run(['credentials', 'put', '--account', externalId, '--role', 'write'], '{}', {
        DATABASE_URL: t.url,
        VAULT_WRITE_KEY: readKey,
      }).done,
    ).rejects.toThrow(/must hold a write key/);
  });
});
