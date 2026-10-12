// The analyse stage (BLUEPRINT M06b Build 3): the analyst model returns an `AnalystOutput`; core validates every
// finding (the target exists and belongs to the product, the type is allowed for it, a negative keyword equals a
// real search term), computes the evidence from SQL, applies the pack's threshold, and writes `findings` rows with
// verdicts. Nothing the model writes decides a number (invariant 4): its summary and reasons are text for Marcus,
// its confidence is capped by decision memory, and its budget hint is dropped until budgets are built (M14).
import {
  AnalystOutput,
  type AnalystFinding,
  type ComputedEvidence,
  type FindingTypeId,
  type PackManifest,
  type ProductPack,
} from '@ads/contracts';
import {
  type Account,
  type DbOrTx,
  type Finding,
  type Product,
  confirmFinding,
  insertFinding,
  listAccounts,
  listEntities,
  listFindings,
  listRejectedFindings,
  resetAnalysis,
  setAnalystVerdict,
  sumSearchTerms,
} from '@ads/db';
import { type PackRegistry, thresholdFor } from '@ads/pack-sdk';
import { DETECTORS } from '../findings/detectors.ts';
import {
  type FindingTarget,
  computeEvidence,
  judgeEvidence,
  searchTermEvidence,
  targetKind,
  windowEndingYesterday,
} from '../findings/evidence.ts';
import { FINDING_TYPES, allowsTarget, evidenceWindowDays } from '../findings/registry.ts';
import { type ModelDeps, generateStructured } from '../model/generate.ts';
import type { ModelTracing } from '../model/tracing.ts';
import { type AnalystInput, buildAnalystInput } from './input.ts';
import { LookupBudget, analystLookupTools } from './lookups.ts';
import { analystRefText, findingRefText, targetRefText } from './refs.ts';
import { resolveTargetRef } from './targets.ts';

/** Rejections of one type for one target after which the analyst's finding is kept only at `low` confidence. */
export const MEMORY_CAP_REJECTIONS = 3;
/** What a finding the analyst adds must show in its computed evidence besides the pack's threshold: the direction
 *  of its type's rule (no KPI outcome, no impression). Only these types may be added. The others are decided by
 *  state the evidence doesn't hold (a trust check, the month's pace, the weekly cost ratio): their detectors raise
 *  them, and the analyst confirms or dismisses. The Phase 3 and 4 types (a budget change, a copy refresh) aren't in
 *  use until their milestones (M14, M15b). */
export const ANALYST_RULES: Partial<Record<FindingTypeId, (evidence: ComputedEvidence, kpiStage: string) => boolean>> =
  {
    zero_outcome_spend: (e, kpi) => BigInt(e.spendMicros) > 0n && e.clicks > 0 && (e.outcomesByStage[kpi] ?? 0) === 0,
    wasteful_search_term: (e, kpi) => BigInt(e.spendMicros) > 0n && e.clicks > 0 && (e.outcomesByStage[kpi] ?? 0) === 0,
    no_delivery: (e) => e.impressions === 0,
  };
const DETECTED_TYPES: ReadonlySet<string> = new Set(DETECTORS.map((d) => d.type));

export interface ReviewedFinding {
  findingId: string;
  type: string;
  target: string;
  verdict: 'confirmed' | 'dismissed' | 'added';
  passedThreshold: boolean;
  confidence: string | null;
  /** Set when decision memory lowered the analyst's confidence. */
  memoryCapped?: true;
  reason?: string;
}

export interface DroppedFinding {
  type: string;
  /** What the analyst named (its own words: data). */
  target: string;
  fromCandidateId: string | null;
  reason: string;
}

export interface AnalysisResult {
  confirmed: ReviewedFinding[];
  dismissed: ReviewedFinding[];
  added: ReviewedFinding[];
  dropped: DroppedFinding[];
  /** Candidates the analyst neither confirmed nor dismissed. */
  unreviewed: number;
}

const targetKey = (target: FindingTarget): string =>
  target.kind === 'entity' ? `e:${target.entity.id}` : target.kind === 'account' ? `a:${target.account.id}` : 'p';

const findingTargetKey = (f: Pick<Finding, 'targetEntityId' | 'targetAccountId'>): string =>
  f.targetEntityId !== null ? `e:${f.targetEntityId}` : f.targetAccountId !== null ? `a:${f.targetAccountId}` : 'p';

const negativeTextOf = (params: unknown): string | null => {
  const text = (params as { negativeText?: unknown } | null)?.negativeText;
  return typeof text === 'string' ? text : null;
};

interface ApplyContext {
  db: DbOrTx;
  product: Product;
  manifest: PackManifest;
  cycleId: string;
  now: Date;
}

/** Evidence for a finding the analyst added: the type's window ending yesterday; a search term's own sums. */
async function evidenceForNew(
  ctx: ApplyContext,
  type: FindingTypeId,
  target: FindingTarget,
  negativeText: string | null,
): Promise<ComputedEvidence> {
  const threshold = thresholdFor(ctx.manifest, type);
  const window = windowEndingYesterday(ctx.now, ctx.product.timezone, evidenceWindowDays(type, threshold));
  const base = await computeEvidence(ctx.db, {
    productId: ctx.product.id,
    timeZone: ctx.product.timezone,
    target,
    window,
  });
  if (negativeText === null || target.kind !== 'entity') return base;
  const [term] = (
    await sumSearchTerms(ctx.db, { productId: ctx.product.id, ...window, adGroupEntityId: target.entity.id })
  ).filter((t) => t.term === negativeText);
  return term === undefined ? base : searchTermEvidence(base, term, ctx.product.settings.outcomes.primaryKpiStage);
}

/** Whether `text` is, exactly, a search term of the ad group over the type's window. */
async function isRealSearchTerm(ctx: ApplyContext, type: FindingTypeId, adGroupId: string, text: string) {
  const window = windowEndingYesterday(
    ctx.now,
    ctx.product.timezone,
    evidenceWindowDays(type, thresholdFor(ctx.manifest, type)),
  );
  const terms = await sumSearchTerms(ctx.db, { productId: ctx.product.id, ...window, adGroupEntityId: adGroupId });
  return terms.some((t) => t.term === text);
}

/** Validates the analyst's output and writes it: verdicts on the detector findings, the analyst's own findings with
 *  computed evidence and the threshold's verdict. A rerun replaces the previous analysis of the cycle. */
export async function applyAnalystOutput(ctx: ApplyContext, output: AnalystOutput): Promise<AnalysisResult> {
  const { db, product, cycleId } = ctx;
  await resetAnalysis(db, cycleId);
  const accountsById = new Map<string, Account>((await listAccounts(db, product.id)).map((a) => [a.id, a]));
  const entitiesById = new Map((await listEntities(db, product.id)).map((e) => [e.id, e] as const));
  const labelOf = (f: Pick<Finding, 'targetEntityId' | 'targetAccountId'>): string =>
    findingRefText(f, entitiesById, accountsById);

  const candidates = new Map(
    (await listFindings(db, cycleId)).filter((f) => f.source === 'detector').map((f) => [f.id, f] as const),
  );
  const rejections = new Map<string, number>();
  for (const r of await listRejectedFindings(db, product.id)) {
    const key = `${r.findingType}|${findingTargetKey(r)}`;
    rejections.set(key, (rejections.get(key) ?? 0) + 1);
  }

  const result: AnalysisResult = { confirmed: [], dismissed: [], added: [], dropped: [], unreviewed: 0 };
  const reviewed = new Set<string>();
  const addedKeys = new Set<string>();
  const drop = (f: AnalystFinding, reason: string): void => {
    result.dropped.push({
      type: f.type,
      target: analystRefText(f.target),
      fromCandidateId: f.fromCandidateId,
      reason,
    });
  };

  for (const f of output.findings) {
    const target = await resolveTargetRef(db, product.id, f.target);
    if (target === null) {
      drop(f, 'the target does not exist in this product');
      continue;
    }
    if (!allowsTarget(f.type, targetKind(target))) {
      drop(f, `a ${f.type} finding cannot be about ${targetKind(target)}`);
      continue;
    }
    const spec = FINDING_TYPES[f.type];
    const key = targetKey(target);

    // Parameters: a negative keyword only where the type takes one, and only a real search term; no budget hint
    // before budgets are built (M14).
    let negativeText: string | null = null;
    if (spec.requiredParams.includes('negativeText')) {
      negativeText = f.params?.negativeText ?? null;
      if (negativeText === null) {
        drop(f, 'a negative keyword finding needs the search term');
        continue;
      }
      if (target.kind !== 'entity' || !(await isRealSearchTerm(ctx, f.type, target.entity.id, negativeText))) {
        drop(f, 'the negative keyword text is not a search term of this ad group');
        continue;
      }
    }
    const params =
      negativeText === null ? null : { negativeText, negativeMatchType: f.params?.negativeMatchType ?? 'EXACT' };

    // The candidate it confirms: the one named, or a candidate with the same type, target and term.
    let candidate: Finding | undefined;
    if (f.fromCandidateId !== null) {
      candidate = candidates.get(f.fromCandidateId);
      if (candidate === undefined) {
        drop(f, 'no candidate of this cycle has that id');
        continue;
      }
      if (candidate.type !== f.type || findingTargetKey(candidate) !== key) {
        drop(f, 'the type or target differs from the candidate it confirms');
        continue;
      }
      if (negativeText !== null && negativeTextOf(candidate.params) !== negativeText) {
        drop(f, 'the search term differs from the candidate it confirms');
        continue;
      }
    } else {
      candidate = [...candidates.values()].find(
        (c) => c.type === f.type && findingTargetKey(c) === key && negativeTextOf(c.params) === (negativeText ?? null),
      );
    }
    if (candidate !== undefined && reviewed.has(candidate.id)) {
      drop(f, 'the candidate was already reviewed');
      continue;
    }

    const capped = (rejections.get(`${f.type}|${key}`) ?? 0) >= MEMORY_CAP_REJECTIONS;
    const confidence = capped ? 'low' : f.confidence;
    const label = targetRefText(target, accountsById);

    if (candidate !== undefined) {
      reviewed.add(candidate.id);
      await confirmFinding(db, candidate.id, {
        whyNow: f.whyNow,
        confidence,
        evidenceRefs: f.evidenceRefs,
        params: params ?? (candidate.params as Record<string, unknown> | null),
      });
      result.confirmed.push({
        findingId: candidate.id,
        type: f.type,
        target: label,
        verdict: 'confirmed',
        passedThreshold: candidate.passedThreshold,
        confidence,
        ...(capped ? { memoryCapped: true as const } : {}),
      });
      continue;
    }

    const rule = ANALYST_RULES[f.type];
    if (rule === undefined) {
      drop(
        f,
        DETECTED_TYPES.has(f.type)
          ? `${f.type} findings come from their detector only`
          : `${f.type} findings are not in use yet`,
      );
      continue;
    }
    const addedKey = `${f.type}|${key}|${negativeText ?? ''}`;
    if (addedKeys.has(addedKey)) {
      drop(f, 'a duplicate of another finding in this answer');
      continue;
    }
    addedKeys.add(addedKey);
    const evidence = await evidenceForNew(ctx, f.type, target, negativeText);
    const passed =
      judgeEvidence(evidence, thresholdFor(ctx.manifest, f.type)).met &&
      rule(evidence, product.settings.outcomes.primaryKpiStage);
    const row = await insertFinding(db, {
      productId: product.id,
      cycleId,
      type: f.type,
      source: 'analyst',
      targetEntityId: target.kind === 'entity' ? target.entity.id : null,
      targetAccountId: target.kind === 'account' ? target.account.id : null,
      analystVerdict: 'added',
      summary: f.summary,
      whyNow: f.whyNow,
      evidence,
      evidenceRefs: f.evidenceRefs,
      params,
      confidence,
      passedThreshold: passed,
    });
    result.added.push({
      findingId: row.id,
      type: f.type,
      target: label,
      verdict: 'added',
      passedThreshold: passed,
      confidence,
      ...(capped ? { memoryCapped: true as const } : {}),
    });
  }

  for (const d of output.dismissed) {
    const candidate = candidates.get(d.candidateId);
    if (candidate === undefined || reviewed.has(candidate.id)) continue; // unknown, or confirmed above
    reviewed.add(candidate.id);
    await setAnalystVerdict(db, candidate.id, 'dismissed', d.reason);
    result.dismissed.push({
      findingId: candidate.id,
      type: candidate.type,
      target: labelOf(candidate),
      verdict: 'dismissed',
      passedThreshold: candidate.passedThreshold,
      confidence: null,
      reason: d.reason,
    });
  }
  result.unreviewed = [...candidates.keys()].filter((id) => !reviewed.has(id)).length;
  return result;
}

export interface AnalyseDeps {
  db: DbOrTx;
  env: Readonly<Record<string, string | undefined>>;
  packs?: PackRegistry;
  now: () => Date;
  tracing?: ModelTracing | null;
  /** Tests and evals supply the model instead of building one from the environment. */
  model?: ModelDeps['model'];
}

export interface AnalyseSummary {
  status: 'analysed' | 'failed' | 'skipped';
  detail?: string;
  model?: string;
  attempts?: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** USD micros (a decimal string). */
  costMicros?: string;
  input?: Pick<AnalystInput, 'version' | 'estimatedTokens' | 'withinCap' | 'phases'> & {
    dropped: AnalystInput['data']['dropped'];
  };
  lookups?: { budget: number; used: number; refused: number };
  /** The model's answer as it came (schema-checked, not yet validated): kept for replay cases. */
  output?: AnalystOutput;
  result?: AnalysisResult;
}

export async function analyseStage(deps: AnalyseDeps, product: Product, cycleId: string): Promise<AnalyseSummary> {
  if (deps.packs === undefined || !deps.packs.has(product.packId)) {
    return { status: 'skipped', detail: `the pack ${product.packId} is not installed, so there are no thresholds` };
  }
  const pack: ProductPack = deps.packs.get(product.packId);
  const now = deps.now();
  const budget = new LookupBudget(product.settings.agent.analystLookupBudget);
  const lookups = budget.limit > 0;
  const input = await buildAnalystInput(deps.db, { product, pack, cycleId, now, lookups });
  const inputSummary = {
    version: input.version,
    estimatedTokens: input.estimatedTokens,
    withinCap: input.withinCap,
    phases: input.phases,
    dropped: input.data.dropped,
  };
  if (input.data.candidates.length === 0 && input.data.metrics.rows.length === 0) {
    await resetAnalysis(deps.db, cycleId);
    return {
      status: 'skipped',
      detail: 'no candidates and no metrics in the window: nothing to analyse',
      input: inputSummary,
    };
  }
  const lookupSummary = () => ({
    budget: budget.limit,
    used: budget.used,
    refused: budget.calls.filter((c) => !c.ok).length,
  });
  try {
    const answer = await generateStructured(
      {
        env: deps.env,
        db: deps.db,
        ...(deps.tracing === undefined ? {} : { tracing: deps.tracing }),
        ...(deps.model === undefined ? {} : { model: deps.model }),
      },
      {
        context: { product: { id: product.id, slug: product.slug }, cycleId, stage: 'analyst' },
        schema: AnalystOutput,
        name: 'analyse',
        instructions: input.instructions,
        prompt: input.prompt,
        ...(lookups
          ? {
              tools: {
                set: analystLookupTools({ db: deps.db, product, budget }),
                maxSteps: budget.limit + 2,
                exhausted: () => budget.exhausted,
              },
            }
          : {}),
      },
    );
    const result = await applyAnalystOutput(
      { db: deps.db, product, manifest: pack.manifest, cycleId, now },
      answer.output,
    );
    return {
      status: 'analysed',
      model: answer.model,
      attempts: answer.attempts,
      usage: answer.usage,
      costMicros: answer.costMicros.toString(),
      input: inputSummary,
      lookups: lookupSummary(),
      output: answer.output,
      result,
    };
  } catch (error) {
    // The cycle goes on: the brief still reports the detector candidates, marked unreviewed.
    await resetAnalysis(deps.db, cycleId);
    return {
      status: 'failed',
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      input: inputSummary,
      lookups: lookupSummary(),
    };
  }
}
