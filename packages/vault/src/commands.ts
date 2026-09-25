// What the `ads credentials …` and `ads-gw credentials …` commands do, shared by both CLIs. Tokens arrive on
// stdin only (never as arguments, which end up in shell history and `ps`), and nothing here prints a token.
import { NotFoundError, findAccount, schema, type DbOrTx } from '@ads/db';
import { Platform } from '@ads/contracts';
import { eq } from 'drizzle-orm';
import { get, put, rotateMasterKey, type CredentialRole, type MasterKey } from './index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds an account by its id, by `platform:externalId` (e.g. `meta:act_123`), or by a bare external id
 *  when only one platform has it. */
export async function resolveAccount(db: DbOrTx, ref: string): Promise<{ id: string; label: string }> {
  const { accounts } = schema;
  const label = (a: { platform: string; externalId: string }) => `${a.platform}:${a.externalId}`;
  if (UUID.test(ref)) {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, ref));
    if (!row) throw new NotFoundError('account', ref);
    return { id: row.id, label: label(row) };
  }
  const sep = ref.indexOf(':');
  const platform = Platform.safeParse(sep < 0 ? '' : ref.slice(0, sep));
  if (platform.success) {
    const row = await findAccount(db, platform.data, ref.slice(sep + 1));
    if (!row) throw new NotFoundError('account', ref);
    return { id: row.id, label: label(row) };
  }
  const rows = await db.select().from(accounts).where(eq(accounts.externalId, ref));
  const [only] = rows;
  if (rows.length > 1) throw new Error(`${ref} exists on several platforms; write it as <platform>:${ref}`);
  if (!only) throw new NotFoundError('account', ref);
  return { id: only.id, label: label(only) };
}

/** Parses the token text read from stdin. It must be a JSON object; the error never quotes the input. */
export function parseTokenText(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('stdin must be the token as a JSON object (the input was not valid JSON)');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stdin must be the token as a JSON object');
  }
  return value as Record<string, unknown>;
}

export async function putCredentialCommand(
  db: DbOrTx,
  input: { account: string; role: CredentialRole; tokenText: string; masterKey: MasterKey },
): Promise<string> {
  const token = parseTokenText(input.tokenText);
  const account = await resolveAccount(db, input.account);
  await put(db, account.id, input.role, token, input.masterKey);
  return `stored the ${input.role} credential for ${account.label} (sealed with ${input.masterKey.id})`;
}

/** Decrypts the credential to prove the key opens it (audited as purpose `cli check`), and prints only the
 *  names of its fields. */
export async function checkCredentialCommand(
  db: DbOrTx,
  input: { account: string; role: CredentialRole; masterKey: MasterKey },
): Promise<string> {
  const account = await resolveAccount(db, input.account);
  const token = await get(db, account.id, input.role, { process: 'cli', purpose: 'cli check' }, input.masterKey);
  const fields = token !== null && typeof token === 'object' ? Object.keys(token).sort().join(', ') : '(not an object)';
  return `the ${input.role} credential for ${account.label} opens with ${input.masterKey.id}; fields: ${fields}`;
}

export async function rotateKeyCommand(db: DbOrTx, input: { from: MasterKey; to: MasterKey }): Promise<string> {
  const count = await rotateMasterKey(db, input.from, input.to);
  return `re-wrapped ${count} credential(s) from ${input.from.id} to ${input.to.id}`;
}

/** Reads all of stdin as text. */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk));
  return Buffer.concat(chunks).toString('utf8');
}
