// Resolving what the analyst names (a look-up's ref, a finding's target) to rows of this product. A target that
// doesn't exist here, or belongs to another product, resolves to null and is dropped (PROPOSAL §6.5).
import { EntityType, type FindingTargetRef, Platform } from '@ads/contracts';
import { type DbOrTx, findEntityByRef, listAccounts } from '@ads/db';
import type { FindingTarget } from '../findings/evidence.ts';
import { PRODUCT_REF } from './refs.ts';

/** Parses a ref (`product`, `platform:accountId`, `platform:accountId:type:externalId`) into a target ref; null
 *  when it isn't one. */
export function parseRefText(text: string): FindingTargetRef | null {
  const none = { platform: null, accountId: null, type: null, externalId: null };
  if (text === PRODUCT_REF) return { level: 'product', ...none };
  const parts = text.split(':');
  const platform = Platform.safeParse(parts[0]);
  if (!platform.success || parts.some((p) => p === '')) return null;
  if (parts.length === 2) return { ...none, level: 'account', platform: platform.data, accountId: parts[1] ?? null };
  const type = EntityType.safeParse(parts[2]);
  if (parts.length !== 4 || !type.success) return null;
  return {
    level: 'entity',
    platform: platform.data,
    accountId: parts[1] ?? null,
    type: type.data,
    externalId: parts[3] ?? null,
  };
}

/** The product's row for a target ref, or null (unknown, another product's, or fields that don't fit the level). */
export async function resolveTargetRef(
  db: DbOrTx,
  productId: string,
  ref: FindingTargetRef,
): Promise<FindingTarget | null> {
  if (ref.level === 'product') {
    return ref.platform === null && ref.accountId === null && ref.type === null && ref.externalId === null
      ? { kind: 'product' }
      : null;
  }
  if (ref.platform === null || ref.accountId === null) return null;
  if (ref.level === 'account') {
    if (ref.type !== null || ref.externalId !== null) return null;
    const account = (await listAccounts(db, productId)).find(
      (a) => a.platform === ref.platform && a.externalId === ref.accountId,
    );
    return account === undefined ? null : { kind: 'account', account };
  }
  if (ref.type === null || ref.externalId === null) return null;
  const entity = await findEntityByRef(db, productId, {
    platform: ref.platform,
    accountId: ref.accountId,
    type: ref.type,
    externalId: ref.externalId,
  });
  return entity === null ? null : { kind: 'entity', entity };
}

export async function resolveRefText(db: DbOrTx, productId: string, text: string): Promise<FindingTarget | null> {
  const ref = parseRefText(text);
  return ref === null ? null : resolveTargetRef(db, productId, ref);
}
