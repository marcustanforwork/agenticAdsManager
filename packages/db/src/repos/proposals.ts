// Proposals, their versions, the §3.9 state machine, and approvals.
import { hashOf, WriteOp, type ProposalStatus } from '@ads/contracts';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { DbOrTx } from '../client.ts';
import {
  IllegalTransitionError,
  NotFoundError,
  RefusedError,
  StaleVersionError,
  isUniqueViolation,
} from '../errors.ts';
import { approvals, proposals, proposalVersions, type APPROVAL_CHANNELS, type PROPOSAL_ORIGINS } from '../schema.ts';

/** BLUEPRINT §3.9: every allowed status change. Anything else throws IllegalTransitionError.
 *  `pending → pending` (an edit) is not a status change: it is `newVersion`. */
export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  pending: ['approved', 'rejected', 'expired'],
  approved: ['expired', 'blocked', 'stale', 'applying'],
  applying: ['applied', 'failed', 'rolled_back', 'needs_attention'],
  needs_attention: ['applied', 'failed'], // Marcus's resolve_attention
  applied: ['reverted'],
  rejected: [],
  expired: [],
  blocked: [],
  stale: [],
  failed: [],
  rolled_back: [],
  reverted: [],
};

export const TERMINAL_STATUSES: readonly ProposalStatus[] = (
  Object.keys(PROPOSAL_TRANSITIONS) as ProposalStatus[]
).filter((s) => PROPOSAL_TRANSITIONS[s].length === 0);

export const canTransition = (from: ProposalStatus, to: ProposalStatus): boolean =>
  PROPOSAL_TRANSITIONS[from].includes(to);

type ProposalRow = typeof proposals.$inferSelect;
/** A proposal row with its action and undo validated against the WriteOp contract. */
export type ProposalRecord = Omit<ProposalRow, 'action' | 'undo'> & { action: WriteOp; undo: WriteOp | null };

const toRecord = (row: ProposalRow): ProposalRecord => ({
  ...row,
  action: WriteOp.parse(row.action),
  undo: row.undo === null ? null : WriteOp.parse(row.undo),
});

const HOUR_MS = 3_600_000;
/** Default expiry (BLUEPRINT §3.8): adjust_budget 72 h, everything else 7 days. Operator confirm cards pass
 *  their own 30-minute expiry. */
export function defaultExpiry(action: WriteOp, now: Date = new Date()): Date {
  return new Date(now.getTime() + (action.action === 'adjust_budget' ? 72 : 7 * 24) * HOUR_MS);
}

const SHORT_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 symbols, no look-alikes (l, o, 0, 1)
/** 8 characters (40 bits): short enough for Telegram callback data, unique by the table's constraint. */
export function newShortId(): string {
  return Array.from(randomBytes(8), (b) => SHORT_ID_ALPHABET[b & 31]).join('');
}

export interface NewProposal {
  productId: string;
  cycleId?: string | null; // null for operator and policy proposals
  findingId?: string | null;
  origin: (typeof PROPOSAL_ORIGINS)[number];
  action: WriteOp;
  undo: WriteOp | null; // null only for irreversible actions
  revertsRevisionId?: string | null;
  preconditionHash: string | null;
  preconditionFields: string[];
  rationale: string;
  expectedEffect: string;
  expiresAt?: Date;
  requestId?: string | null;
}

/** Creates a pending proposal at version 1 (also recorded in proposal_versions). */
export async function createProposal(db: DbOrTx, input: NewProposal): Promise<ProposalRecord> {
  const action = WriteOp.parse(input.action);
  const undo = input.undo === null ? null : WriteOp.parse(input.undo);
  const actionHash = hashOf(action);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(proposals)
          .values({
            shortId: newShortId(),
            productId: input.productId,
            cycleId: input.cycleId ?? null,
            findingId: input.findingId ?? null,
            origin: input.origin,
            version: 1,
            action,
            actionHash,
            undo,
            revertsRevisionId: input.revertsRevisionId ?? null,
            preconditionHash: input.preconditionHash,
            preconditionFields: input.preconditionFields,
            rationale: input.rationale,
            expectedEffect: input.expectedEffect,
            expiresAt: input.expiresAt ?? defaultExpiry(action),
          })
          .returning();
        if (!row) throw new Error('insert into proposals returned nothing');
        await tx.insert(proposalVersions).values({
          proposalId: row.id,
          productId: row.productId,
          version: 1,
          action,
          actionHash,
          undo,
          preconditionHash: input.preconditionHash,
          requestId: input.requestId ?? null,
        });
        return toRecord(row);
      });
    } catch (error) {
      // A short-id collision (1 in 2^40 per pair) just retries with a new one.
      if (attempt < 3 && isUniqueViolation(error, 'proposals_short_id_unique')) continue;
      throw error;
    }
  }
}

export async function getProposal(db: DbOrTx, id: string): Promise<ProposalRecord> {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
  if (!row) throw new NotFoundError('proposal', id);
  return toRecord(row);
}

export async function findProposalByShortId(db: DbOrTx, shortId: string): Promise<ProposalRecord | null> {
  const [row] = await db.select().from(proposals).where(eq(proposals.shortId, shortId));
  return row ? toRecord(row) : null;
}

export async function listProposals(
  db: DbOrTx,
  productId: string,
  statuses?: ProposalStatus[],
): Promise<ProposalRecord[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.productId, productId), statuses?.length ? inArray(proposals.status, statuses) : undefined))
    .orderBy(desc(proposals.createdAt));
  return rows.map(toRecord);
}

export async function listProposalVersions(db: DbOrTx, proposalId: string) {
  return db
    .select()
    .from(proposalVersions)
    .where(eq(proposalVersions.proposalId, proposalId))
    .orderBy(asc(proposalVersions.version));
}

async function lockProposal(tx: DbOrTx, id: string): Promise<ProposalRow> {
  const [row] = await tx.select().from(proposals).where(eq(proposals.id, id)).for('update');
  if (!row) throw new NotFoundError('proposal', id);
  return row;
}

/** An edit: a new version of a pending proposal, based on `baseVersion` (a stale base throws). The old
 *  versions stay in proposal_versions. Any approval was bound to the old version, so it no longer applies. */
export async function newVersion(
  db: DbOrTx,
  input: {
    proposalId: string;
    baseVersion: number;
    action: WriteOp;
    undo: WriteOp | null;
    preconditionHash: string | null;
    preconditionFields?: string[];
    requestId?: string | null;
  },
): Promise<ProposalRecord> {
  const action = WriteOp.parse(input.action);
  const undo = input.undo === null ? null : WriteOp.parse(input.undo);
  const actionHash = hashOf(action);
  return db.transaction(async (tx) => {
    const current = await lockProposal(tx, input.proposalId);
    if (current.status !== 'pending') {
      throw new IllegalTransitionError(input.proposalId, current.status, 'pending');
    }
    if (current.version !== input.baseVersion) {
      throw new StaleVersionError('proposal', input.baseVersion, current.version);
    }
    const version = current.version + 1;
    const [row] = await tx
      .update(proposals)
      .set({
        version,
        action,
        actionHash,
        undo,
        preconditionHash: input.preconditionHash,
        ...(input.preconditionFields !== undefined ? { preconditionFields: input.preconditionFields } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(proposals.id, input.proposalId))
      .returning();
    if (!row) throw new NotFoundError('proposal', input.proposalId);
    await tx.insert(proposalVersions).values({
      proposalId: row.id,
      productId: row.productId,
      version,
      action,
      actionHash,
      undo,
      preconditionHash: input.preconditionHash,
      requestId: input.requestId ?? null,
    });
    return toRecord(row);
  });
}

/** Moves a proposal to `to`, if the §3.9 table allows it from its current status (and, when `from` is given,
 *  only if it is still in `from`). Entering `applying` sets idempotency_key = '<id>:<version>' and
 *  applying_since. Throws IllegalTransitionError otherwise. */
export async function transitionProposal(
  db: DbOrTx,
  input: { proposalId: string; to: ProposalStatus; from?: ProposalStatus; detail?: Record<string, unknown> | null },
): Promise<ProposalRecord> {
  return db.transaction(async (tx) => {
    const current = await lockProposal(tx, input.proposalId);
    if ((input.from !== undefined && current.status !== input.from) || !canTransition(current.status, input.to)) {
      throw new IllegalTransitionError(input.proposalId, current.status, input.to);
    }
    const [row] = await tx
      .update(proposals)
      .set({
        status: input.to,
        ...(input.detail !== undefined ? { statusDetail: input.detail } : {}),
        ...(input.to === 'applying'
          ? { idempotencyKey: `${current.id}:${current.version}`, applyingSince: sql`now()` }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(proposals.id, input.proposalId))
      .returning();
    if (!row) throw new NotFoundError('proposal', input.proposalId);
    return toRecord(row);
  });
}

/** Expires every pending or approved proposal whose expires_at has passed. Returns the expired ids. */
export async function expireDue(db: DbOrTx, now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .update(proposals)
    .set({ status: 'expired', updatedAt: sql`now()` })
    .where(and(inArray(proposals.status, ['pending', 'approved']), lte(proposals.expiresAt, now)))
    .returning({ id: proposals.id });
  return rows.map((r) => r.id);
}

/** Proposals left in `applying` (gateway recovery, BLUEPRINT §6). */
export async function listApplying(db: DbOrTx): Promise<ProposalRecord[]> {
  const rows = await db.select().from(proposals).where(eq(proposals.status, 'applying'));
  return rows.map(toRecord);
}

// ── Approvals ─────────────────────────────────────────────────────────────────────────────────

export type Approval = typeof approvals.$inferSelect;

export interface Decision {
  proposalId: string;
  version: number;
  actionHash: string; // what the approver saw; must equal the proposal's current action hash
  decision: 'approve' | 'reject';
  reason?: string | null; // required when rejecting
  actor: string;
  channel: (typeof APPROVAL_CHANNELS)[number];
  requestId?: string | null;
}

/** Records Marcus's decision on one version and moves the proposal to approved or rejected, in one transaction.
 *  One decision per version: repeating the same decision returns the stored one (double taps are harmless);
 *  a different decision on a decided version, a stale version or hash, or an expired or non-pending proposal
 *  is refused. */
export async function recordDecision(
  db: DbOrTx,
  input: Decision,
  now: Date = new Date(),
): Promise<{ approval: Approval; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    const proposal = await lockProposal(tx, input.proposalId);
    const [existing] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.proposalId, input.proposalId), eq(approvals.proposalVersion, input.version)));
    if (existing) {
      if (existing.decision === input.decision && existing.actionHash === input.actionHash) {
        return { approval: existing, duplicate: true };
      }
      throw new RefusedError(
        `proposal ${proposal.shortId} v${input.version} was already decided: ${existing.decision}`,
      );
    }
    if (proposal.version !== input.version) {
      throw new StaleVersionError('proposal', input.version, proposal.version);
    }
    if (proposal.status !== 'pending') {
      throw new RefusedError(`proposal ${proposal.shortId} is ${proposal.status}, not pending`);
    }
    if (proposal.expiresAt.getTime() <= now.getTime()) {
      throw new RefusedError(`proposal ${proposal.shortId} has expired`);
    }
    if (proposal.actionHash !== input.actionHash) {
      throw new RefusedError(`proposal ${proposal.shortId}: the action changed since it was shown`);
    }
    const reason = input.reason?.trim() ? input.reason.trim() : null;
    if (input.decision === 'reject' && reason === null) throw new RefusedError('a rejection needs a reason');
    const [approval] = await tx
      .insert(approvals)
      .values({
        productId: proposal.productId,
        proposalId: proposal.id,
        proposalVersion: input.version,
        actionHash: input.actionHash,
        decision: input.decision,
        reason,
        actor: input.actor,
        channel: input.channel,
        requestId: input.requestId ?? null,
      })
      .returning();
    if (!approval) throw new Error('insert into approvals returned nothing');
    await transitionProposal(tx, {
      proposalId: proposal.id,
      from: 'pending',
      to: input.decision === 'approve' ? 'approved' : 'rejected',
    });
    return { approval, duplicate: false };
  });
}

/** The decision on the proposal's CURRENT version, or null (the gateway's step 1 loads this itself). */
export async function getCurrentApproval(db: DbOrTx, proposalId: string): Promise<Approval | null> {
  const [row] = await db
    .select({ approval: approvals })
    .from(approvals)
    .innerJoin(proposals, and(eq(proposals.id, approvals.proposalId), eq(proposals.version, approvals.proposalVersion)))
    .where(eq(approvals.proposalId, proposalId));
  return row?.approval ?? null;
}
