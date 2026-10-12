// Queries for the analyst's input and look-ups (M06b, BLUEPRINT §5.10): per-entity metric totals, outcomes per
// campaign, the rejections that make up decision memory, and the product's first day of spend (for its phase).
// Aggregates only: no outcome row, contact detail or id leaves here (§5.18).
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { adEntities, approvals, driftEvents, findings, metricsDaily, outcomes, proposals } from '../schema.ts';

export interface EntityMetricTotals {
  entityId: string;
  impressions: number;
  clicks: number;
  spendMicros: bigint;
  /** The platform's own conversion count (decimal: Google reports fractions). */
  platformConversions: string;
  /** The same over the recent days (`recentFrom` to `to`). */
  recentImpressions: number;
  recentClicks: number;
  recentSpendMicros: bigint;
  /** The entity's last day with a metrics row in the window. */
  lastDataDay: string;
}

/** Per-entity totals over the window, for the entities with a metrics row in it. */
export async function sumMetricsByEntity(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; recentFrom: string },
): Promise<EntityMetricTotals[]> {
  const recent = sql`${metricsDaily.date} >= ${input.recentFrom}::date`;
  const rows = await db
    .select({
      entityId: metricsDaily.adEntityId,
      impressions: sql<string>`sum(${metricsDaily.impressions})::text`,
      clicks: sql<string>`sum(${metricsDaily.clicks})::text`,
      spend: sql<string>`sum(${metricsDaily.spendMicros})::text`,
      conversions: sql<string>`sum(${metricsDaily.platformConversions})::text`,
      recentImpressions: sql<string>`coalesce(sum(${metricsDaily.impressions}) filter (where ${recent}), 0)::text`,
      recentClicks: sql<string>`coalesce(sum(${metricsDaily.clicks}) filter (where ${recent}), 0)::text`,
      recentSpend: sql<string>`coalesce(sum(${metricsDaily.spendMicros}) filter (where ${recent}), 0)::text`,
      lastDataDay: sql<string>`max(${metricsDaily.date})::text`,
    })
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.productId, input.productId),
        sql`${metricsDaily.date} between ${input.from}::date and ${input.to}::date`,
      ),
    )
    .groupBy(metricsDaily.adEntityId)
    .orderBy(metricsDaily.adEntityId);
  return rows.map((r) => ({
    entityId: r.entityId,
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    spendMicros: BigInt(r.spend),
    platformConversions: r.conversions,
    recentImpressions: Number(r.recentImpressions),
    recentClicks: Number(r.recentClicks),
    recentSpendMicros: BigInt(r.recentSpend),
    lastDataDay: r.lastDataDay,
  }));
}

export interface CampaignOutcomeCount {
  /** The campaign the outcomes are attributed to; null: not attributed. */
  campaignEntityId: string | null;
  stage: string;
  n: number;
}

/** Non-test outcomes on the window's days, per attributed campaign (or unattributed) and stage. */
export async function countOutcomesByCampaign(
  db: DbOrTx,
  input: { productId: string; from: string; to: string; timeZone: string },
): Promise<CampaignOutcomeCount[]> {
  const day = sql`(${outcomes.occurredAt} at time zone ${input.timeZone})::date`;
  const rows = await db
    .select({ campaignEntityId: outcomes.attributedEntityId, stage: outcomes.stage, n: sql<number>`count(*)::int` })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.productId, input.productId),
        eq(outcomes.isTest, false),
        sql`${day} between ${input.from}::date and ${input.to}::date`,
      ),
    )
    .groupBy(outcomes.attributedEntityId, outcomes.stage)
    .orderBy(outcomes.attributedEntityId, outcomes.stage);
  return rows;
}

export interface RejectedFinding {
  findingType: string;
  targetEntityId: string | null;
  targetAccountId: string | null;
  reason: string;
  decidedAt: Date;
}

/** Marcus's rejections of proposals that came from a finding, newest first: decision memory (§5.10). */
export async function listRejectedFindings(db: DbOrTx, productId: string, limit = 500): Promise<RejectedFinding[]> {
  const rows = await db
    .select({
      findingType: findings.type,
      targetEntityId: findings.targetEntityId,
      targetAccountId: findings.targetAccountId,
      reason: approvals.reason,
      decidedAt: approvals.decidedAt,
    })
    .from(approvals)
    .innerJoin(proposals, eq(proposals.id, approvals.proposalId))
    .innerJoin(findings, eq(findings.id, proposals.findingId))
    .where(and(eq(approvals.productId, productId), eq(approvals.decision, 'reject')))
    .orderBy(desc(approvals.decidedAt), desc(approvals.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, reason: r.reason ?? '' }));
}

/** The product's first local day with spend (null: it never spent). */
export async function firstSpendDay(db: DbOrTx, productId: string): Promise<string | null> {
  const [row] = await db
    .select({ day: sql<string | null>`min(${metricsDaily.date})::text` })
    .from(metricsDaily)
    .innerJoin(adEntities, eq(adEntities.id, metricsDaily.adEntityId))
    .where(and(eq(metricsDaily.productId, productId), sql`${metricsDaily.spendMicros} > 0`));
  return row?.day ?? null;
}

/** An entity's drift events, acknowledged or not, newest first. */
export async function listDriftForEntity(db: DbOrTx, adEntityId: string, limit = 200) {
  return db
    .select()
    .from(driftEvents)
    .where(eq(driftEvents.adEntityId, adEntityId))
    .orderBy(desc(driftEvents.detectedAt), desc(driftEvents.id))
    .limit(limit);
}
