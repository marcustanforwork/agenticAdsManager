// The cycle (BLUEPRINT §5.6, M04): one run of the agent for a product. Its stages are functions run in order;
// `stage_reached` advances after each one, so an interrupted cycle resumes where it stopped. Every stage is
// idempotent, a scheduled cycle is unique per (product, kind, date), and a named advisory lock keeps two
// processes from running the same cycle at once. M04 has the first two stages: sync and trust check; M06a adds
// detect, M06b analyse. The later ones (draft, report) join the STAGES list in M08 and M07.
import { localDate } from '@ads/contracts';
import {
  CYCLE_STAGE_ORDER,
  InvalidSettingsError,
  type Cycle,
  type CycleKind,
  type CycleStage,
  DuplicateCycleError,
  type Product,
  type ProductStatus,
  advance,
  findScheduledCycle,
  findUnfinishedManualCycle,
  finish,
  getCycle,
  getProduct,
  getStoredSettings,
  listUnfinishedCycles,
  startManual,
  startScheduled,
  tryAdvisoryLock,
} from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { type AnalyseSummary, analyseStage } from '../analyst/analyse.ts';
import { type AttributionRunSummary, attributeOutcomes } from '../attribution/attribute.ts';
import { type DetectSummary, detectStage } from '../findings/stage.ts';
import type { ModelDeps } from '../model/generate.ts';
import type { ModelTracing } from '../model/tracing.ts';
import { type OutcomeReadSummary, syncOutcomes } from '../outcomes/sync.ts';
import { alertInvalidSettings, assertSettingsUsable } from '../settings/settings.ts';
import { type SyncDeps, type SyncStageResult, syncStage } from '../sync/stage.ts';
import { type CheckResult, type TrustResult, trustStage } from './trust.ts';

export interface CycleDeps extends SyncDeps {
  /** The installed packs: the sync reads each product's outcomes through its pack (M05a), and settings are
   *  checked against the pack's guard layer. Without it no outcomes are read, and `outcome_source_fresh` fails. */
  packs?: PackRegistry;
  /** What the packs' adapters read their connection settings from (the worker's environment). */
  env?: Readonly<Record<string, string | undefined>>;
  /** The direct (unpooled) connection string: a run holds its cycle's lock on a connection of its own. */
  lockUrl: string;
  /** Called after a stage is recorded. Tests use it to stop a run at a chosen point. */
  onStage?: (stage: CycleStage, cycle: Cycle) => void | Promise<void>;
  /** The stages to run (default STAGES). Tests add later stages to check that a failed trust check skips them. */
  stages?: readonly StageStep[];
  /** Langfuse tracing for the model calls (the worker creates it once per process; none = untraced). */
  tracing?: ModelTracing | null;
  /** Tests supply the analyst's model instead of building one from the environment. */
  model?: ModelDeps['model'];
}

export interface CycleSummary {
  product: string;
  cycleId: string | null;
  kind: CycleKind | null;
  cycleDate: string | null;
  /** finished: every stage ran (or a failed trust check stopped it); stopped: `until` was reached and stages
   *  remain (resumable); already_finished: nothing to do; busy: another process is running it; skipped: the
   *  product isn't active; blocked: the stored settings are invalid (an alert is queued, nothing ran). */
  outcome: 'finished' | 'stopped' | 'already_finished' | 'busy' | 'skipped' | 'blocked';
  /** Set when this run continued an interrupted cycle: the stage it had reached. */
  resumedFrom?: CycleStage;
  stageReached: CycleStage | null;
  trustResult: TrustResult | null;
  detail?: string;
  sync?: SyncStageResult;
  /** The read of the product's outcomes, in the sync stage (M05a). */
  outcomes?: OutcomeReadSummary;
  /** Outcomes credited to campaigns after the sync (M05b). */
  attribution?: AttributionRunSummary;
  trust?: {
    result: TrustResult;
    checks: { account: string | null; check: string; result: CheckResult; detail: unknown }[];
  };
  /** The detectors' candidate findings (M06a). */
  detected?: DetectSummary;
  /** The analyst's review of them (M06b). */
  analysed?: AnalyseSummary;
}

export interface StageContext {
  deps: CycleDeps;
  product: Product;
  cycle: Cycle;
  summary: CycleSummary;
}

export interface StageStep {
  stage: CycleStage;
  kinds: readonly CycleKind[];
  /** Runs the stage. It may return the cycle's trust result (the trust stage does). */
  run(ctx: StageContext): Promise<{ trustResult?: TrustResult }>;
}

const ALL_KINDS: readonly CycleKind[] = ['daily', 'weekly', 'manual'];

/** The stages, in order. A stage that already ran in an interrupted cycle is skipped on resume. */
export const STAGES: readonly StageStep[] = [
  {
    stage: 'synced',
    kinds: ALL_KINDS,
    async run({ deps, product, cycle, summary }) {
      // A resumed sync skips the accounts this cycle already synced before it was interrupted.
      summary.sync = await syncStage(deps, product, { syncedSince: cycle.startedAt });
      if (deps.packs !== undefined) {
        summary.outcomes = await syncOutcomes(
          { db: deps.db, packs: deps.packs, env: deps.env ?? {}, now: deps.now },
          product,
          { readSince: cycle.startedAt },
        );
      }
      // After both reads: the entities and click ids just synced are what outcomes are matched against.
      summary.attribution = await attributeOutcomes(deps.db, { productId: product.id, now: deps.now() });
      return {};
    },
  },
  {
    stage: 'trust_checked',
    kinds: ALL_KINDS,
    async run({ deps, product, cycle, summary }) {
      const { result, checks } = await trustStage(deps.db, { product, cycleId: cycle.id, now: deps.now() });
      summary.trust = {
        result,
        checks: checks.map((c) => ({
          account:
            typeof c.detail === 'object' && c.detail !== null && 'account' in c.detail
              ? String(c.detail.account)
              : null,
          check: c.checkId,
          result: c.result,
          detail: c.detail,
        })),
      };
      return { trustResult: result };
    },
  },
  {
    stage: 'detected',
    kinds: ALL_KINDS,
    async run({ deps, product, cycle, summary }) {
      summary.detected = await detectStage(
        { db: deps.db, now: deps.now, ...(deps.packs === undefined ? {} : { packs: deps.packs }) },
        product,
        cycle.id,
      );
      return {};
    },
  },
  {
    stage: 'analysed',
    kinds: ALL_KINDS,
    async run({ deps, product, cycle, summary }) {
      const analysed = await analyseStage(
        {
          db: deps.db,
          env: deps.env ?? {},
          now: deps.now,
          ...(deps.packs === undefined ? {} : { packs: deps.packs }),
          ...(deps.tracing === undefined ? {} : { tracing: deps.tracing }),
          ...(deps.model === undefined ? {} : { model: deps.model }),
        },
        product,
        cycle.id,
      );
      summary.analysed = withoutModelText(analysed);
      return {};
    },
  },
];

/** The analysis for the printed summary: ids, types, refs and core's own words only. The model's answer and its
 *  free text (dismissal reasons, the targets it named) may quote entity names; `ads findings` shows them. */
function withoutModelText(analysed: AnalyseSummary): AnalyseSummary {
  const { output: _answer, result, ...rest } = analysed;
  if (result === undefined) return rest;
  return {
    ...rest,
    result: {
      ...result,
      dismissed: result.dismissed.map(({ reason: _reason, ...d }) => d),
      dropped: result.dropped.map(({ target: _target, ...d }) => ({
        ...d,
        target: '(not shown: written by the model)',
      })),
    },
  };
}

const order = (stage: CycleStage): number => CYCLE_STAGE_ORDER.indexOf(stage);

/** After a failed trust check only the diagnostic report may run (M07 adds the `reported` stage). */
const allowedAfterFail = (stage: CycleStage): boolean => stage === 'reported';

function summaryOf(product: { slug: string }, cycle: Cycle | null, outcome: CycleSummary['outcome']): CycleSummary {
  return {
    product: product.slug,
    cycleId: cycle?.id ?? null,
    kind: cycle?.kind ?? null,
    cycleDate: cycle?.cycleDate ?? null,
    outcome,
    stageReached: cycle?.stageReached ?? null,
    trustResult: cycle?.trustResult ?? null,
  };
}

/** Loads a cycle's product. Stored settings that fail validation are never used (BLUEPRINT M05a): for an active
 *  product an alert is queued, and the caller returns a `blocked` summary instead of running anything. A product
 *  that isn't active is reported as such (it wouldn't run anyway), without an alert. */
async function loadProduct(
  deps: CycleDeps,
  productId: string,
): Promise<Product | InvalidSettingsError | { slug: string; status: ProductStatus }> {
  try {
    const product = await getProduct(deps.db, productId);
    assertSettingsUsable(product, deps.packs);
    return product;
  } catch (error) {
    if (!(error instanceof InvalidSettingsError)) throw error;
    const { slug, status } = await getStoredSettings(deps.db, productId);
    if (status !== 'active') return { slug, status };
    await alertInvalidSettings(deps.db, error);
    return error;
  }
}

function blockedSummary(error: InvalidSettingsError, kind: CycleKind, cycle: Cycle | null): CycleSummary {
  return {
    product: error.slug,
    cycleId: cycle?.id ?? null,
    kind,
    cycleDate: cycle?.cycleDate ?? null,
    outcome: 'blocked',
    stageReached: cycle?.stageReached ?? null,
    trustResult: cycle?.trustResult ?? null,
    detail: `the stored settings are invalid, so nothing ran (fix them with ads settings set): ${error.issues.join('; ')}`,
  };
}

/** Starts today's cycle of `kind` for the product (in its timezone), or continues it if it was interrupted.
 *  A daily or weekly cycle that already finished today is not run again. */
export async function runCycle(
  deps: CycleDeps,
  input: { productId: string; kind: CycleKind; until?: CycleStage },
): Promise<CycleSummary> {
  const { db } = deps;
  const product = await loadProduct(deps, input.productId);
  if (product instanceof InvalidSettingsError) return blockedSummary(product, input.kind, null);
  if (!('settings' in product) || product.status !== 'active') {
    return { ...summaryOf(product, null, 'skipped'), kind: input.kind, detail: `product is ${product.status}` };
  }
  const cycleDate = localDate(deps.now(), product.timezone);
  let cycle: Cycle;
  // Cycles are dated and timed on the worker's clock, like `last_synced_at`, which a resumed sync compares with.
  const startedAt = deps.now();
  if (input.kind === 'manual') {
    // A manual run stopped with --until today is continued, not left behind for recovery.
    cycle =
      (await findUnfinishedManualCycle(db, { productId: product.id, cycleDate })) ??
      (await startManual(db, { productId: product.id, cycleDate, startedAt }));
  } else {
    try {
      cycle = await startScheduled(db, { productId: product.id, kind: input.kind, cycleDate, startedAt });
    } catch (error) {
      if (!(error instanceof DuplicateCycleError)) throw error;
      const existing = await findScheduledCycle(db, { productId: product.id, kind: input.kind, cycleDate });
      if (existing === null) throw error;
      cycle = existing;
    }
  }
  return continueCycle(deps, product, cycle, input.until);
}

/** Runs an existing cycle's remaining stages (resume). */
export async function resumeCycle(deps: CycleDeps, cycleId: string, until?: CycleStage): Promise<CycleSummary> {
  const cycle = await getCycle(deps.db, cycleId);
  const product = await loadProduct(deps, cycle.productId);
  if (product instanceof InvalidSettingsError) return blockedSummary(product, cycle.kind, cycle);
  // A product that isn't active: close its unfinished cycle (its settings, valid or not, aren't needed for that).
  if (cycle.finishedAt === null && product.status !== 'active') {
    const lock = await tryAdvisoryLock(deps.lockUrl, `cycle:${cycle.id}`, { applicationName: 'ads-cycle' });
    if (lock === null) return { ...summaryOf(product, cycle, 'busy'), detail: 'another process is running this cycle' };
    try {
      const done = await finish(deps.db, cycle.id, { error: `abandoned: product is ${product.status}` });
      return { ...summaryOf(product, done, 'skipped'), detail: `product is ${product.status}` };
    } finally {
      await lock.release();
    }
  }
  if (!('settings' in product)) return summaryOf(product, cycle, 'already_finished');
  return continueCycle(deps, product, cycle, until);
}

async function continueCycle(
  deps: CycleDeps,
  product: Product,
  start: Cycle,
  until: CycleStage | undefined,
): Promise<CycleSummary> {
  const { db } = deps;
  if (start.finishedAt !== null) return summaryOf(product, start, 'already_finished');
  const lock = await tryAdvisoryLock(deps.lockUrl, `cycle:${start.id}`, { applicationName: 'ads-cycle' });
  if (lock === null) return { ...summaryOf(product, start, 'busy'), detail: 'another process is running this cycle' };
  try {
    // Re-read under the lock: another run may have advanced or finished it meanwhile.
    let cycle = await getCycle(db, start.id);
    if (cycle.finishedAt !== null) return summaryOf(product, cycle, 'already_finished');
    const summary = summaryOf(product, cycle, 'finished');
    if (cycle.stageReached !== 'started') summary.resumedFrom = cycle.stageReached;

    const kind = cycle.kind;
    const pending = (): StageStep[] =>
      (deps.stages ?? STAGES).filter(
        (s) =>
          s.kinds.includes(kind) &&
          order(s.stage) > order(cycle.stageReached) &&
          (cycle.trustResult !== 'fail' || allowedAfterFail(s.stage)),
      );
    let stopped = false;
    for (let next = pending()[0]; next !== undefined; next = pending()[0]) {
      // Checked before each stage, so a rerun with the same --until doesn't go past it either.
      if (until !== undefined && order(cycle.stageReached) >= order(until)) {
        stopped = true;
        break;
      }
      const out = await next.run({ deps, product, cycle, summary });
      cycle = await advance(
        db,
        cycle.id,
        next.stage,
        out.trustResult === undefined ? {} : { trustResult: out.trustResult },
      );
      await deps.onStage?.(next.stage, cycle);
    }
    if (!stopped) cycle = await finish(db, cycle.id);
    return {
      ...summary,
      outcome: stopped ? 'stopped' : 'finished',
      stageReached: cycle.stageReached,
      trustResult: cycle.trustResult ?? null,
    };
  } finally {
    await lock.release();
  }
}

export interface ResumeSummary {
  resumed: CycleSummary[];
  abandoned: string[];
  errors: { cycleId: string; error: string }[];
}

/** Worker startup (BLUEPRINT §5.5): resume every unfinished daily and weekly cycle from `stage_reached`. One
 *  unfinished for more than `maxAgeHours` (default 24) is closed as abandoned instead (the next scheduled cycle
 *  covers its days); manual ones are only closed that way. */
export async function resumeUnfinishedCycles(
  deps: CycleDeps,
  opts: { maxAgeHours?: number } = {},
): Promise<ResumeSummary> {
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 3_600_000;
  const out: ResumeSummary = { resumed: [], abandoned: [], errors: [] };
  for (const cycle of await listUnfinishedCycles(deps.db)) {
    try {
      if (deps.now().getTime() - cycle.startedAt.getTime() > maxAgeMs) {
        const lock = await tryAdvisoryLock(deps.lockUrl, `cycle:${cycle.id}`, { applicationName: 'ads-cycle' });
        if (lock === null) continue; // still running somewhere
        try {
          await finish(deps.db, cycle.id, {
            error: `abandoned: unfinished for more than ${opts.maxAgeHours ?? 24} hours`,
          });
          out.abandoned.push(cycle.id);
        } finally {
          await lock.release();
        }
        continue;
      }
      // Manual cycles are Marcus's own runs: an unfinished one waits for his next `ads cycle --kind manual` (or
      // closes as abandoned above), so stages he stopped with --until never run unasked.
      if (cycle.kind === 'manual') continue;
      out.resumed.push(await resumeCycle(deps, cycle.id));
    } catch (error) {
      out.errors.push({ cycleId: cycle.id, error: (error as Error).message });
    }
  }
  return out;
}
