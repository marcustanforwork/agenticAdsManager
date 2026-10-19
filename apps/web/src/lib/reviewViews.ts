// What each review screen reads (M10b), one loader per screen. Each takes the database, so tests run them under the
// dashboard's role against a fixture database; the pages pass `db()`. Settings come from the validated product
// view: a product whose stored settings are broken shows the numbers without its ceilings and stages.
import { ComputedEvidence, type WriteOp, daysFrom, localDate, minusDays, targetRefOf } from '@ads/contracts';
import {
  type Account,
  type Brief,
  type Change,
  type DbOrTx,
  type DecisionView,
  type DocVersion,
  type DriftView,
  type ProposalRecord,
  agreeRateCounts,
  attributionByStage,
  entitiesByRef,
  entityRefKey,
  findingsById,
  listAccounts,
  listBriefs,
  listChanges,
  listCycleHistory,
  listDecisions,
  listDriftEvents,
  listProductDocVersions,
  listProposals,
  outcomesByDay,
  spendByDay,
  sumModelCost,
} from '@ads/db';
import {
  type MonthProjection,
  type StageSummary,
  type EntityLookup,
  type TrendRow,
  kpiTrend,
  projectMonth,
  summariseStages,
} from './review.ts';
import type { ProductView } from './views.ts';

/** The days the trend and the outcome counts cover: four weeks. */
export const TREND_DAYS = 28;
/** The Phase 1 gate's window (PROPOSAL §12): three weeks. */
export const AGREE_WINDOW_DAYS = 21;
/** The AI cost panel's window. */
export const AI_COST_DAYS = 30;

type Names = Map<string, { name: string; status: string }>;
/** The synced entities for `describeAction`. */
export const entityLookup =
  (names: Names): EntityLookup =>
  (ref) =>
    names.get(entityRefKey(ref)) ?? null;

async function namesFor(db: DbOrTx, productId: string, ops: (WriteOp | null)[]): Promise<Names> {
  const refs = ops.flatMap((op) => {
    const ref = op === null ? null : targetRefOf(op);
    return ref === null ? [] : [ref];
  });
  return entitiesByRef(db, productId, refs);
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────

export interface OverviewData {
  /** Yesterday in the product's timezone: the last full day. */
  day: string;
  spend: {
    dayMicros: bigint;
    dailyCeilingMicros: bigint | null;
    monthMicros: bigint;
    monthlyCeilingMicros: bigint | null;
    projection: MonthProjection;
  };
  kpi: { stage: string; label: string };
  trend: { weeks: TrendRow[]; days: TrendRow[] };
  /** Outcomes over the trend's days, by stage, with attribution. */
  stages: StageSummary[];
  accounts: Account[];
}

export async function loadOverview(db: DbOrTx, product: ProductView, now: Date): Promise<OverviewData> {
  const tz = product.timezone;
  const day = minusDays(localDate(now, tz), 1);
  const month = day.slice(0, 7);
  const from = minusDays(day, TREND_DAYS - 1);
  const monthStart = `${month}-01`;
  const productId = product.id;
  // One spend query covers the trend and the month to date, whichever starts first.
  const [spend, outcomes, attribution, accounts] = await Promise.all([
    spendByDay(db, { productId, from: daysFrom(monthStart, from) > 0 ? monthStart : from, to: day }),
    outcomesByDay(db, { productId, from, to: day, timeZone: tz }),
    attributionByStage(db, { productId, from, to: day, timeZone: tz }),
    listAccounts(db, productId),
  ]);
  const s = product.settings;
  const ceiling = (json: string | null | undefined): bigint | null => (json == null ? null : BigInt(json));
  const stages = s?.outcomes.stages ?? [];
  const kpiStage = s?.outcomes.primaryKpiStage ?? '';
  const dayMicros = spend.find((x) => x.day === day)?.spendMicros ?? 0n;
  const monthMicros = spend.filter((x) => x.day >= monthStart).reduce((n, x) => n + x.spendMicros, 0n);
  return {
    day,
    spend: {
      dayMicros,
      dailyCeilingMicros: ceiling(s?.spend.dailyCeilingMicros),
      monthMicros,
      monthlyCeilingMicros: ceiling(s?.spend.monthlyCeilingMicros),
      projection: projectMonth(monthMicros, day),
    },
    kpi: { stage: kpiStage, label: stages.find((x) => x.id === kpiStage)?.label ?? kpiStage },
    trend: kpiTrend({ spend, outcomes, kpiStage, lastDay: day, weeks: TREND_DAYS / 7 }),
    stages: summariseStages(attribution, stages, kpiStage),
    accounts,
  };
}

// ── Proposals ─────────────────────────────────────────────────────────────────────────────────

export interface ProposalItem {
  proposal: ProposalRecord;
  /** The finding it came from (agent proposals): its type, and its evidence when it reads as evidence. */
  finding: { type: string; evidence: ComputedEvidence | null } | null;
  /** Still open: pending and before its expiry. Only these can be decided. */
  open: boolean;
}

export interface ProposalsData {
  /** Pending proposals, newest first (one past its expiry shows as expired until the worker sweeps it). */
  pending: ProposalItem[];
  /** Approved and waiting to be made by hand (Phase 1 applies nothing). */
  approved: ProposalItem[];
  decisions: DecisionView[];
  names: Names;
  /** The Phase 1 gate's numbers over its window (PROPOSAL §12): agent proposals only. */
  agree: { days: number; total: number; approved: number; rejected: number; expired: number; pending: number };
}

export async function loadProposals(db: DbOrTx, product: ProductView, now: Date): Promise<ProposalsData> {
  const [pending, approved, decisions, agree] = await Promise.all([
    listProposals(db, product.id, ['pending']),
    listProposals(db, product.id, ['approved']),
    listDecisions(db, product.id),
    agreeRateCounts(db, {
      productId: product.id,
      from: new Date(now.getTime() - AGREE_WINDOW_DAYS * 86_400_000),
      to: now,
    }),
  ]);
  const found = await findingsById(
    db,
    [...pending, ...approved].flatMap((p) => (p.findingId === null ? [] : [p.findingId])),
  );
  const item = (proposal: ProposalRecord): ProposalItem => {
    const f = proposal.findingId === null ? undefined : found.get(proposal.findingId);
    const evidence = f === undefined ? null : ComputedEvidence.safeParse(f.evidence);
    return {
      proposal,
      finding: f === undefined ? null : { type: f.type, evidence: evidence?.success === true ? evidence.data : null },
      open: proposal.status === 'pending' && proposal.expiresAt.getTime() > now.getTime(),
    };
  };
  const ops = [...pending, ...approved].map((p) => p.action);
  for (const d of decisions) ops.push(d.action as WriteOp);
  return {
    pending: pending.map(item),
    approved: approved.map(item),
    decisions,
    names: await namesFor(db, product.id, ops),
    agree: { days: AGREE_WINDOW_DAYS, ...agree },
  };
}

// ── Changes ───────────────────────────────────────────────────────────────────────────────────

export async function loadChanges(db: DbOrTx, product: ProductView): Promise<{ changes: Change[]; names: Names }> {
  const changes = await listChanges(db, product.id, 100);
  return {
    changes,
    names: await namesFor(
      db,
      product.id,
      changes.map((c) => c.action),
    ),
  };
}

// ── Checks: trust, drift, AI cost ─────────────────────────────────────────────────────────────

export interface ChecksData {
  cycles: Awaited<ReturnType<typeof listCycleHistory>>;
  accounts: Map<string, Account>;
  drift: DriftView[];
  aiCost: { days: number; costMicros: bigint; cycles: number };
}

export async function loadChecks(db: DbOrTx, product: ProductView, now: Date): Promise<ChecksData> {
  const [cycles, accounts, drift, cost] = await Promise.all([
    listCycleHistory(db, product.id),
    listAccounts(db, product.id),
    listDriftEvents(db, product.id),
    sumModelCost(db, { productId: product.id, since: new Date(now.getTime() - AI_COST_DAYS * 86_400_000) }),
  ]);
  return {
    cycles,
    accounts: new Map(accounts.map((a) => [a.id, a])),
    drift,
    aiCost: { days: AI_COST_DAYS, ...cost },
  };
}

// ── Briefs ────────────────────────────────────────────────────────────────────────────────────

export async function loadBriefs(db: DbOrTx, product: ProductView): Promise<Brief[]> {
  return listBriefs(db, product.id, 12);
}

// ── Product documents ─────────────────────────────────────────────────────────────────────────

export const DOCS = ['strategy', 'playbook', 'learnings'] as const;
export type DocKind = (typeof DOCS)[number];
export const isDoc = (v: string): v is DocKind => (DOCS as readonly string[]).includes(v);

export async function loadDoc(
  db: DbOrTx,
  product: ProductView,
  doc: DocKind,
): Promise<{ doc: DocKind; versions: DocVersion[] }> {
  return { doc, versions: await listProductDocVersions(db, { productId: product.id, doc }) };
}
