// Drift (BLUEPRINT §5.7): a tracked field that changed on the platform without a change of ours explaining it.
// The platform is the truth: the sync stores what it reads, and drift is only surfaced (`drift_events`), never
// reverted. Our own changes come from the change log, which only the gateway writes.
import type { EntityRef, Platform, WriteOp } from '@ads/contracts';
import {
  type AdEntity,
  type DbOrTx,
  type DriftEvent,
  listChangesSince,
  listEntities,
  recordDrift,
  recordSnapshot,
} from '@ads/db';

/** The fields whose changes are drift: status, daily budget, bid strategy type and name. */
export const DRIFT_FIELDS = ['status', 'dailyBudgetMicros', 'bidStrategy', 'name'] as const;
export type DriftField = (typeof DRIFT_FIELDS)[number];

export interface FieldChange {
  field: DriftField;
  expected: unknown;
  observed: unknown;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The drift fields of a stored snapshot (the connectors' `snapshotOf`). The status is the one a person sets:
 *  Meta's configured status (its effective status also moves when a parent is paused or an ad is in review),
 *  Google's `status` (its primary status moves on its own). */
export function trackedValues(platform: Platform, snapshot: Record<string, unknown>): Record<DriftField, unknown> {
  return {
    status:
      platform === 'meta'
        ? (text(snapshot['configuredStatus']) ?? text(snapshot['rawStatus']))
        : text(snapshot['rawStatus']),
    dailyBudgetMicros: snapshot['dailyBudgetMicros'] ?? null,
    bidStrategy: snapshot['bidStrategy'] ?? null,
    name: snapshot['name'] ?? null,
  };
}

/** The drift fields that differ between two snapshots of one entity. */
export function changedFields(
  platform: Platform,
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): FieldChange[] {
  const before = trackedValues(platform, previous);
  const after = trackedValues(platform, current);
  return DRIFT_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((field) => ({
    field,
    expected: before[field],
    observed: after[field],
  }));
}

export const refKey = (r: EntityRef): string => `${r.platform}:${r.accountId}:${r.type}:${r.externalId}`;

/** An entity's `attributes` (jsonb, an object by construction). */
export const attributesOf = (e: AdEntity): Record<string, unknown> =>
  e.attributes !== null && typeof e.attributes === 'object' ? (e.attributes as Record<string, unknown>) : {};

const PAUSED = new Set(['PAUSED']);
const ACTIVE = new Set(['ACTIVE', 'ENABLED']);

/** Whether one of our applied actions set this field to the observed value. `targets` are the refs whose
 *  changes reach this entity's field (itself, and for a Google budget amount the budget and its campaigns). */
export function explainedBy(change: FieldChange, action: WriteOp, targets: ReadonlySet<string>): boolean {
  const hits = 'target' in action && targets.has(refKey(action.target));
  if (!hits) return false;
  switch (action.action) {
    case 'pause_entity':
      return change.field === 'status' && typeof change.observed === 'string' && PAUSED.has(change.observed);
    case 'resume_entity':
      return change.field === 'status' && typeof change.observed === 'string' && ACTIVE.has(change.observed);
    case 'adjust_budget':
      return change.field === 'dailyBudgetMicros' && change.observed === action.newDailyBudgetMicros;
    case 'mark_abandoned': // stays paused, gets a name suffix or label (BLUEPRINT §3.6)
      return change.field === 'name';
    default:
      return false;
  }
}

/** The refs whose applied actions can explain a change on `entity`. A Google campaign's daily budget is its
 *  budget's amount, so a budget change explains it, and the other way round. */
async function targetsFor(db: DbOrTx, entity: AdEntity, ref: EntityRef): Promise<Set<string>> {
  const targets = new Set([refKey(ref)]);
  if (ref.platform !== 'google') return targets;
  const budgetId = attributesOf(entity)['budgetId'];
  if (ref.type === 'campaign' && typeof budgetId === 'string') {
    targets.add(refKey({ ...ref, type: 'budget', externalId: budgetId }));
  }
  if (ref.type === 'budget') {
    for (const c of await listEntities(db, entity.productId, { accountId: entity.accountId, type: 'campaign' })) {
      if (attributesOf(c)['budgetId'] === ref.externalId) {
        targets.add(refKey({ ...ref, type: 'campaign', externalId: c.externalId }));
      }
    }
  }
  return targets;
}

/** Stores the entity's snapshot if it changed, and in the same transaction records drift for every tracked field
 *  that changed without a change of ours since the previous snapshot. A crash can't store the snapshot without
 *  its drift (the next sync would compare against the new snapshot and miss it). A first snapshot is never drift. */
export async function recordSnapshotAndDrift(
  db: DbOrTx,
  input: { entity: AdEntity; ref: EntityRef; snapshot: Record<string, unknown>; takenAt?: Date },
): Promise<{ stored: boolean; drift: DriftEvent[] }> {
  const { entity, ref, snapshot } = input;
  return db.transaction(async (tx) => {
    const result = await recordSnapshot(tx, {
      productId: entity.productId,
      adEntityId: entity.id,
      snapshot,
      ...(input.takenAt === undefined ? {} : { takenAt: input.takenAt }),
    });
    if (!result.stored || result.previous === null) return { stored: result.stored, drift: [] };
    const changes = changedFields(ref.platform, result.previous.snapshot as Record<string, unknown>, snapshot);
    if (changes.length === 0) return { stored: true, drift: [] };

    const ours = await listChangesSince(tx, entity.productId, result.previous.takenAt);
    const targets = ours.length === 0 ? new Set<string>() : await targetsFor(tx, entity, ref);
    const drift: DriftEvent[] = [];
    for (const change of changes) {
      if (ours.some((c) => explainedBy(change, c.action, targets))) continue;
      drift.push(
        await recordDrift(tx, {
          productId: entity.productId,
          adEntityId: entity.id,
          field: change.field,
          expected: change.expected,
          observed: change.observed,
        }),
      );
    }
    return { stored: true, drift };
  });
}
