// The cycle (BLUEPRINT §5.6, M04): one run of the agent for a product. Its stages are functions run in order;
// `stage_reached` advances after each one, so an interrupted cycle resumes where it stopped. Every stage is
// idempotent, a scheduled cycle is unique per (product, kind, date), and a named advisory lock keeps two
// processes from running the same cycle at once. M04 has the first two stages: sync and trust check. The later
// ones (detect, analyse, draft, report) join the STAGES list in M06a, M06b, M08 and M07.
import { localDate } from '@ads/contracts';
import {
  CYCLE_STAGE_ORDER,
  type Cycle,
  type CycleKind,
  type CycleStage,
  DuplicateCycleError,
  type Product,
  advance,
  findScheduledCycle,
  finish,
  getCycle,
  getProduct,
  listUnfinishedCycles,
  startManual,
  startScheduled,
  tryAdvisoryLock,
} from '@ads/db';
import { type SyncDeps, type SyncStageResult, syncStage } from '../sync/stage.ts';
import { type CheckResult, type TrustResult, trustStage } from './trust.ts';

export interface CycleDeps extends SyncDeps {
  /** The direct (unpooled) connection string: a run holds its cycle's lock on a connection of its own. */
  lockUrl: string;
  /** Called after a stage is recorded. Tests use it to stop a run at a chosen point. */
  onStage?: (stage: CycleStage, cycle: Cycle) => void | Promise<void>;
  /** The stages to run (default STAGES). Tests add later stages to check that a failed trust check skips them. */
  stages?: readonly StageStep[];
}

export interface CycleSummary {
  product: string;
  cycleId: string | null;
  kind: CycleKind | null;
  cycleDate: string | null;
  /** finished: every stage ran (or a failed trust check stopped it); stopped: `until` was reached and stages
   *  remain (resumable); already_finished: nothing to do; busy: another process is running it; skipped: the
   *  product isn't active. */
  outcome: 'finished' | 'stopped' | 'already_finished' | 'busy' | 'skipped';
  /** Set when this run continued an interrupted cycle: the stage it had reached. */
  resumedFrom?: CycleStage;
  stageReached: CycleStage | null;
  trustResult: TrustResult | null;
  detail?: string;
  sync?: SyncStageResult;
  trust?: {
    result: TrustResult;
    checks: { account: string | null; check: string; result: CheckResult; detail: unknown }[];
  };
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
];

const order = (stage: CycleStage): number => CYCLE_STAGE_ORDER.indexOf(stage);

/** After a failed trust check only the diagnostic report may run (M07 adds the `reported` stage). */
const allowedAfterFail = (stage: CycleStage): boolean => stage === 'reported';

function summaryOf(product: Product, cycle: Cycle | null, outcome: CycleSummary['outcome']): CycleSummary {
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

/** Starts today's cycle of `kind` for the product (in its timezone), or continues it if it was interrupted.
 *  A daily or weekly cycle that already finished today is not run again. */
export async function runCycle(
  deps: CycleDeps,
  input: { productId: string; kind: CycleKind; until?: CycleStage },
): Promise<CycleSummary> {
  const { db } = deps;
  const product = await getProduct(db, input.productId);
  if (product.status !== 'active') {
    return { ...summaryOf(product, null, 'skipped'), kind: input.kind, detail: `product is ${product.status}` };
  }
  const cycleDate = localDate(deps.now(), product.timezone);
  let cycle: Cycle;
  if (input.kind === 'manual') cycle = await startManual(db, { productId: product.id, cycleDate });
  else {
    try {
      cycle = await startScheduled(db, { productId: product.id, kind: input.kind, cycleDate });
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
  const product = await getProduct(deps.db, cycle.productId);
  if (cycle.finishedAt === null && product.status !== 'active') {
    const done = await finish(deps.db, cycle.id, { error: `abandoned: product is ${product.status}` });
    return { ...summaryOf(product, done, 'skipped'), detail: `product is ${product.status}` };
  }
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
      const out = await next.run({ deps, product, cycle, summary });
      cycle = await advance(
        db,
        cycle.id,
        next.stage,
        out.trustResult === undefined ? {} : { trustResult: out.trustResult },
      );
      await deps.onStage?.(next.stage, cycle);
      if (until !== undefined && order(next.stage) >= order(until) && pending().length > 0) {
        stopped = true;
        break;
      }
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

/** Worker startup (BLUEPRINT §5.5): resume every unfinished cycle from `stage_reached`. One unfinished for more
 *  than `maxAgeHours` (default 24) is closed as abandoned instead: the next scheduled cycle covers its days. */
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
      out.resumed.push(await resumeCycle(deps, cycle.id));
    } catch (error) {
      out.errors.push({ cycleId: cycle.id, error: (error as Error).message });
    }
  }
  return out;
}
