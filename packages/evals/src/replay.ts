// Replay, v0 (M08): Marcus's decisions as eval data. A decision case is one analyst run (its input and answer) with
// what Marcus made of the proposals that came from it: the findings he agreed with (approved) and the ones he
// rejected. Scoring compares an answer's findings with those decisions, per finding type:
//   - true positive: the answer has a finding Marcus approved;
//   - false positive: it has one he rejected;
//   - false negative: it lacks one he approved.
// Findings he never decided (no proposal, or still pending) count neither way. `ads eval replay` scores the answers
// recorded with each case; M16a re-asks a model with the stored inputs (`ads eval run --model X`).
import { AnalystOutput } from '@ads/contracts';
import { analystRefText } from '@ads/core';
import { type DbOrTx, listEvalCases } from '@ads/db';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const DECISION_CASE_FORMAT = 'replay-case-v1';

/** A finding by type and ref; a wasteful_search_term finding also by its term (several can share an ad group). */
const Judged = z.object({ type: z.string(), target: z.string(), term: z.string().optional() });

export const DecisionCase = z.object({
  format: z.literal(DECISION_CASE_FORMAT),
  id: z.string(),
  product: z.string(),
  /** Built from the decisions in the database, or written by hand (tests, M16a's seed set). */
  source: z.enum(['decisions', 'hand-written']),
  cycleId: z.string().nullable(),
  /** What the case is about, for a hand-written one. */
  note: z.string().optional(),
  promptVersion: z.string(),
  /** The analyst's input as it was sent (ids are that run's own); null for a hand-written case without one. */
  prompt: z.string().nullable(),
  /** The analyst's answer recorded with the case. */
  analystOutput: AnalystOutput,
  /** Findings Marcus approved a proposal for: an answer should have them. */
  expected: z.array(Judged),
  /** Findings Marcus rejected, with his reason: an answer should not have them. */
  rejected: z.array(Judged.extend({ reason: z.string().nullable() })),
});
export type DecisionCase = z.infer<typeof DecisionCase>;

export interface TypeScore {
  type: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** TP / (TP + FP), as a whole percent; null with nothing to judge. */
  precisionPct: number | null;
  /** TP / (TP + FN), as a whole percent; null with nothing to judge. */
  recallPct: number | null;
}

export interface ReplayReport {
  cases: number;
  /** Answer findings Marcus never decided on: not scored. */
  unjudged: number;
  byType: TypeScore[];
  overall: Omit<TypeScore, 'type'>;
}

const key = (f: { type: string; target: string; term?: string | undefined }): string =>
  JSON.stringify([f.type, f.target, f.term ?? null]);
const typeOfKey = (k: string): string => (JSON.parse(k) as [string])[0];
const pct = (part: number, whole: number): number | null => (whole === 0 ? null : Math.floor((part * 100) / whole));

/** The findings in an answer, as type and ref (confirmations and additions alike). */
export const answerFindings = (output: AnalystOutput): { type: string; target: string; term?: string }[] =>
  output.findings.map((f) => ({
    type: f.type,
    target: analystRefText(f.target),
    ...(f.params?.negativeText === undefined ? {} : { term: f.params.negativeText }),
  }));

/** Scores each case's answer against its decisions. `answerFor` replaces the recorded answer (M16a: a model's). */
export function scoreReplay(
  cases: readonly DecisionCase[],
  answerFor: (c: DecisionCase) => AnalystOutput = (c) => c.analystOutput,
): ReplayReport {
  const tally = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (type: string, field: 'tp' | 'fp' | 'fn') => {
    const t = tally.get(type) ?? { tp: 0, fp: 0, fn: 0 };
    t[field] += 1;
    tally.set(type, t);
  };
  let unjudged = 0;
  for (const c of cases) {
    const produced = new Set(answerFindings(answerFor(c)).map(key));
    const expected = new Set(c.expected.map(key));
    const rejected = new Set(c.rejected.map(key));
    for (const f of produced) {
      const type = typeOfKey(f);
      if (expected.has(f)) bump(type, 'tp');
      else if (rejected.has(f)) bump(type, 'fp');
      else unjudged += 1;
    }
    for (const f of expected) if (!produced.has(f)) bump(typeOfKey(f), 'fn');
  }
  const score = (t: { tp: number; fp: number; fn: number }): Omit<TypeScore, 'type'> => ({
    truePositives: t.tp,
    falsePositives: t.fp,
    falseNegatives: t.fn,
    precisionPct: pct(t.tp, t.tp + t.fp),
    recallPct: pct(t.tp, t.tp + t.fn),
  });
  const all = { tp: 0, fp: 0, fn: 0 };
  for (const t of tally.values()) {
    all.tp += t.tp;
    all.fp += t.fp;
    all.fn += t.fn;
  }
  return {
    cases: cases.length,
    unjudged,
    byType: [...tally.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, t]) => ({ type, ...score(t) })),
    overall: score(all),
  };
}

const judged = (c: { findingType: string; target: string; negativeText: string | null }) => ({
  type: c.findingType,
  target: c.target,
  ...(c.negativeText === null ? {} : { term: c.negativeText }),
});

/** The product's decision cases from the database: one per analysed cycle with at least one decision. A cycle
 *  without a stored analyst record (analysed before M08) is skipped. */
export async function decisionCasesFromDb(db: DbOrTx, product: { id: string; slug: string }): Promise<DecisionCase[]> {
  const rows = await listEvalCases(db, product.id);
  const byCycle = new Map<string, typeof rows>();
  for (const row of rows) byCycle.set(row.evalCase.cycleId, [...(byCycle.get(row.evalCase.cycleId) ?? []), row]);
  const cases: DecisionCase[] = [];
  for (const [cycleId, group] of byCycle) {
    const record = z
      .object({ promptVersion: z.string(), prompt: z.string(), output: AnalystOutput })
      .safeParse(group[0]?.analystRecord);
    if (!record.success) continue;
    cases.push({
      format: DECISION_CASE_FORMAT,
      id: `${product.slug}:${cycleId}`,
      product: product.slug,
      source: 'decisions',
      cycleId,
      promptVersion: record.data.promptVersion,
      prompt: record.data.prompt,
      analystOutput: record.data.output,
      expected: group.filter((r) => r.evalCase.decision === 'approve').map((r) => judged(r.evalCase)),
      rejected: group
        .filter((r) => r.evalCase.decision === 'reject')
        .map((r) => ({ ...judged(r.evalCase), reason: r.evalCase.reason })),
    });
  }
  return cases;
}

/** The hand-written cases in a directory (`*.json`), in name order. */
export async function loadDecisionCases(dir: string): Promise<DecisionCase[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (n) => DecisionCase.parse(JSON.parse(await readFile(join(dir, n), 'utf8')) as unknown)),
  );
}

/** Where the repository keeps the hand-written decision cases (a checkout only: the package ships `dist`). */
export const DECISION_CASES_DIR = fileURLToPath(new URL('../cases/decisions/', import.meta.url));
