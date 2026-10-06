// A GAQL builder with an allowlist (BLUEPRINT M03 build 3). Every query this connector sends is built here
// from listed resources and fields, with typed, validated literals: there is no way to pass free-form GAQL,
// and no value can break out of its literal (ids are digits, enums are A–Z_, dates are real dates…).

const METRICS = [
  'metrics.impressions',
  'metrics.clicks',
  'metrics.cost_micros',
  'metrics.all_conversions',
  'metrics.all_conversions_value',
] as const;
const SEGMENTS = ['segments.date', 'segments.conversion_action'] as const;

/** Per resource (the FROM clause): the fields it may SELECT, and the extra fields it may only filter on. */
export const GAQL_ALLOWLIST = {
  customer: {
    select: [
      'customer.id',
      'customer.descriptive_name',
      'customer.currency_code',
      'customer.time_zone',
      'customer.auto_tagging_enabled',
      'customer.manager',
      'customer.status',
      'customer.test_account',
      ...METRICS,
      ...SEGMENTS,
    ],
    where: [],
  },
  customer_client: {
    select: [
      'customer_client.id',
      'customer_client.descriptive_name',
      'customer_client.level',
      'customer_client.manager',
      'customer_client.status',
      'customer_client.time_zone',
      'customer_client.currency_code',
    ],
    where: [],
  },
  campaign: {
    select: [
      'campaign.id',
      'campaign.name',
      'campaign.status',
      'campaign.primary_status',
      'campaign.primary_status_reasons',
      'campaign.advertising_channel_type',
      'campaign.bidding_strategy_type',
      'campaign.campaign_budget',
      'campaign_budget.amount_micros',
      'campaign_budget.explicitly_shared',
      'campaign_budget.period',
      ...METRICS,
      ...SEGMENTS,
    ],
    where: [],
  },
  ad_group: {
    select: [
      'ad_group.id',
      'ad_group.name',
      'ad_group.status',
      'ad_group.primary_status',
      'ad_group.primary_status_reasons',
      'ad_group.type',
      'ad_group.cpc_bid_micros',
      'campaign.id',
      ...METRICS,
      ...SEGMENTS,
    ],
    where: [],
  },
  ad_group_criterion: {
    select: [
      'ad_group_criterion.criterion_id',
      'ad_group_criterion.status',
      'ad_group_criterion.primary_status',
      'ad_group_criterion.primary_status_reasons',
      'ad_group_criterion.keyword.text',
      'ad_group_criterion.keyword.match_type',
      'ad_group_criterion.cpc_bid_micros',
      'ad_group.id',
      'campaign.id',
    ],
    where: ['ad_group_criterion.type', 'ad_group_criterion.negative'],
  },
  keyword_view: {
    select: ['ad_group_criterion.criterion_id', 'ad_group.id', 'campaign.id', ...METRICS, ...SEGMENTS],
    where: [],
  },
  campaign_budget: {
    select: [
      'campaign_budget.id',
      'campaign_budget.name',
      'campaign_budget.amount_micros',
      'campaign_budget.explicitly_shared',
      'campaign_budget.status',
      'campaign_budget.period',
      'campaign_budget.delivery_method',
      'campaign_budget.reference_count',
    ],
    where: [],
  },
  search_term_view: {
    select: [
      'search_term_view.search_term',
      'search_term_view.status',
      'ad_group.id',
      'campaign.id',
      'segments.date',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
    ],
    where: [],
  },
  click_view: {
    select: ['click_view.gclid', 'campaign.id', 'ad_group.id', 'segments.date'],
    where: [],
  },
  conversion_action: {
    select: [
      'conversion_action.id',
      'conversion_action.name',
      'conversion_action.status',
      'conversion_action.type',
      'conversion_action.category',
    ],
    where: [],
  },
} as const;

export type GaqlResource = keyof typeof GAQL_ALLOWLIST;
export type SelectField<R extends GaqlResource> = (typeof GAQL_ALLOWLIST)[R]['select'][number];
export type WhereField<R extends GaqlResource> = SelectField<R> | (typeof GAQL_ALLOWLIST)[R]['where'][number];

/** A validated literal. Build one with `lit`. */
export interface GaqlLiteral {
  readonly text: string;
}

/** Literals made by `lit`; `gaql` refuses any other object, so a hand-made `{ text }` can't inject GAQL. */
const issued = new WeakSet<GaqlLiteral>();
const literal = (text: string): GaqlLiteral => {
  const l = Object.freeze({ text });
  issued.add(l);
  return l;
};
const checked = (l: GaqlLiteral): string => {
  if (!issued.has(l)) throw new RangeError('GAQL literals must come from lit.*');
  return l.text;
};
const must = (ok: boolean, what: string, v: unknown): void => {
  if (!ok) throw new RangeError(`not a valid GAQL ${what}: ${JSON.stringify(v)}`);
};

const isRealDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const lit = {
  /** An id (int64): digits only. */
  id: (v: string): GaqlLiteral => (must(/^\d{1,19}$/.test(v), 'id', v), literal(v)),
  /** A small integer, e.g. a customer_client level. */
  int: (v: number): GaqlLiteral => (must(Number.isSafeInteger(v) && v >= 0, 'integer', v), literal(String(v))),
  /** An enum value, e.g. ENABLED. */
  enum: (v: string): GaqlLiteral => (must(/^[A-Z][A-Z0-9_]{0,63}$/.test(v), 'enum value', v), literal(`'${v}'`)),
  /** A calendar date, YYYY-MM-DD. */
  date: (v: string): GaqlLiteral => (must(isRealDate(v), 'date', v), literal(`'${v}'`)),
  /** A resource name, e.g. customers/123/conversionActions/456. */
  resource: (v: string): GaqlLiteral => (
    must(/^customers\/\d{1,19}(?:\/[A-Za-z]{1,64}\/[\d~]{1,60})?$/.test(v), 'resource name', v),
    literal(`'${v}'`)
  ),
  bool: (v: boolean): GaqlLiteral => literal(v ? 'TRUE' : 'FALSE'),
};

export type GaqlCondition<F extends string> =
  | { field: F; op: '=' | '!=' | '<' | '<=' | '>' | '>='; value: GaqlLiteral }
  | { field: F; op: 'IN'; values: readonly GaqlLiteral[] }
  | { field: F; op: 'BETWEEN'; from: GaqlLiteral; to: GaqlLiteral };

export interface GaqlSpec<R extends GaqlResource> {
  from: R;
  select: readonly SelectField<R>[];
  where?: readonly GaqlCondition<WhereField<R>>[];
  limit?: number;
}

export interface GaqlQuery {
  readonly resource: GaqlResource;
  readonly fields: readonly string[];
  /** The query text sent to Google. */
  readonly text: string;
}

/** Builds a query, re-checking the allowlist at run time (the types already enforce it at compile time). */
export function gaql<R extends GaqlResource>(spec: GaqlSpec<R>): GaqlQuery {
  const allowed = GAQL_ALLOWLIST[spec.from] as { select: readonly string[]; where: readonly string[] } | undefined;
  if (allowed === undefined) throw new RangeError(`GAQL resource not allowed: ${JSON.stringify(spec.from)}`);
  if (spec.select.length === 0) throw new RangeError('a GAQL query selects at least one field');
  for (const f of spec.select) {
    if (!allowed.select.includes(f)) throw new RangeError(`GAQL field not allowed from ${spec.from}: ${f}`);
  }
  const parts = [`SELECT ${spec.select.join(', ')}`, `FROM ${spec.from}`];
  const where = (spec.where ?? []).map((c) => {
    if (!allowed.select.includes(c.field) && !allowed.where.includes(c.field)) {
      throw new RangeError(`GAQL filter not allowed on ${spec.from}: ${c.field}`);
    }
    if (c.op === 'IN') {
      if (c.values.length === 0) throw new RangeError(`GAQL IN needs at least one value (${c.field})`);
      return `${c.field} IN (${c.values.map(checked).join(', ')})`;
    }
    if (c.op === 'BETWEEN') return `${c.field} BETWEEN ${checked(c.from)} AND ${checked(c.to)}`;
    if (!['=', '!=', '<', '<=', '>', '>='].includes(c.op)) throw new RangeError(`GAQL operator not allowed: ${c.op}`);
    return `${c.field} ${c.op} ${checked(c.value)}`;
  });
  if (where.length > 0) parts.push(`WHERE ${where.join(' AND ')}`);
  if (spec.limit !== undefined) parts.push(`LIMIT ${lit.int(spec.limit).text}`);
  return Object.freeze({ resource: spec.from, fields: Object.freeze([...spec.select]), text: parts.join(' ') });
}
