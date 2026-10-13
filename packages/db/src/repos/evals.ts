// Eval data (M08): every decision Marcus makes on an agent proposal is kept as a replay case row.
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { analystRuns, evalCases, type DECISIONS } from '../schema.ts';

export type EvalCase = typeof evalCases.$inferSelect;

export interface NewEvalCase {
  productId: string;
  cycleId: string;
  findingId: string;
  proposalId: string;
  decision: (typeof DECISIONS)[number];
  reason: string | null;
  findingType: string;
  /** A ref, platform ids only. */
  target: string;
  /** A wasteful_search_term finding's term (several can share an ad group). */
  negativeText?: string | null;
}

/** Records a decision. Only a proposal's first decision counts; a later one (an edit's new version) is ignored. */
export async function recordEvalCase(db: DbOrTx, input: NewEvalCase): Promise<boolean> {
  const rows = await db
    .insert(evalCases)
    .values(input)
    .onConflictDoNothing({ target: evalCases.proposalId })
    .returning({ id: evalCases.id });
  return rows.length > 0;
}

/** The product's cases with their cycle's analyst record, oldest first. */
export async function listEvalCases(db: DbOrTx, productId: string) {
  return db
    .select({ evalCase: evalCases, analystRecord: analystRuns.record })
    .from(evalCases)
    .leftJoin(analystRuns, eq(analystRuns.cycleId, evalCases.cycleId))
    .where(eq(evalCases.productId, productId))
    .orderBy(asc(evalCases.createdAt));
}
