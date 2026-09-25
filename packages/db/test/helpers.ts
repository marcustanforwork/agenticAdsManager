// Shared test data. Each test file gets its own database (createTestDatabase); these helpers make
// uniquely named rows so tests in one file don't interfere.
import type { EntityRef, ProductSettings, WriteOp } from '@ads/contracts';
import { randomBytes } from 'node:crypto';
import type { DbOrTx } from '../src/client.ts';
import { upsertAccount, upsertAdEntity } from '../src/repos/adData.ts';
import { createProduct } from '../src/repos/products.ts';
import { TEST_SETTINGS } from '../src/testing.ts';

export const uniq = (prefix = 'x'): string => `${prefix}-${randomBytes(4).toString('hex')}`;

export const SETTINGS: ProductSettings = TEST_SETTINGS;

export async function makeProduct(db: DbOrTx) {
  return createProduct(db, { slug: uniq('p'), name: 'Test product', packId: 'test-pack', settings: SETTINGS });
}

/** A product with one Google account and one campaign. */
export async function makeCampaign(db: DbOrTx) {
  const product = await makeProduct(db);
  const account = await upsertAccount(db, {
    productId: product.id,
    platform: 'google',
    externalId: String(Date.now()) + randomBytes(2).readUInt16BE(0),
  });
  const campaign = await upsertAdEntity(db, {
    productId: product.id,
    accountId: account.id,
    platform: 'google',
    type: 'campaign',
    externalId: uniq('c'),
    name: 'Campaign',
    status: 'active',
    rawStatus: 'ENABLED',
    dailyBudgetMicros: 20_000_000n,
  });
  const ref: EntityRef = {
    platform: 'google',
    accountId: account.externalId,
    type: 'campaign',
    externalId: campaign.externalId,
  };
  return { product, account, campaign, ref };
}

export const pauseOp = (target: EntityRef): WriteOp => ({ action: 'pause_entity', target });

export const IN_A_DAY = () => new Date(Date.now() + 86_400_000);

/** Asserts that `promise` fails on the named Postgres constraint (Drizzle wraps the pg error in `cause`). */
export async function expectConstraint(promise: Promise<unknown>, constraint: string): Promise<void> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  let found: unknown = null;
  for (let e = error, i = 0; e !== null && typeof e === 'object' && i < 5; i++) {
    if ((e as { constraint?: unknown }).constraint === constraint) found = e;
    e = (e as { cause?: unknown }).cause;
  }
  if (found === null) throw new Error(`expected a violation of ${constraint}, got: ${String(error)}`);
}
