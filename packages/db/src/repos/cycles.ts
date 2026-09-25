// Cycles (one run of the agent for a product), their trust checks, and findings.
import type { ComputedEvidence, WriteOp } from '@ads/contracts';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { DuplicateCycleError, NotFoundError, RefusedError, isUniqueViolation } from '../errors.ts';
import {
  CYCLE_STAGES,
  cycles,
  findings,
  trustChecks,
  type CYCLE_KINDS,
  type FINDING_SOURCES,
  type ANALYST_VERDICTS,
  type TRUST_CHECK_RESULTS,
  type TRUST_RESULTS,
} from '../schema.ts';

export type Cycle = typeof cycles.$inferSelect;
export type CycleKind = (typeof CYCLE_KINDS)[number];
export type CycleStage = (typeof CYCLE_STAGES)[number];

/** Starts a daily or weekly cycle. A second one for the same product, kind and date throws DuplicateCycleError
 *  (the unique index cycles_one_scheduled_per_day decides, so two replicas can't both start one). */
export async function startScheduled(
  db: DbOrTx,
  input: { productId: string; kind: Exclude<CycleKind, 'manual'>; cycleDate: string },
): Promise<Cycle> {
  try {
    // A savepoint, so a refused insert doesn't abort a caller's surrounding transaction.
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(cycles).values(input).returning();
      if (!row) throw new Error('insert into cycles returned nothing');
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'cycles_one_scheduled_per_day')) {
      throw new DuplicateCycleError(input.productId, input.kind, input.cycleDate);
    }
    throw error;
  }
}

/** Manual cycles have no per-day limit. */
export async function startManual(db: DbOrTx, input: { productId: string; cycleDate: string }): Promise<Cycle> {
  const [row] = await db
    .insert(cycles)
    .values({ ...input, kind: 'manual' })
    .returning();
  if (!row) throw new Error('insert into cycles returned nothing');
  return row;
}

export async function getCycle(db: DbOrTx, id: string): Promise<Cycle> {
  const [row] = await db.select().from(cycles).where(eq(cycles.id, id));
  if (!row) throw new NotFoundError('cycle', id);
  return row;
}

/** Records that a cycle reached `stage`. Stages only move forward; re-recording the current stage is a no-op
 *  (resume, BLUEPRINT §5.6). Going backwards, or advancing a finished cycle, throws RefusedError. */
export async function advance(
  db: DbOrTx,
  id: string,
  stage: CycleStage,
  extra: { trustResult?: (typeof TRUST_RESULTS)[number]; addModelCostMicros?: bigint; addLookups?: number } = {},
): Promise<Cycle> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(cycles).where(eq(cycles.id, id)).for('update');
    if (!current) throw new NotFoundError('cycle', id);
    if (current.finishedAt !== null) throw new RefusedError(`cycle ${id} is finished`);
    if (CYCLE_STAGES.indexOf(stage) < CYCLE_STAGES.indexOf(current.stageReached)) {
      throw new RefusedError(`cycle ${id}: cannot go back from ${current.stageReached} to ${stage}`);
    }
    const [row] = await tx
      .update(cycles)
      .set({
        stageReached: stage,
        ...(extra.trustResult !== undefined ? { trustResult: extra.trustResult } : {}),
        modelCostMicros: sql`${cycles.modelCostMicros} + ${extra.addModelCostMicros ?? 0n}`,
        lookups: sql`${cycles.lookups} + ${extra.addLookups ?? 0}`,
      })
      .where(eq(cycles.id, id))
      .returning();
    if (!row) throw new NotFoundError('cycle', id);
    return row;
  });
}

/** Finishes a cycle: stage `done` on success, or the stage it reached plus the error. Finishing twice throws. */
export async function finish(db: DbOrTx, id: string, outcome: { error?: string } = {}): Promise<Cycle> {
  const [row] = await db
    .update(cycles)
    .set({
      finishedAt: sql`now()`,
      error: outcome.error ?? null,
      ...(outcome.error === undefined ? { stageReached: 'done' as const } : {}),
    })
    .where(and(eq(cycles.id, id), isNull(cycles.finishedAt)))
    .returning();
  if (!row) {
    await getCycle(db, id); // throws NotFoundError if it doesn't exist
    throw new RefusedError(`cycle ${id} is already finished`);
  }
  return row;
}

/** Cycles that started but never finished, oldest first (worker startup reconciliation, BLUEPRINT §5.5). */
export async function listUnfinishedCycles(db: DbOrTx): Promise<Cycle[]> {
  return db.select().from(cycles).where(isNull(cycles.finishedAt)).orderBy(asc(cycles.startedAt));
}

export async function listCycles(db: DbOrTx, productId: string, limit = 20): Promise<Cycle[]> {
  return db.select().from(cycles).where(eq(cycles.productId, productId)).orderBy(desc(cycles.startedAt)).limit(limit);
}

// ── Trust checks ──────────────────────────────────────────────────────────────────────────────

export type TrustCheck = typeof trustChecks.$inferSelect;

export async function recordTrustCheck(
  db: DbOrTx,
  input: {
    productId: string;
    cycleId: string;
    accountId?: string | null;
    checkId: string;
    result: (typeof TRUST_CHECK_RESULTS)[number];
    detail?: Record<string, unknown>;
  },
): Promise<TrustCheck> {
  const [row] = await db
    .insert(trustChecks)
    .values({ ...input, accountId: input.accountId ?? null, detail: input.detail ?? {} })
    .returning();
  if (!row) throw new Error('insert into trust_checks returned nothing');
  return row;
}

export async function listTrustChecks(db: DbOrTx, cycleId: string): Promise<TrustCheck[]> {
  return db.select().from(trustChecks).where(eq(trustChecks.cycleId, cycleId)).orderBy(asc(trustChecks.checkedAt));
}

// ── Findings ──────────────────────────────────────────────────────────────────────────────────

export type Finding = typeof findings.$inferSelect;

export interface NewFinding {
  productId: string;
  cycleId: string;
  type: string;
  source: (typeof FINDING_SOURCES)[number];
  targetEntityId: string;
  analystVerdict?: (typeof ANALYST_VERDICTS)[number] | null;
  dismissedReason?: string | null;
  summary: string;
  whyNow?: string | null;
  evidence: ComputedEvidence; // from the DB, never from the AI (invariant 4)
  evidenceRefs?: string[];
  params?: Record<string, unknown> | null;
  confidence?: string | null;
  passedThreshold: boolean;
  proposedAction?: WriteOp | null;
}

export async function insertFinding(db: DbOrTx, input: NewFinding): Promise<Finding> {
  const [row] = await db
    .insert(findings)
    .values({ ...input, evidenceRefs: input.evidenceRefs ?? [] })
    .returning();
  if (!row) throw new Error('insert into findings returned nothing');
  return row;
}

export async function setAnalystVerdict(
  db: DbOrTx,
  id: string,
  verdict: (typeof ANALYST_VERDICTS)[number],
  dismissedReason: string | null = null,
): Promise<void> {
  const rows = await db
    .update(findings)
    .set({ analystVerdict: verdict, dismissedReason })
    .where(eq(findings.id, id))
    .returning({ id: findings.id });
  if (rows.length === 0) throw new NotFoundError('finding', id);
}

export async function listFindings(db: DbOrTx, cycleId: string): Promise<Finding[]> {
  return db.select().from(findings).where(eq(findings.cycleId, cycleId)).orderBy(asc(findings.createdAt));
}
