// @ads/vault: envelope encryption for platform tokens (PROPOSAL §6.13, BLUEPRINT M01b).
//
// Each credential row holds the token encrypted with its own random data key (AES-256-GCM), and that data key
// encrypted with a master key. There are two master-key classes:
//   - `read-vN`  opens `read` credentials only. The worker holds it.
//   - `write-vN` opens `write` and `feedback` credentials only. The gateway holds it.
// So the read key cannot open a write row: it isn't the key that row was sealed with, and `get` refuses it
// before trying. Every `get` writes a `credential_access` audit row. Tokens are decrypted just-in-time and
// never logged; callers validate the returned JSON themselves.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NotFoundError, schema, type DbOrTx } from '@ads/db';
import { and, eq } from 'drizzle-orm';

const { accounts, credentialAccess, credentials } = schema;

export type CredentialRole = (typeof schema.CREDENTIAL_ROLES)[number];
export type VaultProcess = (typeof schema.PROCESSES)[number];
export type KeyClass = 'read' | 'write';

export interface MasterKey {
  /** `read-v1`, `write-v2`, …: the class, then the version. Stored on each row as `master_key_id`. */
  id: string;
  key: Buffer;
}

/** A key that isn't allowed to open this credential, or isn't the one it was sealed with. */
export class VaultKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultKeyError';
  }
}

/** Decryption failed: wrong key material, or the ciphertext was altered or moved to another row. */
export class VaultDecryptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VaultDecryptError';
  }
}

const KEY_ID = /^(read|write)-v[1-9]\d*$/;
const KEY_BYTES = 32;
const IV_BYTES = 12; // the standard GCM nonce size (NIST SP 800-38D)
const TAG_BYTES = 16;
const FORMAT = 1; // first byte of every sealed value, so the format can change later

export const keyClassFor = (role: CredentialRole): KeyClass => (role === 'read' ? 'read' : 'write');
export const keyClassOf = (key: MasterKey): KeyClass => (key.id.startsWith('read-') ? 'read' : 'write');

/** Parses `<id>:<base64 of 32 random bytes>`, e.g. from `VAULT_READ_KEY`. Make one with
 *  `echo "read-v1:$(openssl rand -base64 32)"`. The error never includes the key material. */
export function parseMasterKey(text: string): MasterKey {
  const sep = text.indexOf(':');
  const id = sep < 0 ? '' : text.slice(0, sep).trim();
  if (!KEY_ID.test(id)) throw new VaultKeyError('a master key looks like "read-v1:<base64>" or "write-v1:<base64>"');
  const key = Buffer.from(text.slice(sep + 1).trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new VaultKeyError(`master key ${id} must be ${KEY_BYTES} bytes (base64)`);
  return { id, key };
}

/** Reads a master key from an environment variable, requiring the given class. */
export function masterKeyFromEnv(name: string, keyClass: KeyClass, env = process.env): MasterKey {
  const text = env[name];
  if (text === undefined || text === '') throw new VaultKeyError(`${name} is not set`);
  const key = parseMasterKey(text);
  if (keyClassOf(key) !== keyClass) throw new VaultKeyError(`${name} must hold a ${keyClass} key, not ${key.id}`);
  return key;
}

function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== FORMAT) {
    throw new VaultDecryptError('unrecognised ciphertext format');
  }
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (error) {
    throw new VaultDecryptError('could not decrypt: wrong key, or the ciphertext was altered', { cause: error });
  }
}

// The additional authenticated data binds each ciphertext to its row, so a sealed value copied onto another
// account or role (or a data key presented under another master key id) fails to open.
const tokenAad = (accountId: string, role: CredentialRole) => `ads-vault:v1:token:${accountId}:${role}`;
const dataKeyAad = (accountId: string, role: CredentialRole, keyId: string) =>
  `ads-vault:v1:data-key:${accountId}:${role}:${keyId}`;

function requireClass(key: MasterKey, role: CredentialRole): void {
  if (!KEY_ID.test(key.id) || key.key.length !== KEY_BYTES) throw new VaultKeyError('malformed master key');
  const needed = keyClassFor(role);
  if (keyClassOf(key) !== needed) {
    throw new VaultKeyError(`a ${keyClassOf(key)} key cannot open ${role} credentials (needs a ${needed} key)`);
  }
}

/** Stores (or replaces) the token for an account and role, sealed under a fresh data key. */
export async function put(
  db: DbOrTx,
  accountId: string,
  role: CredentialRole,
  tokenJson: unknown,
  masterKey: MasterKey,
): Promise<{ credentialId: string }> {
  requireClass(masterKey, role);
  const plaintext = JSON.stringify(tokenJson) as string | undefined;
  if (plaintext === undefined) throw new TypeError('the token must be JSON');
  const [account] = await db.select({ productId: accounts.productId }).from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new NotFoundError('account', accountId);

  const dataKey = randomBytes(KEY_BYTES);
  try {
    const values = {
      ciphertext: seal(dataKey, Buffer.from(plaintext, 'utf8'), tokenAad(accountId, role)),
      dataKeyCiphertext: seal(masterKey.key, dataKey, dataKeyAad(accountId, role, masterKey.id)),
      masterKeyId: masterKey.id,
      rotatedAt: new Date(),
    };
    const [row] = await db
      .insert(credentials)
      .values({ productId: account.productId, accountId, role, ...values })
      .onConflictDoUpdate({ target: [credentials.accountId, credentials.role], set: values })
      .returning({ id: credentials.id });
    if (!row) throw new Error('upsert into credentials returned nothing');
    return { credentialId: row.id };
  } finally {
    dataKey.fill(0);
  }
}

/** Decrypts the token for an account and role. Writes a `credential_access` row first, so every attempt with
 *  the right class of key is audited, even one that then fails to decrypt. */
export async function get(
  db: DbOrTx,
  accountId: string,
  role: CredentialRole,
  access: { process: VaultProcess; purpose: string },
  masterKey: MasterKey,
): Promise<unknown> {
  requireClass(masterKey, role);
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.accountId, accountId), eq(credentials.role, role)));
  if (!row) throw new NotFoundError(`${role} credential for account`, accountId);
  await db.insert(credentialAccess).values({ credentialId: row.id, process: access.process, purpose: access.purpose });
  if (row.masterKeyId !== masterKey.id) {
    throw new VaultKeyError(`this credential is sealed with ${row.masterKeyId}, not ${masterKey.id}`);
  }
  const dataKey = open(masterKey.key, row.dataKeyCiphertext, dataKeyAad(accountId, role, row.masterKeyId));
  try {
    return JSON.parse(open(dataKey, row.ciphertext, tokenAad(accountId, role)).toString('utf8')) as unknown;
  } finally {
    dataKey.fill(0);
  }
}

/** Re-wraps every data key sealed with `from` under `to` (same class, e.g. read-v1 → read-v2). The tokens'
 *  own ciphertext is unchanged. Runs in one transaction: either every row moves or none does.
 *  Returns how many credentials were re-wrapped. */
export async function rotateMasterKey(db: DbOrTx, from: MasterKey, to: MasterKey): Promise<number> {
  if (keyClassOf(from) !== keyClassOf(to)) throw new VaultKeyError(`cannot rotate ${from.id} to ${to.id}`);
  if (from.id === to.id) throw new VaultKeyError('the new key needs a new id (e.g. read-v2)');
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(credentials).where(eq(credentials.masterKeyId, from.id)).for('update');
    for (const row of rows) {
      const dataKey = open(from.key, row.dataKeyCiphertext, dataKeyAad(row.accountId, row.role, from.id));
      try {
        await tx
          .update(credentials)
          .set({
            dataKeyCiphertext: seal(to.key, dataKey, dataKeyAad(row.accountId, row.role, to.id)),
            masterKeyId: to.id,
            rotatedAt: new Date(),
          })
          .where(eq(credentials.id, row.id));
      } finally {
        dataKey.fill(0);
      }
    }
    return rows.length;
  });
}
export * from './commands.ts';
