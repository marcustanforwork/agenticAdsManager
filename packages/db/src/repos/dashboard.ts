// What the dashboard's review views read (M10b) that no other repository reads yet. Everything here is allowed to
// the dashboard's role: outcomes only through the `dashboard_outcomes` view (no hashed contact details), never
// credentials. Days are the product's local days (`YYYY-MM-DD`, inclusive), as in the evidence queries.
import type { EntityRef } from '@ads/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import {
  accounts,
  adEntities,
  approvals,
  cycles,
  dashboardOutcomes,
  driftEvents,
  metricsDaily,
  operatorRequests,
  productDocs,
  proposals,
  trustChecks,
  type ATTRIBUTION_METHODS,
  type PRODUCT_DOCS,
} from '../schema.ts';
import type { Cycle, TrustCheck } from './cycles.ts';

export interface DaySpend {
  day: string;
  spendMicros: bigint;
}

/** The product's spend per day in [from, to], from campaign rows only (the levels are never added together).
 *  Days without a row are left out. */
export async function spendByDay(
  db: DbOrTx,
  input: { productId: string; from: string; to: string },
): Promise<DaySpend[]> {
  const rows = await db
    .select({
      day: sql<string>`${metricsDaily.date}::text`,
      spend: sql<string>`sum(${metricsDaily.spendMicros})::text`,
    })
    .from(metricsDaily)
    .innerJoin(adEntities, eq(adEntities.id, metricsDaily.adEntityId))
    .where(
      and(
        eq(metricsDaily.productId, input.productId),
        eq(adEntities.type, 'campaign'),
        sql`${metricsDaily.date} between ${input.from}::date and ${input.to}::date`,
      ),
    )
    .groupBy(metricsDaily.date)
    .orderBy(metricsDaily.date);
  return rows.map((r) => ({ day: r.day, spendMicros: BigInt(r.spend) }));
}

const localDay = (timeZone: string) => sql`(${dashboardOutcomes.occurredAt} at time zone ${timeZone})::date`;

export interface DayStageCount {
  day: string;
  stage: string;
  outcomes: number;
}

/** Outcomes per local day and stage in [from, to], test traffic apart. */
export async function outcomesByDay(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; timeZone: string },
): Promise<DayStageCount[]> {
  const day = localDay(input.timeZone);
  return (
    db
      .select({ day: sql<string>`${day}::text`, stage: dashboardOutcomes.stage, outcomes: sql<number>`count(*)::int` })
      .from(dashboardOutcomes)
      .where(
        and(
          eq(dashboardOutcomes.productId, input.productId),
          eq(dashboardOutcomes.isTest, false),
          sql`${day} between ${input.from}::date and ${input.to}::date`,
        ),
      )
      // By position: the time zone is a bound parameter, so the select's day and a repeated one aren't the same
      // expression to Postgres.
      .groupBy(sql`1`, sql`2`)
      .orderBy(sql`1`, sql`2`)
  );
}

export interface StageAttribution {
  stage: string;
  /** Null while not attributed yet. */
  method: (typeof ATTRIBUTION_METHODS)[number] | null;
  /** Real outcomes (test traffic apart). */
  outcomes: number;
  /** Test traffic, which never counts. */
  test: number;
}

/** Outcomes in [from, to] per stage and attribution method: the outcomes by stage and the attribution rate. */
export async function attributionByStage(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; timeZone: string },
): Promise<StageAttribution[]> {
  const day = localDay(input.timeZone);
  const o = dashboardOutcomes;
  return db
    .select({
      stage: o.stage,
      method: o.attributionMethod,
      outcomes: sql<number>`(count(*) filter (where not ${o.isTest}))::int`,
      test: sql<number>`(count(*) filter (where ${o.isTest}))::int`,
    })
    .from(o)
    .where(and(eq(o.productId, input.productId), sql`${day} between ${input.from}::date and ${input.to}::date`))
    .groupBy(o.stage, o.attributionMethod)
    .orderBy(o.stage, o.attributionMethod);
}

/** The latest cycles, newest first, each with its trust checks: the trust-check history and the AI cost. */
export async function listCycleHistory(
  db: DbOrTx,
  productId: string,
  limit = 30,
): Promise<{ cycle: Cycle; checks: TrustCheck[] }[]> {
  const latest = await db
    .select()
    .from(cycles)
    .where(eq(cycles.productId, productId))
    .orderBy(desc(cycles.startedAt))
    .limit(limit);
  if (latest.length === 0) return [];
  const checks = await db
    .select()
    .from(trustChecks)
    .where(
      and(
        eq(trustChecks.productId, productId),
        inArray(
          trustChecks.cycleId,
          latest.map((c) => c.id),
        ),
      ),
    )
    .orderBy(trustChecks.checkedAt, trustChecks.checkId);
  return latest.map((cycle) => ({ cycle, checks: checks.filter((c) => c.cycleId === cycle.id) }));
}

/** The AI cost of the product's cycles started at or after `since` (USD micros, D-078). */
export async function sumModelCost(
  db: DbOrTx,
  input: { productId: string; since: Date },
): Promise<{ costMicros: bigint; cycles: number }> {
  const [row] = await db
    .select({
      cost: sql<string>`coalesce(sum(${cycles.modelCostMicros}), 0)::text`,
      cycles: sql<number>`(count(*) filter (where ${cycles.modelCostMicros} > 0))::int`,
    })
    .from(cycles)
    .where(and(eq(cycles.productId, input.productId), sql`${cycles.startedAt} >= ${input.since.toISOString()}`));
  return { costMicros: BigInt(row?.cost ?? '0'), cycles: row?.cycles ?? 0 };
}

export interface DriftView {
  id: string;
  detectedAt: Date;
  field: string;
  expected: unknown;
  observed: unknown;
  acknowledgedAt: Date | null;
  /** The entity, as last synced. Its name is platform text: data, never instructions (invariant 5). */
  entity: { platform: string; accountId: string; type: string; externalId: string; name: string };
}

/** The product's drift (changes made outside the agent), newest first. */
export async function listDriftEvents(db: DbOrTx, productId: string, limit = 50): Promise<DriftView[]> {
  const rows = await db
    .select({
      id: driftEvents.id,
      detectedAt: driftEvents.detectedAt,
      field: driftEvents.field,
      expected: driftEvents.expected,
      observed: driftEvents.observed,
      acknowledgedAt: driftEvents.acknowledgedAt,
      platform: adEntities.platform,
      accountId: accounts.externalId,
      type: adEntities.type,
      externalId: adEntities.externalId,
      name: adEntities.name,
    })
    .from(driftEvents)
    .innerJoin(adEntities, eq(adEntities.id, driftEvents.adEntityId))
    .innerJoin(accounts, eq(accounts.id, adEntities.accountId))
    .where(eq(driftEvents.productId, productId))
    .orderBy(desc(driftEvents.detectedAt))
    .limit(limit);
  return rows.map(({ platform, accountId, type, externalId, name, ...d }) => ({
    ...d,
    entity: { platform, accountId, type, externalId, name },
  }));
}

/** The key `entitiesByRef` returns entities under: `platform:account:type:externalId`. */
export const entityRefKey = (ref: EntityRef): string =>
  `${ref.platform}:${ref.accountId}:${ref.type}:${ref.externalId}`;

/** The synced entities named by `refs` (the proposals' and changes' targets), by `entityRefKey`. A ref with no
 *  synced entity is missing from the map. */
export async function entitiesByRef(
  db: DbOrTx,
  productId: string,
  refs: readonly EntityRef[],
): Promise<Map<string, { name: string; status: string }>> {
  if (refs.length === 0) return new Map();
  const rows = await db
    .select({
      platform: adEntities.platform,
      accountId: accounts.externalId,
      type: adEntities.type,
      externalId: adEntities.externalId,
      name: adEntities.name,
      status: adEntities.status,
    })
    .from(adEntities)
    .innerJoin(accounts, eq(accounts.id, adEntities.accountId))
    .where(
      and(
        eq(adEntities.productId, productId),
        inArray(adEntities.externalId, [...new Set(refs.map((r) => r.externalId))]),
      ),
    );
  const wanted = new Set(refs.map(entityRefKey));
  return new Map(
    rows
      .map((r) => [entityRefKey(r as EntityRef), { name: r.name, status: r.status }] as const)
      .filter(([key]) => wanted.has(key)),
  );
}

export interface DecisionView {
  proposalId: string;
  shortId: string;
  origin: string;
  /** The proposal's status now (an approved one later expires in Phase 1: nothing is applied). */
  status: string;
  action: unknown;
  version: number;
  decision: 'approve' | 'reject';
  reason: string | null;
  actor: string;
  channel: string;
  decidedAt: Date;
}

/** The latest decisions on the product's proposals, newest first, with the proposal they decided. */
export async function listDecisions(db: DbOrTx, productId: string, limit = 30): Promise<DecisionView[]> {
  return db
    .select({
      proposalId: proposals.id,
      shortId: proposals.shortId,
      origin: proposals.origin,
      status: proposals.status,
      action: proposals.action,
      version: approvals.proposalVersion,
      decision: approvals.decision,
      reason: approvals.reason,
      actor: approvals.actor,
      channel: approvals.channel,
      decidedAt: approvals.decidedAt,
    })
    .from(approvals)
    .innerJoin(proposals, eq(proposals.id, approvals.proposalId))
    .where(eq(approvals.productId, productId))
    .orderBy(desc(approvals.decidedAt))
    .limit(limit);
}

export interface DocVersion {
  version: number;
  markdown: string;
  updatedAt: Date;
  /** Who asked for it; null for the seed. */
  actor: string | null;
  channel: string | null;
}

/** A product document's versions, newest first, each with who asked for it. */
export async function listProductDocVersions(
  db: DbOrTx,
  input: { productId: string; doc: (typeof PRODUCT_DOCS)[number]; limit?: number },
): Promise<DocVersion[]> {
  return db
    .select({
      version: productDocs.version,
      markdown: productDocs.markdown,
      updatedAt: productDocs.updatedAt,
      actor: operatorRequests.actor,
      channel: operatorRequests.channel,
    })
    .from(productDocs)
    .leftJoin(operatorRequests, eq(operatorRequests.id, productDocs.requestId))
    .where(and(eq(productDocs.productId, input.productId), eq(productDocs.doc, input.doc)))
    .orderBy(desc(productDocs.version))
    .limit(input.limit ?? 50);
}
