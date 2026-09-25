import { randomBytes } from 'node:crypto';
import { createProduct, schema, upsertAccount } from '@ads/db';
import { createTestDatabase, TEST_SETTINGS, type TestDatabase } from '@ads/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VaultDecryptError,
  VaultKeyError,
  get,
  masterKeyFromEnv,
  parseMasterKey,
  put,
  rotateMasterKey,
  type MasterKey,
} from '../src/index.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const newKey = (id: string): MasterKey => ({ id, key: randomBytes(32) });
const READ = newKey('read-v1');
const WRITE = newKey('write-v1');
const TOKEN = { refresh_token: 'rt-secret', client: 'x' };
const worker = { process: 'worker', purpose: 'test' } as const;
const gateway = { process: 'gateway', purpose: 'test' } as const;

async function makeAccount() {
  const product = await createProduct(t.db, {
    slug: `p-${randomBytes(4).toString('hex')}`,
    name: 'Vault test',
    packId: 'test-pack',
    settings: TEST_SETTINGS,
  });
  const account = await upsertAccount(t.db, {
    productId: product.id,
    platform: 'meta',
    externalId: `act_${randomBytes(6).toString('hex')}`,
  });
  return account.id;
}

const auditCount = async (accountId: string) => {
  const [row] = await t.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.credentialAccess)
    .innerJoin(schema.credentials, eq(schema.credentials.id, schema.credentialAccess.credentialId))
    .where(eq(schema.credentials.accountId, accountId));
  return row?.n ?? 0;
};

describe('put and get', () => {
  it('round-trips a token, and stores no plaintext', async () => {
    const accountId = await makeAccount();
    await put(t.db, accountId, 'read', TOKEN, READ);
    expect(await get(t.db, accountId, 'read', worker, READ)).toEqual(TOKEN);
    const [row] = await t.db.select().from(schema.credentials).where(eq(schema.credentials.accountId, accountId));
    expect(row?.masterKeyId).toBe('read-v1');
    expect(row?.ciphertext.toString('latin1')).not.toContain('rt-secret');
  });

  it('replaces the token on a second put', async () => {
    const accountId = await makeAccount();
    await put(t.db, accountId, 'write', { v: 1 }, WRITE);
    await put(t.db, accountId, 'write', { v: 2 }, WRITE);
    expect(await get(t.db, accountId, 'write', gateway, WRITE)).toEqual({ v: 2 });
  });

  it('writes an audit row on every get', async () => {
    const accountId = await makeAccount();
    await put(t.db, accountId, 'read', TOKEN, READ);
    await get(t.db, accountId, 'read', { process: 'worker', purpose: 'sync' }, READ);
    await get(t.db, accountId, 'read', { process: 'cli', purpose: 'check' }, READ);
    expect(await auditCount(accountId)).toBe(2);
    const rows = await t.db
      .select({ process: schema.credentialAccess.process, purpose: schema.credentialAccess.purpose })
      .from(schema.credentialAccess)
      .innerJoin(schema.credentials, eq(schema.credentials.id, schema.credentialAccess.credentialId))
      .where(eq(schema.credentials.accountId, accountId));
    expect(rows).toEqual(
      expect.arrayContaining([
        { process: 'worker', purpose: 'sync' },
        { process: 'cli', purpose: 'check' },
      ]),
    );
  });
});

describe('keys', () => {
  it('a wrong key of the same id fails to decrypt', async () => {
    const accountId = await makeAccount();
    await put(t.db, accountId, 'read', TOKEN, READ);
    const impostor = newKey('read-v1');
    await expect(get(t.db, accountId, 'read', worker, impostor)).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it('the read key cannot open write or feedback rows, and is not audited as if it could', async () => {
    const accountId = await makeAccount();
    await put(t.db, accountId, 'write', TOKEN, WRITE);
    await put(t.db, accountId, 'feedback', TOKEN, WRITE);
    await expect(get(t.db, accountId, 'write', worker, READ)).rejects.toThrow(/read key cannot open write/);
    await expect(get(t.db, accountId, 'feedback', worker, READ)).rejects.toBeInstanceOf(VaultKeyError);
    // Even disguised as a write key, the read key material can't open the row.
    await expect(get(t.db, accountId, 'write', worker, { id: 'write-v1', key: READ.key })).rejects.toBeInstanceOf(
      VaultDecryptError,
    );
    expect(await auditCount(accountId)).toBe(1); // only the disguised attempt got as far as the row
  });

  it('the write key cannot store or open read rows', async () => {
    const accountId = await makeAccount();
    await expect(put(t.db, accountId, 'read', TOKEN, WRITE)).rejects.toBeInstanceOf(VaultKeyError);
    await put(t.db, accountId, 'read', TOKEN, READ);
    await expect(get(t.db, accountId, 'read', gateway, WRITE)).rejects.toBeInstanceOf(VaultKeyError);
  });

  it('a ciphertext moved to another account does not open', async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    await put(t.db, a, 'read', { who: 'a' }, READ);
    await put(t.db, b, 'read', { who: 'b' }, READ);
    const [rowA] = await t.db.select().from(schema.credentials).where(eq(schema.credentials.accountId, a));
    await t.db
      .update(schema.credentials)
      .set({ ciphertext: rowA?.ciphertext, dataKeyCiphertext: rowA?.dataKeyCiphertext })
      .where(eq(schema.credentials.accountId, b));
    await expect(get(t.db, b, 'read', worker, READ)).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it('parses keys from the environment without echoing them', () => {
    const b64 = randomBytes(32).toString('base64');
    expect(parseMasterKey(`read-v3:${b64}`).id).toBe('read-v3');
    expect(() => parseMasterKey(`admin-v1:${b64}`)).toThrow(VaultKeyError);
    expect(() => parseMasterKey('read-v1:c2hvcnQ=')).toThrow(/32 bytes/);
    expect(() => masterKeyFromEnv('K', 'write', { K: `read-v1:${b64}` })).toThrow(/must hold a write key/);
    expect(() => masterKeyFromEnv('K', 'read', {})).toThrow(/K is not set/);
    try {
      parseMasterKey(`nope:${b64}`);
    } catch (error) {
      expect(String(error)).not.toContain(b64);
    }
  });
});

describe('rotation', () => {
  it('re-wraps every row of the old key; the old key then stops working', async () => {
    const R = newKey('read-v7'); // its own key: other tests leave deliberately broken read-v1 rows
    const a = await makeAccount();
    const b = await makeAccount();
    await put(t.db, a, 'read', { who: 'a' }, R);
    await put(t.db, b, 'read', { who: 'b' }, R);
    await put(t.db, b, 'write', { who: 'bw' }, WRITE);
    const next = newKey('read-v8');

    const moved = await rotateMasterKey(t.db, R, next);
    expect(moved).toBe(2);
    expect(await get(t.db, a, 'read', worker, next)).toEqual({ who: 'a' });
    expect(await get(t.db, b, 'read', worker, next)).toEqual({ who: 'b' });
    await expect(get(t.db, a, 'read', worker, R)).rejects.toThrow(/sealed with read-v8/);
    expect(await get(t.db, b, 'write', gateway, WRITE)).toEqual({ who: 'bw' }); // untouched

    await expect(rotateMasterKey(t.db, WRITE, newKey('read-v9'))).rejects.toBeInstanceOf(VaultKeyError);
    await expect(rotateMasterKey(t.db, next, newKey('read-v8'))).rejects.toThrow(/new id/);
  });

  it('rolls back entirely if any row fails to open with the old key', async () => {
    const good = await makeAccount();
    const bad = await makeAccount();
    const k = newKey('write-v5');
    await put(t.db, good, 'write', { ok: true }, k);
    await put(t.db, bad, 'write', { ok: true }, { id: 'write-v5', key: randomBytes(32) }); // same id, other bytes
    await expect(rotateMasterKey(t.db, k, newKey('write-v6'))).rejects.toBeInstanceOf(VaultDecryptError);
    expect(await get(t.db, good, 'write', gateway, k)).toEqual({ ok: true }); // still on write-v5
  });
});

describe('database roles', () => {
  it('the gateway role can store and read write credentials', async () => {
    const accountId = await makeAccount();
    await t.db.transaction(async (tx) => {
      await tx.execute(sql`set local role agent_gateway`);
      await put(tx, accountId, 'write', TOKEN, WRITE);
      expect(await get(tx, accountId, 'write', gateway, WRITE)).toEqual(TOKEN);
    });
  });
});
