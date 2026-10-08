// Cycles (one run of the agent for a product), their trust checks, and findings.
import { ComputedEvidence, type WriteOp } from '@ads/contracts';
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
/** The stages in order: started → synced → trust_checked → detected → analysed → drafted → reported → done. */
export const CYCLE_STAGE_ORDER: readonly CycleStage[] = CYCLE_STAGES;

/** Starts a daily or weekly cycle. A second one for the same product, kind and date throws DuplicateCycleError
 *  (the unique index cycles_one_scheduled_per_day decides, so two replicas can't both start one). */
export async function startScheduled(
  db: DbOrTx,
  input: { productId: string; kind: Exclude<CycleKind, 'manual'>; cycleDate: string; startedAt?: Date },
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

/** The daily or weekly cycle of a product for a date, if one was started (at most one, by the unique index). */
export async function findScheduledCycle(
  db: DbOrTx,
  input: { productId: string; kind: Exclude<CycleKind, 'manual'>; cycleDate: string },
): Promise<Cycle | null> {
  const [row] = await db
    .select()
    .from(cycles)
    .where(
      and(eq(cycles.productId, input.productId), eq(cycles.kind, input.kind), eq(cycles.cycleDate, input.cycleDate)),
    );
  return row ?? null;
}

/** The latest unfinished manual cycle of a product for a date, if any (a manual run stopped with `--until`). */
export async function findUnfinishedManualCycle(
  db: DbOrTx,
  input: { productId: string; cycleDate: string },
): Promise<Cycle | null> {
  const [row] = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.productId, input.productId),
        eq(cycles.kind, 'manual'),
        eq(cycles.cycleDate, input.cycleDate),
        isNull(cycles.finishedAt),
      ),
    )
    .orderBy(desc(cycles.startedAt))
    .limit(1);
  return row ?? null;
}

/** Manual cycles have no per-day limit. `startedAt` defaults to the database's time. */
export async function startManual(
  db: DbOrTx,
  input: { productId: string; cycleDate: string; startedAt?: Date },
): Promise<Cycle> {
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

/** Adds a model call's cost (USD micros, D-078) to the cycle's running total, atomically: calls may run in parallel. */
export async function addModelCost(db: DbOrTx, cycleId: string, costMicros: bigint): Promise<void> {
  if (costMicros < 0n) throw new RangeError('a model cost cannot be negative');
  const rows = await db
    .update(cycles)
    .set({ modelCostMicros: sql`${cycles.modelCostMicros} + ${costMicros.toString()}::bigint` })
    .where(eq(cycles.id, cycleId))
    .returning({ id: cycles.id });
  if (rows.length === 0) throw new NotFoundError('cycle', cycleId);
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

/** Replaces all of a cycle's trust checks in one transaction, so a re-run trust stage (resume) never leaves
 *  duplicates or a half-written set. */
export async function replaceTrustChecks(
  db: DbOrTx,
  input: {
    productId: string;
    cycleId: string;
    checks: {
      accountId: string | null;
      checkId: string;
      result: (typeof TRUST_CHECK_RESULTS)[number];
      detail: Record<string, unknown>;
    }[];
  },
): Promise<TrustCheck[]> {
  return db.transaction(async (tx) => {
    await tx.delete(trustChecks).where(eq(trustChecks.cycleId, input.cycleId));
    if (input.checks.length === 0) return [];
    return tx
      .insert(trustChecks)
      .values(input.checks.map((c) => ({ ...c, productId: input.productId, cycleId: input.cycleId })))
      .returning();
  });
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
  /** The target (D-079): an ad entity, else an ad account, else (both null) the whole product. */
  targetEntityId: string | null;
  targetAccountId?: string | null;
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

const findingRow = (input: NewFinding) => ({
  ...input,
  evidence: ComputedEvidence.parse(input.evidence), // checked on write: evidence is computed, never free-form
  evidenceRefs: input.evidenceRefs ?? [],
});

export async function insertFinding(db: DbOrTx, input: NewFinding): Promise<Finding> {
  const [row] = await db.insert(findings).values(findingRow(input)).returning();
  if (!row) throw new Error('insert into findings returned nothing');
  return row;
}

/** Stores a cycle's detector candidates, replacing any from an interrupted run of the same stage (idempotent). */
export async function replaceDetectorFindings(
  db: DbOrTx,
  input: { productId: string; cycleId: string; findings: Omit<NewFinding, 'productId' | 'cycleId' | 'source'>[] },
): Promise<Finding[]> {
  return db.transaction(async (tx) => {
    await tx.delete(findings).where(and(eq(findings.cycleId, input.cycleId), eq(findings.source, 'detector')));
    if (input.findings.length === 0) return [];
    return tx
      .insert(findings)
      .values(
        input.findings.map((f) =>
          findingRow({ ...f, productId: input.productId, cycleId: input.cycleId, source: 'detector' }),
        ),
      )
      .returning();
  });
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

/** Undoes a cycle's analysis, so a rerun of the analyse stage starts clean (idempotent): the analyst's own findings
 *  go, and the detector findings lose their verdicts. */
export async function resetAnalysis(db: DbOrTx, cycleId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(findings).where(and(eq(findings.cycleId, cycleId), eq(findings.source, 'analyst')));
    await tx
      .update(findings)
      .set({ analystVerdict: null, dismissedReason: null, whyNow: null, confidence: null, evidenceRefs: [] })
      .where(and(eq(findings.cycleId, cycleId), eq(findings.source, 'detector')));
  });
}

/** The analyst confirmed a detector finding: its explanation goes with it; the evidence stays the computed one. */
export async function confirmFinding(
  db: DbOrTx,
  id: string,
  input: { whyNow: string; confidence: string; evidenceRefs: string[]; params: Record<string, unknown> | null },
): Promise<void> {
  const rows = await db
    .update(findings)
    .set({ analystVerdict: 'confirmed', dismissedReason: null, ...input })
    .where(eq(findings.id, id))
    .returning({ id: findings.id });
  if (rows.length === 0) throw new NotFoundError('finding', id);
}

export async function listFindings(db: DbOrTx, cycleId: string): Promise<Finding[]> {
  return db.select().from(findings).where(eq(findings.cycleId, cycleId)).orderBy(asc(findings.createdAt));
}
