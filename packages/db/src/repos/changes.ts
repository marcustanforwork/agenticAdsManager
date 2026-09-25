// The change log (written only by the gateway) and undo proposals, which the worker and the gateway share.
import { hashOf, undoFor, UndoContextError, WriteOp, type ApplyContext } from '@ads/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { DbOrTx } from '../client.ts';
import { NotFoundError, RefusedError } from '../errors.ts';
import { changeLog, proposals } from '../schema.ts';
import { createProposal, defaultExpiry, getProposal, type ProposalRecord } from './proposals.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48-bit millisecond time + 80 random bits, Crockford base32, 26 characters. Sorts by time. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  const random = Array.from(randomBytes(16), (b) => CROCKFORD[b & 31]).join('');
  return time + random;
}

/** 'rev_' + ULID. */
export const newRevisionId = (now?: number): string => `rev_${ulid(now)}`;

type ChangeRow = typeof changeLog.$inferSelect;
export type Change = Omit<ChangeRow, 'action' | 'undo'> & { action: WriteOp; undo: WriteOp | null };

const toChange = (row: ChangeRow): Change => ({
  ...row,
  action: WriteOp.parse(row.action),
  undo: row.undo === null ? null : WriteOp.parse(row.undo),
});

/** Records an applied change (gateway step 11). Returns the new revision id. */
export async function insertChange(
  db: DbOrTx,
  input: {
    revisionId?: string;
    productId: string;
    proposalId: string;
    action: WriteOp;
    undo: WriteOp | null;
    before: unknown;
    after: unknown;
    approvedBy: string;
    verified: boolean;
  },
): Promise<string> {
  const revisionId = input.revisionId ?? newRevisionId();
  await db.insert(changeLog).values({ ...input, revisionId });
  return revisionId;
}

export async function getChange(db: DbOrTx, revisionId: string): Promise<Change> {
  const [row] = await db.select().from(changeLog).where(eq(changeLog.revisionId, revisionId));
  if (!row) throw new NotFoundError('change', revisionId);
  return toChange(row);
}

export async function listChanges(db: DbOrTx, productId: string, limit = 50): Promise<Change[]> {
  const rows = await db
    .select()
    .from(changeLog)
    .where(eq(changeLog.productId, productId))
    .orderBy(desc(changeLog.appliedAt))
    .limit(limit);
  return rows.map(toChange);
}

/** Links a change to the revision that undid it. Only the first undo counts; a second call is refused. */
export async function markReverted(db: DbOrTx, revisionId: string, byRevisionId: string): Promise<void> {
  const rows = await db
    .update(changeLog)
    .set({ revertedByRevisionId: byRevisionId })
    .where(and(eq(changeLog.revisionId, revisionId), isNull(changeLog.revertedByRevisionId)))
    .returning({ id: changeLog.revisionId });
  if (rows.length === 0) {
    await getChange(db, revisionId); // NotFoundError if missing
    throw new RefusedError(`${revisionId} was already reverted`);
  }
}

/** What an undo proposal needs to know to build ITS undo (an undo of an undo), taken from the original action. */
function contextFromOriginal(original: WriteOp): ApplyContext {
  switch (original.action) {
    case 'add_negative_keyword': // undo = remove it; undoing that re-adds the same text and match type
      return { removedNegative: { text: original.text, matchType: original.matchType } };
    case 'adjust_budget': // undo = back to the old amount; undoing that sets our amount again
      return { previousDailyBudgetMicros: original.newDailyBudgetMicros };
    default:
      return {};
  }
}

function pick(value: unknown, fields: readonly string[]): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter((f) => f in record).map((f) => [f, record[f]]));
}

export interface UndoProposalOptions {
  /** The fingerprint fields for the undo action (the gateway's `fieldsFor`, BLUEPRINT §3.6). By default, every
   *  top-level field of the change's `after` state. */
  fieldsFor?: (op: WriteOp) => string[];
  requestId?: string | null;
  now?: Date;
}

/** BLUEPRINT §6 "Undo": a pending operator proposal whose action is the change's stored undo, with
 *  revertsRevisionId set and the fingerprint (precondition hash) taken from the change's `after` state.
 *  An open undo proposal for the same revision is returned instead of creating a second one.
 *  Refused if the change has no undo (irreversible or terminal) or was already reverted. */
export async function createUndoProposal(
  db: DbOrTx,
  revisionId: string,
  options: UndoProposalOptions = {},
): Promise<{ proposal: ProposalRecord; created: boolean }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(changeLog).where(eq(changeLog.revisionId, revisionId)).for('update');
    if (!locked) throw new NotFoundError('change', revisionId);
    const change = toChange(locked);
    if (change.undo === null) throw new RefusedError(`${revisionId} (${change.action.action}) cannot be undone`);
    if (change.revertedByRevisionId !== null) {
      throw new RefusedError(`${revisionId} was already reverted by ${change.revertedByRevisionId}`);
    }
    const [open] = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(
        and(
          eq(proposals.revertsRevisionId, revisionId),
          inArray(proposals.status, ['pending', 'approved', 'applying', 'needs_attention']),
        ),
      );
    if (open) return { proposal: await getProposal(tx, open.id), created: false };

    const action = change.undo;
    let undo: WriteOp | null;
    try {
      undo = undoFor(action, contextFromOriginal(change.action));
    } catch (error) {
      // Only known once applied (e.g. the criterion id a re-added negative gets); the gateway stores it then.
      if (!(error instanceof UndoContextError)) throw error;
      undo = null;
    }
    const isPlainObject = change.after !== null && typeof change.after === 'object' && !Array.isArray(change.after);
    const fields = options.fieldsFor
      ? options.fieldsFor(action)
      : isPlainObject
        ? Object.keys(change.after as Record<string, unknown>).sort()
        : [];
    const proposal = await createProposal(tx, {
      productId: change.productId,
      origin: 'operator',
      action,
      undo,
      revertsRevisionId: revisionId,
      preconditionHash: hashOf(pick(change.after, fields)),
      preconditionFields: fields,
      rationale: `Undo of ${revisionId} (${change.action.action}).`,
      expectedEffect: `Restores the state from before ${revisionId}.`,
      expiresAt: defaultExpiry(action, options.now),
      requestId: options.requestId ?? null,
    });
    return { proposal, created: true };
  });
}
