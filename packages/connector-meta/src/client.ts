// The Meta read client: implements PlatformReadClient (BLUEPRINT §3.6) on top of GraphClient.
// Meta "ad set" = `ad_group` everywhere in this system. Meta has no keywords and no separate budget objects
// (budgets live on campaigns or ad sets), so those entity types return nothing.
import {
  ACCOUNT_ID_HINTS,
  ACCOUNT_ID_PATTERNS,
  type AdEntityRecord,
  type DateRange,
  type EntityRef,
  type EntityType,
  type MetricRow,
  type PlatformReadClient,
  type TrustSignalRow,
  canonicalJson,
  microsToJson,
  sha256Hex,
} from '@ads/contracts';
import { z } from 'zod';
import { parseMetaReadCredential } from './credential.ts';
import { GraphClient, type GraphClientOptions } from './graph.ts';
import { minorStringToMicros, unitsStringToMicros } from './money.ts';
import { normaliseMetaStatus } from './status.ts';

const DIGITS = /^\d+$/;
const MinorString = z.string().regex(/^\d{1,19}$/);
const CountString = z.string().regex(/^\d{1,15}$/);
/** Action counts are numeric strings; Meta may report fractions for modelled conversions. */
const CountValue = z.string().regex(/^\d{1,15}(?:\.\d+)?$/);
/** Action values are money in currency units: exact, at most 6 decimals (anything else is refused). */
const MoneyValue = z.string().regex(/^\d{1,13}(?:\.\d{1,6})?$/);
const Action = z.looseObject({ action_type: z.string(), value: CountValue });
const ActionMoney = z.looseObject({ action_type: z.string(), value: MoneyValue });

/** A count string → millionths, truncating beyond 6 decimals (a count is never money or a decision number). */
const countToMillionths = (v: string): bigint => {
  const [whole = '0', frac = ''] = v.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.slice(0, 6).padEnd(6, '0'));
};

const AccountSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  currency: z.string().length(3),
  timezone_name: z.string().min(1),
  spend_cap: MinorString.optional(),
  amount_spent: MinorString.optional(),
  account_status: z.number().int().optional(),
});

const EntityBase = {
  id: z.string().regex(DIGITS),
  name: z.string(),
  status: z.string(),
  effective_status: z.string(),
  account_id: z.string().regex(DIGITS).optional(),
  daily_budget: MinorString.optional(),
  lifetime_budget: MinorString.optional(),
  bid_strategy: z.string().optional(),
  updated_time: z.string().optional(),
};
const CampaignSchema = z.looseObject({
  ...EntityBase,
  objective: z.string().optional(),
  buying_type: z.string().optional(),
  special_ad_categories: z.array(z.string()).optional(),
});
const AdSetSchema = z.looseObject({
  ...EntityBase,
  campaign_id: z.string().regex(DIGITS),
  optimization_goal: z.string().optional(),
  billing_event: z.string().optional(),
  attribution_spec: z.array(z.looseObject({ event_type: z.string(), window_days: z.number() })).optional(),
});
const AdSchema = z.looseObject({
  ...EntityBase,
  campaign_id: z.string().regex(DIGITS),
  adset_id: z.string().regex(DIGITS),
});

type MetaEntityType = 'campaign' | 'ad_group' | 'ad';
const ENTITY_TYPES: readonly MetaEntityType[] = ['campaign', 'ad_group', 'ad'];
const isMetaEntityType = (t: EntityType): t is MetaEntityType => (ENTITY_TYPES as readonly string[]).includes(t);

const COMMON_FIELDS =
  'id,name,status,effective_status,account_id,daily_budget,lifetime_budget,bid_strategy,updated_time';
const ENTITY = {
  campaign: {
    edge: 'campaigns',
    fields: `${COMMON_FIELDS},objective,buying_type,special_ad_categories`,
    schema: CampaignSchema,
    level: 'campaign',
  },
  ad_group: {
    edge: 'adsets',
    fields: `${COMMON_FIELDS},campaign_id,optimization_goal,billing_event,attribution_spec`,
    schema: AdSetSchema,
    level: 'adset',
  },
  ad: {
    edge: 'ads',
    fields: `${COMMON_FIELDS},campaign_id,adset_id`,
    schema: AdSchema,
    level: 'ad',
  },
} as const;

const InsightsRow = z.looseObject({
  campaign_id: z.string().regex(DIGITS).optional(),
  adset_id: z.string().regex(DIGITS).optional(),
  ad_id: z.string().regex(DIGITS).optional(),
  date_start: z.iso.date(),
  date_stop: z.iso.date(),
  impressions: CountString.optional(),
  inline_link_clicks: CountString.optional(),
  spend: z.string().optional(),
  actions: z.array(Action).optional(),
  action_values: z.array(ActionMoney).optional(),
  attribution_setting: z.string().optional(),
});
type InsightsRow = z.infer<typeof InsightsRow>;

const INSIGHTS_IDS: Record<MetaEntityType, string> = {
  campaign: 'campaign_id',
  ad_group: 'campaign_id,adset_id',
  ad: 'campaign_id,adset_id,ad_id',
};
/** Clicks = link clicks (`inline_link_clicks`): clicks that lead to the product, comparable to Google clicks. */
const METRIC_FIELDS =
  'date_start,date_stop,impressions,inline_link_clicks,spend,actions,action_values,attribution_setting';

const DatasetStats = z.looseObject({
  data: z.array(
    z.looseObject({
      start_time: z.string().optional(),
      aggregation: z.string().optional(),
      data: z.array(z.looseObject({ value: z.string().optional(), count: z.number().int().min(0) })),
    }),
  ),
});
const DatasetInfo = z.looseObject({ id: z.string(), last_fired_time: z.string().optional() });

export interface MetaAccountInfo {
  name: string;
  timezone: string;
  currency: string;
  /** Unset when the account has no spending limit (Meta reports "0"). */
  spendCapMicros?: bigint;
  amountSpentMicros?: bigint;
  /** Meta's numeric `account_status` (1 = active). */
  accountStatus?: number;
}

export interface MetaReadClientOptions {
  graph: GraphClient;
  /** Insights action types that count as this product's conversions (from the pack's settings; see
   *  `actionTypesForEvents`). Empty = the product has no Meta conversion configured yet. */
  conversionActionTypes: readonly string[];
  /** The conversion dataset whose recent events `trustSignals` reports. */
  datasetId?: string;
  now?: () => Date;
}

export type MetaSnapshot = {
  name: string;
  status: string;
  rawStatus: string;
  configuredStatus: string;
  dailyBudgetMicros: string | null;
  lifetimeBudgetMicros: string | null;
  budgetShared: boolean;
  budgetType: 'daily' | 'lifetime' | null;
  bidStrategy: string | null;
};

/** The tracked fields of an entity (BLUEPRINT §5.7: status, budget, bid strategy, name), as stored in
 *  `ad_entity_snapshots`. It includes the fingerprint fields (`contracts/undo.ts`). */
export function snapshotOf(record: AdEntityRecord): { snapshot: MetaSnapshot; hash: string } {
  const a = record.attributes ?? {};
  const snapshot: MetaSnapshot = {
    name: record.name,
    status: record.status,
    rawStatus: record.rawStatus,
    configuredStatus: typeof a['configuredStatus'] === 'string' ? a['configuredStatus'] : '',
    dailyBudgetMicros: record.dailyBudgetMicros,
    lifetimeBudgetMicros: typeof a['lifetimeBudgetMicros'] === 'string' ? a['lifetimeBudgetMicros'] : null,
    budgetShared: record.budgetShared ?? false,
    budgetType: a['budgetType'] === 'daily' || a['budgetType'] === 'lifetime' ? a['budgetType'] : null,
    bidStrategy: typeof a['bidStrategy'] === 'string' ? a['bidStrategy'] : null,
  };
  return { snapshot, hash: sha256Hex(canonicalJson(snapshot)) };
}

const positiveMinor = (v: string | undefined): string | undefined =>
  v === undefined || /^0+$/.test(v) ? undefined : v;

export class MetaReadClient implements PlatformReadClient {
  readonly platform = 'meta' as const;
  readonly graph: GraphClient;
  readonly #conversionTypes: ReadonlySet<string>;
  readonly #datasetId: string | undefined;
  readonly #now: () => Date;
  readonly #currency = new Map<string, string>();

  constructor(opts: MetaReadClientOptions) {
    this.graph = opts.graph;
    this.#conversionTypes = new Set(opts.conversionActionTypes);
    this.#datasetId = opts.datasetId;
    this.#now = opts.now ?? (() => new Date());
  }

  /** Builds a client from the vault's credential JSON (validated here). */
  static fromCredential(
    credential: unknown,
    opts: Omit<MetaReadClientOptions, 'graph'> & { graph?: Omit<GraphClientOptions, 'accessToken' | 'appSecret'> },
  ): MetaReadClient {
    const { accessToken, appSecret } = parseMetaReadCredential(credential);
    const { graph, ...rest } = opts;
    return new MetaReadClient({ ...rest, graph: new GraphClient({ ...graph, accessToken, appSecret }) });
  }

  async getAccountInfo(accountId: string): Promise<MetaAccountInfo> {
    assertAccountId(accountId);
    const a = await this.graph.get(
      accountId,
      { fields: 'id,name,currency,timezone_name,spend_cap,amount_spent,account_status' },
      AccountSchema,
    );
    this.#currency.set(accountId, a.currency);
    const cap = positiveMinor(a.spend_cap);
    return {
      name: a.name,
      timezone: a.timezone_name,
      currency: a.currency,
      ...(cap === undefined ? {} : { spendCapMicros: minorStringToMicros(cap, a.currency) }),
      ...(a.amount_spent === undefined ? {} : { amountSpentMicros: minorStringToMicros(a.amount_spent, a.currency) }),
      ...(a.account_status === undefined ? {} : { accountStatus: a.account_status }),
    };
  }

  async #currencyOf(accountId: string): Promise<string> {
    return this.#currency.get(accountId) ?? (await this.getAccountInfo(accountId)).currency;
  }

  async listEntities(accountId: string, types: EntityType[]): Promise<AdEntityRecord[]> {
    assertAccountId(accountId);
    const wanted = ENTITY_TYPES.filter((t) => types.includes(t));
    if (wanted.length === 0) return [];
    const currency = await this.#currencyOf(accountId);
    const out: AdEntityRecord[] = [];
    for (const type of wanted) {
      const spec = ENTITY[type];
      const rows = await this.graph.getAll(
        `${accountId}/${spec.edge}`,
        { fields: spec.fields, limit: 500 },
        spec.schema,
      );
      for (const raw of rows) out.push(toRecord(type, accountId, raw, currency));
    }
    return out;
  }

  async getMetricsDaily(accountId: string, range: DateRange, level: EntityType): Promise<MetricRow[]> {
    assertAccountId(accountId);
    if (!isMetaEntityType(level)) return [];
    assertRange(range);
    const rows = await this.graph.getAll(
      `${accountId}/insights`,
      {
        level: ENTITY[level].level,
        time_range: { since: range.from, until: range.to },
        time_increment: 1,
        fields: `${INSIGHTS_IDS[level]},${METRIC_FIELDS}`,
        limit: 500,
      },
      InsightsRow,
    );
    return rows.map((r) => this.#metricRow(accountId, level, r));
  }

  #metricRow(accountId: string, level: MetaEntityType, r: InsightsRow): MetricRow {
    const externalId = level === 'campaign' ? r.campaign_id : level === 'ad_group' ? r.adset_id : r.ad_id;
    if (externalId === undefined) throw new Error(`Meta insights row at ${level} level has no id`);
    if (r.date_start !== r.date_stop)
      throw new Error(`Meta insights row spans ${r.date_start}..${r.date_stop}, not one day`);
    const { count, valueMicros } = this.#conversions(r);
    return {
      ref: { platform: 'meta', accountId, type: level, externalId },
      day: r.date_start,
      impressions: Number(r.impressions ?? '0'),
      clicks: Number(r.inline_link_clicks ?? '0'),
      spendMicros: microsToJson(unitsStringToMicros(r.spend ?? '0')),
      platformConversions: count,
      platformConversionValueMicros: microsToJson(valueMicros),
      attributionSetting: r.attribution_setting ?? null,
    };
  }

  /** Sums the configured conversion action types. Counts are the platform's own (never a decision number). */
  #conversions(r: Pick<InsightsRow, 'actions' | 'action_values'>): { count: number; valueMicros: bigint } {
    let micro = 0n; // the count, in millionths, so fractional counts add up exactly
    let valueMicros = 0n;
    for (const a of r.actions ?? []) if (this.#conversionTypes.has(a.action_type)) micro += countToMillionths(a.value);
    for (const a of r.action_values ?? []) {
      if (this.#conversionTypes.has(a.action_type)) valueMicros += unitsStringToMicros(a.value);
    }
    return { count: Number(micro) / 1_000_000, valueMicros };
  }

  async snapshot(ref: EntityRef): Promise<{ snapshot: Record<string, unknown>; hash: string; takenAt: Date }> {
    if (ref.platform !== 'meta') throw new Error(`not a Meta entity: ${ref.platform}`);
    assertAccountId(ref.accountId);
    if (!isMetaEntityType(ref.type)) throw new Error(`Meta has no ${ref.type} entities`);
    if (!DIGITS.test(ref.externalId)) throw new Error('a Meta entity id is digits');
    const spec = ENTITY[ref.type];
    const currency = await this.#currencyOf(ref.accountId);
    const raw = await this.graph.get(ref.externalId, { fields: spec.fields }, spec.schema);
    if (raw.account_id !== undefined && `act_${raw.account_id}` !== ref.accountId) {
      throw new Error(`Meta ${ref.type} ${ref.externalId} belongs to another ad account`);
    }
    const { snapshot, hash } = snapshotOf(toRecord(ref.type, ref.accountId, raw, currency));
    return { snapshot, hash, takenAt: this.#now() };
  }

  async trustSignals(accountId: string, range: DateRange): Promise<TrustSignalRow> {
    assertAccountId(accountId);
    assertRange(range);
    const info = await this.getAccountInfo(accountId);
    const rows = await this.graph.getAll(
      `${accountId}/insights`,
      {
        level: 'account',
        time_range: { since: range.from, until: range.to },
        fields: 'inline_link_clicks,spend,actions,action_values',
        limit: 500,
      },
      InsightsRow.partial({ date_start: true, date_stop: true }),
    );
    let clicks = 0;
    let spend = 0n;
    let conversions = 0;
    for (const r of rows) {
      clicks += Number(r.inline_link_clicks ?? '0');
      spend += unitsStringToMicros(r.spend ?? '0');
      conversions += this.#conversions(r).count;
    }
    const dataset = this.#datasetId === undefined ? null : await this.#datasetSignals(this.#datasetId);
    return {
      clicks,
      platformConversions: conversions,
      spendMicros: microsToJson(spend),
      spendCapMicros: info.spendCapMicros === undefined ? null : microsToJson(info.spendCapMicros),
      amountSpentMicros: info.amountSpentMicros === undefined ? null : microsToJson(info.amountSpentMicros),
      datasetEventsReceived: dataset?.events ?? null,
      datasetLastEventAt: dataset?.lastEventAt ?? null,
    };
  }

  /** Events received by the dataset in the last 7 days (the stats endpoint's limit), and the last event time. */
  async #datasetSignals(datasetId: string): Promise<{ events: number; lastEventAt: string | null }> {
    if (!DIGITS.test(datasetId)) throw new Error('a Meta dataset id is digits');
    const end = Math.floor(this.#now().getTime() / 3_600_000) * 3_600; // whole hours, in seconds
    const stats = await this.graph.get(
      `${datasetId}/stats`,
      { aggregation: 'event', start_time: end - 7 * 24 * 3_600, end_time: end },
      DatasetStats,
    );
    let events = 0;
    for (const bucket of stats.data) for (const d of bucket.data) events += d.count;
    const info = await this.graph.get(datasetId, { fields: 'id,last_fired_time' }, DatasetInfo);
    const last = info.last_fired_time === undefined ? null : new Date(info.last_fired_time);
    return { events, lastEventAt: last === null || Number.isNaN(last.getTime()) ? null : last.toISOString() };
  }
}

function assertAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERNS.meta.test(accountId)) throw new Error(ACCOUNT_ID_HINTS.meta);
}

function assertRange(range: DateRange): void {
  if (range.from > range.to) throw new Error(`empty date range ${range.from}..${range.to}`);
}

type RawEntity = z.infer<typeof CampaignSchema> | z.infer<typeof AdSetSchema> | z.infer<typeof AdSchema>;

function toRecord(type: MetaEntityType, accountId: string, raw: RawEntity, currency: string): AdEntityRecord {
  const ref = (t: EntityType, externalId: string): EntityRef => ({ platform: 'meta', accountId, type: t, externalId });
  let parent: EntityRef | null = null;
  if (type === 'ad_group') parent = ref('campaign', String(raw['campaign_id']));
  if (type === 'ad') parent = ref('ad_group', String(raw['adset_id']));

  const daily = positiveMinor(raw.daily_budget);
  const lifetime = positiveMinor(raw.lifetime_budget);
  const attributes: Record<string, unknown> = {
    configuredStatus: raw.status,
    budgetType: daily !== undefined ? 'daily' : lifetime !== undefined ? 'lifetime' : null,
    bidStrategy: raw.bid_strategy ?? null,
  };
  if (lifetime !== undefined)
    attributes['lifetimeBudgetMicros'] = microsToJson(minorStringToMicros(lifetime, currency));
  for (const [from, to] of [
    ['objective', 'objective'],
    ['buying_type', 'buyingType'],
    ['special_ad_categories', 'specialAdCategories'],
    ['optimization_goal', 'optimizationGoal'],
    ['billing_event', 'billingEvent'],
    ['attribution_spec', 'attributionSpec'],
  ] as const) {
    if (raw[from] !== undefined) attributes[to] = raw[from];
  }

  return {
    ref: ref(type, raw.id),
    parent,
    name: raw.name,
    status: normaliseMetaStatus(raw.effective_status),
    rawStatus: raw.effective_status,
    dailyBudgetMicros: daily === undefined ? null : microsToJson(minorStringToMicros(daily, currency)),
    budgetShared: false, // Meta has no shared budgets in Google's sense
    attributes,
    raw: { ...raw },
  };
}
