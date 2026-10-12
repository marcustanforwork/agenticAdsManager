// Replay cases, v0 (M06b; M08 adds Marcus's decisions and the replay runner, M16a the model comparison). A case is
// the analyst's input (the prompt, with the run's random ids replaced by stable keys), the analyst's answer, and
// what core made of it. Replaying the answer against a fresh copy of the same fixture must give the same result:
// that is what the property case's test checks, so a change to the input builder or the validation shows up as a
// diff here.
import { AnalystOutput, type FindingTypeId } from '@ads/contracts';
import {
  type AnalysisResult,
  type AnalystInput,
  type ModelDeps,
  type ModelTracing,
  analyseStage,
  applyAnalystOutput,
  buildAnalystInput,
  detectStage,
} from '@ads/core';
import { type DbOrTx, getProduct } from '@ads/db';
import { createRegistry } from '@ads/pack-sdk';
import { pack as propertyPack } from '@ads/pack-property-sg';
import { PROPERTY_FIXTURE_ID, PROPERTY_FIXTURE_NOW, seedPropertyFixture } from './property/fixture.ts';

export const REPLAY_CASE_FORMAT = 'replay-case-v0';

export interface ReplayCase {
  format: typeof REPLAY_CASE_FORMAT;
  id: string;
  product: string;
  fixture: string;
  /** The run's clock (the fixture is built for it). */
  now: string;
  promptVersion: string;
  /** Where the answer came from: a model, or written by hand (recorded) when no model key was available. */
  answeredBy:
    | {
        source: 'model';
        model: string;
        attempts: number;
        usage: { inputTokens: number; outputTokens: number };
        costMicros: string;
      }
    | { source: 'recorded'; note: string };
  input: {
    estimatedTokens: number;
    withinCap: boolean;
    phases: AnalystInput['phases'];
    dropped: AnalystInput['data']['dropped'];
    candidates: { key: string; type: string; target: string; negativeText?: string }[];
    /** The trusted context and the DATA block, candidate ids replaced by their keys. */
    prompt: string;
  };
  /** The answer, candidate ids as keys. */
  analystOutput: AnalystOutput;
  /** What core made of it, finding ids as candidate keys (or `added`). */
  result: {
    confirmed: {
      candidate: string;
      type: string;
      target: string;
      confidence: string | null;
      passedThreshold: boolean;
    }[];
    dismissed: { candidate: string; type: string; target: string; reason: string }[];
    added: { type: string; target: string; confidence: string | null; passedThreshold: boolean }[];
    dropped: AnalysisResult['dropped'];
    unreviewed: number;
  };
  /** Marcus's rating of the findings (M08 records decisions; null until then). */
  expected: { useful: boolean; note: string; findings?: { type: FindingTypeId; target: string }[] } | null;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Swaps ids in a value (a JSON round trip; ids appear only as whole strings or inside text). */
function swapIds<T>(value: T, map: ReadonlyMap<string, string>): T {
  return JSON.parse(JSON.stringify(value).replace(UUID, (id) => map.get(id) ?? id)) as T;
}

export interface PropertyCaseOptions {
  id?: string;
  /** A hand-written answer, candidate ids as keys (`candidate-1`, …). */
  recorded?: { output: AnalystOutput; note: string };
  /** Otherwise the model: the environment's (`MODEL_ANALYST`, its key), or one supplied by a test. */
  env?: Readonly<Record<string, string | undefined>>;
  model?: ModelDeps['model'];
  tracing?: ModelTracing | null;
  /** Look-ups offered to the model (default: the fixture's settings, 20). Recorded answers use none. */
  lookups?: boolean;
}

/** Builds the property fixture in `db` (empty and migrated), runs the detectors and the analyst on it, and returns
 *  the replay case. */
export async function runPropertyCase(db: DbOrTx, opts: PropertyCaseOptions): Promise<ReplayCase> {
  const packs = createRegistry([propertyPack]);
  const fixture = await seedPropertyFixture(db);
  let product = await getProduct(db, fixture.productId);
  if (opts.recorded !== undefined || opts.lookups === false) {
    product = {
      ...product,
      settings: { ...product.settings, agent: { ...product.settings.agent, analystLookupBudget: 0 } },
    };
  }
  const now = () => PROPERTY_FIXTURE_NOW;
  await detectStage({ db, packs, now }, product, fixture.cycleId);
  const input = await buildAnalystInput(db, {
    product,
    pack: propertyPack,
    cycleId: fixture.cycleId,
    now: PROPERTY_FIXTURE_NOW,
    lookups: product.settings.agent.analystLookupBudget > 0,
  });
  const keys = new Map<string, string>(input.data.candidates.map((c, i) => [c.id, `candidate-${i + 1}`]));
  const ids = new Map<string, string>([...keys].map(([id, key]) => [key, id]));

  let output: AnalystOutput;
  let result: AnalysisResult;
  let answeredBy: ReplayCase['answeredBy'];
  if (opts.recorded !== undefined) {
    output = AnalystOutput.parse(opts.recorded.output);
    result = await applyAnalystOutput(
      { db, product, manifest: propertyPack.manifest, cycleId: fixture.cycleId, now: PROPERTY_FIXTURE_NOW },
      {
        findings: output.findings.map((f) => ({
          ...f,
          fromCandidateId: f.fromCandidateId === null ? null : (ids.get(f.fromCandidateId) ?? f.fromCandidateId),
        })),
        dismissed: output.dismissed.map((d) => ({ ...d, candidateId: ids.get(d.candidateId) ?? d.candidateId })),
      },
    );
    answeredBy = { source: 'recorded', note: opts.recorded.note };
  } else {
    const summary = await analyseStage(
      {
        db,
        env: opts.env ?? {},
        packs,
        now,
        ...(opts.tracing === undefined ? {} : { tracing: opts.tracing }),
        ...(opts.model === undefined ? {} : { model: opts.model }),
      },
      product,
      fixture.cycleId,
    );
    if (summary.status !== 'analysed' || summary.output === undefined || summary.result === undefined) {
      throw new Error(`the analyst run did not complete: ${summary.status} ${summary.detail ?? ''}`.trim());
    }
    output = swapIds(summary.output, keys);
    result = summary.result;
    answeredBy = {
      source: 'model',
      model: summary.model ?? '',
      attempts: summary.attempts ?? 0,
      usage: summary.usage ?? { inputTokens: 0, outputTokens: 0 },
      costMicros: summary.costMicros ?? '0',
    };
  }

  const keyOf = (id: string): string => keys.get(id) ?? id;
  return {
    format: REPLAY_CASE_FORMAT,
    id: opts.id ?? 'property-sg-0001',
    product: product.slug,
    fixture: PROPERTY_FIXTURE_ID,
    now: PROPERTY_FIXTURE_NOW.toISOString(),
    promptVersion: input.version,
    answeredBy,
    input: {
      estimatedTokens: input.estimatedTokens,
      withinCap: input.withinCap,
      phases: input.phases,
      dropped: input.data.dropped,
      candidates: input.data.candidates.map((c) => ({
        key: keyOf(c.id),
        type: c.type,
        target: c.target,
        ...(c.negativeText === undefined ? {} : { negativeText: c.negativeText }),
      })),
      prompt: swapIds(input.prompt, keys),
    },
    analystOutput: output,
    result: {
      confirmed: result.confirmed.map((f) => ({
        candidate: keyOf(f.findingId),
        type: f.type,
        target: f.target,
        confidence: f.confidence,
        passedThreshold: f.passedThreshold,
      })),
      dismissed: result.dismissed.map((f) => ({
        candidate: keyOf(f.findingId),
        type: f.type,
        target: f.target,
        reason: f.reason ?? '',
      })),
      added: result.added.map((f) => ({
        type: f.type,
        target: f.target,
        confidence: f.confidence,
        passedThreshold: f.passedThreshold,
      })),
      dropped: swapIds(result.dropped, keys),
      unreviewed: result.unreviewed,
    },
    expected: null,
  };
}
