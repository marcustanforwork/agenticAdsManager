// Alerts through the outbox (BLUEPRINT §5.16, M09a): what happened in a cycle → which alert, if any, goes to Marcus.
// `routeCycleEvent` is the routing table, pure and tested as a table; `raiseAlert` queues one `alert` notification
// per key, so a resumed stage or a retried job never sends the same alert twice. The worker's bot sends them (the
// gateway never holds the Telegram token).
import {
  type AdEntity,
  type CycleKind,
  type DbOrTx,
  enqueueNotification,
  findAlertNotification,
  getEntity,
  listAccounts,
  listDriftSince,
  listProposals,
} from '@ads/db';
import { targetRefOf } from '@ads/contracts';
import { entityRefOf, entityRefText } from './analyst/refs.ts';

export const ALERT_NOTIFICATION = 'alert';

/** The alerts this module raises, with the title the bot shows. (`invalid_settings` is raised by the settings
 *  loader, M05a; `job_failed` and `worker_recovered` are their own notification kinds.) */
export const ALERT_TITLES = {
  trust_check_failed: 'A trust check failed: this cycle stopped before the analysis',
  drift_on_open_proposal: 'Someone changed an ad entity that a pending proposal is about',
  cycle_failed: 'A scheduled cycle failed',
} as const;
export type AlertKind = keyof typeof ALERT_TITLES;

export interface DriftOnProposal {
  /** `platform:account:type:id` */
  target: string;
  fields: string[];
  /** The pending proposals on that target (short ids). */
  proposals: string[];
}

export type CycleEvent =
  | { event: 'trust_checked'; result: 'ok' | 'degraded' | 'fail'; failed: { check: string; account: string | null }[] }
  | { event: 'drift'; onOpenProposals: DriftOnProposal[] }
  | { event: 'failed'; kind: CycleKind; stage: string; error: string };

export interface Alert {
  alert: AlertKind;
  payload: Record<string, unknown>;
}

/** The routing table: which cycle events alert Marcus. A degraded trust result is in the brief, not an alert; drift
 *  on an entity no pending proposal targets is in the brief too; a manual cycle's failure is seen by whoever ran it. */
export function routeCycleEvent(e: CycleEvent): Alert | null {
  switch (e.event) {
    case 'trust_checked':
      return e.result === 'fail' ? { alert: 'trust_check_failed', payload: { failed: e.failed } } : null;
    case 'drift':
      return e.onOpenProposals.length === 0
        ? null
        : { alert: 'drift_on_open_proposal', payload: { entities: e.onOpenProposals } };
    case 'failed':
      return e.kind === 'manual'
        ? null
        : { alert: 'cycle_failed', payload: { kind: e.kind, stage: e.stage, error: e.error.slice(0, 500) } };
  }
}

/** Queues the alert for the cycle, once per (alert, cycle). Returns whether it was queued now. */
export async function raiseCycleAlert(
  db: DbOrTx,
  input: { productId: string; cycleId: string; alert: Alert },
): Promise<boolean> {
  const key = `${input.alert.alert}:${input.cycleId}`;
  if ((await findAlertNotification(db, key)) !== null) return false;
  await enqueueNotification(db, {
    productId: input.productId,
    kind: ALERT_NOTIFICATION,
    payload: { alert: input.alert.alert, key, cycleId: input.cycleId, ...input.alert.payload },
  });
  return true;
}

/** Routes the event and raises its alert, if any. */
export async function alertOnCycleEvent(
  db: DbOrTx,
  input: { productId: string; cycleId: string; event: CycleEvent },
): Promise<boolean> {
  const alert = routeCycleEvent(input.event);
  return alert === null ? false : raiseCycleAlert(db, { productId: input.productId, cycleId: input.cycleId, alert });
}

/** The drift recorded since `since` on entities that a pending proposal targets, grouped by entity. */
export async function driftOnOpenProposals(
  db: DbOrTx,
  input: { productId: string; since: Date },
): Promise<DriftOnProposal[]> {
  const drift = await listDriftSince(db, input);
  if (drift.length === 0) return [];
  // Pending only: in Phase 1 Marcus makes an approved change by hand, which the sync then records as drift; from
  // Phase 2 the gateway's fingerprint check refuses an approved change whose target moved (M11a).
  const pending = await listProposals(db, input.productId, ['pending']);
  const byTarget = new Map<string, string[]>();
  for (const p of pending) {
    const ref = targetRefOf(p.action);
    if (ref === null) continue;
    byTarget.set(entityRefText(ref), [...(byTarget.get(entityRefText(ref)) ?? []), p.shortId]);
  }
  if (byTarget.size === 0) return [];
  const accounts = new Map((await listAccounts(db, input.productId)).map((a) => [a.id, a] as const));
  const entities = new Map<string, AdEntity>();
  const out = new Map<string, DriftOnProposal>();
  for (const event of drift) {
    const entity = entities.get(event.adEntityId) ?? (await getEntity(db, event.adEntityId));
    entities.set(entity.id, entity);
    const target = entityRefText(entityRefOf(entity, accounts.get(entity.accountId) ?? { externalId: '?' }));
    const proposals = byTarget.get(target);
    if (proposals === undefined) continue;
    const entry = out.get(target) ?? { target, fields: [], proposals: [...proposals].sort() };
    if (!entry.fields.includes(event.field)) entry.fields.push(event.field);
    out.set(target, entry);
  }
  return [...out.values()]
    .map((e) => ({ ...e, fields: e.fields.sort() }))
    .sort((a, b) => a.target.localeCompare(b.target));
}
