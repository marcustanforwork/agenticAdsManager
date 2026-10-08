// How the analyst's input names things (M06b): refs that map one-to-one onto `FindingTargetRef`, and money as a
// decimal string in the account currency (invariant 6: never a float).
import type { ComputedEvidence, EntityRef, FindingTargetRef } from '@ads/contracts';
import type { Account, AdEntity, Finding } from '@ads/db';
import type { FindingTarget } from '../findings/evidence.ts';

/** `google:1234567890:campaign:42`: platform, account id, entity type, external id. */
export const entityRefText = (ref: EntityRef): string =>
  `${ref.platform}:${ref.accountId}:${ref.type}:${ref.externalId}`;

/** `meta:act_123`. */
export const accountRefText = (account: Pick<Account, 'platform' | 'externalId'>): string =>
  `${account.platform}:${account.externalId}`;

export const PRODUCT_REF = 'product';

export const entityRefOf = (entity: AdEntity, account: Pick<Account, 'externalId'>): EntityRef => ({
  platform: entity.platform,
  accountId: account.externalId,
  type: entity.type,
  externalId: entity.externalId,
});

/** A finding target's ref (the accounts by id resolve an entity's account id). */
export function targetRefText(target: FindingTarget, accountsById: ReadonlyMap<string, Account>): string {
  if (target.kind === 'product') return PRODUCT_REF;
  if (target.kind === 'account') return accountRefText(target.account);
  const account = accountsById.get(target.entity.accountId);
  return entityRefText(entityRefOf(target.entity, { externalId: account?.externalId ?? '?' }));
}

/** The ref the analyst wrote, for messages (null fields shown as `?`). */
export function analystRefText(ref: FindingTargetRef): string {
  const part = (v: string | null): string => v ?? '?';
  if (ref.level === 'product') return PRODUCT_REF;
  if (ref.level === 'account') return `${part(ref.platform)}:${part(ref.accountId)}`;
  return `${part(ref.platform)}:${part(ref.accountId)}:${part(ref.type)}:${part(ref.externalId)}`;
}

/** Micros as a decimal string with two places, rounded half away from zero: `40000000` → `"40.00"`. */
export function microsToDecimal(micros: bigint): string {
  const negative = micros < 0n;
  const cents = ((negative ? -micros : micros) + 5_000n) / 10_000n;
  const text = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
  return negative && cents > 0n ? `-${text}` : text;
}

const MICROS_KEY = /Micros$/;

/** Computed evidence as the analyst sees it: money in currency units, the rule's figures alongside. */
export function evidenceForAnalyst(evidence: ComputedEvidence): Record<string, unknown> {
  const detail =
    evidence.detail === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(evidence.detail).map(([key, value]) =>
            MICROS_KEY.test(key) && typeof value === 'string' && /^-?\d+$/.test(value)
              ? [key.replace(MICROS_KEY, ''), microsToDecimal(BigInt(value))]
              : [key, value],
          ),
        );
  return {
    from: evidence.from,
    to: evidence.to,
    dataDays: evidence.dataDays,
    impressions: evidence.impressions,
    clicks: evidence.clicks,
    spend: microsToDecimal(BigInt(evidence.spendMicros)),
    outcomes: evidence.outcomesByStage,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** A stored finding's target (D-079): its entity, else its account, else (both null) the product. Null when the row
 *  names an entity or account that isn't in the maps. */
export function findingTargetOf(
  row: Pick<Finding, 'targetEntityId' | 'targetAccountId'>,
  entitiesById: ReadonlyMap<string, AdEntity>,
  accountsById: ReadonlyMap<string, Account>,
): FindingTarget | null {
  if (row.targetEntityId !== null) {
    const entity = entitiesById.get(row.targetEntityId);
    return entity === undefined ? null : { kind: 'entity', entity };
  }
  if (row.targetAccountId !== null) {
    const account = accountsById.get(row.targetAccountId);
    return account === undefined ? null : { kind: 'account', account };
  }
  return { kind: 'product' };
}

/** A stored finding's target as a ref (`?` when it can't be resolved). */
export function findingRefText(
  row: Pick<Finding, 'targetEntityId' | 'targetAccountId'>,
  entitiesById: ReadonlyMap<string, AdEntity>,
  accountsById: ReadonlyMap<string, Account>,
): string {
  const target = findingTargetOf(row, entitiesById, accountsById);
  return target === null ? '?' : targetRefText(target, accountsById);
}
