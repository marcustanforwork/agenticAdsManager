// The Google read client: implements PlatformReadClient (BLUEPRINT §3.6) on top of GoogleAdsClient. Every query
// comes from the GAQL builder. Entity types: campaign, ad_group, keyword (`<adGroupId>~<criterionId>`) and
// budget; Google ads are not read in Phase 0, so the `ad` type returns nothing.
import {
  ACCOUNT_ID_HINTS,
  ACCOUNT_ID_PATTERNS,
  type AdEntityRecord,
  type ClickRow,
  type DateRange,
  type EntityRef,
  type EntityType,
  type MetricRow,
  type PlatformReadClient,
  type SearchTermRow,
  type TrustSignalRow,
  canonicalJson,
  microsToJson,
  sha256Hex,
} from '@ads/contracts';
import { z } from 'zod';
import { type GaqlCondition, type GaqlResource, type SelectField, type WhereField, gaql, lit } from './gaql.ts';
import { doubleToMicros, microsFromGoogle } from './money.ts';
import { normaliseGoogleStatus } from './status.ts';
import type { GoogleAdsClient } from './transport.ts';

const Id = z.string().regex(/^\d{1,19}$/);
const Int64 = z.string().regex(/^-?\d{1,19}$/);
const Count = z.string().regex(/^\d{1,15}$/);

const Metrics = z
  .looseObject({
    impressions: Count.optional(),
    clicks: Count.optional(),
    costMicros: Int64.optional(),
    allConversions: z.number().min(0).optional(),
    allConversionsValue: z.number().optional(),
  })
  .optional();
const Segments = z.looseObject({ date: z.iso.date().optional(), conversionAction: z.string().optional() }).optional();
const CampaignRef = z.looseObject({ id: Id });
const AdGroupRef = z.looseObject({ id: Id });

const CampaignFields = z.looseObject({
  id: Id,
  name: z.string().optional(),
  status: z.string().optional(),
  primaryStatus: z.string().optional(),
  primaryStatusReasons: z.array(z.string()).optional(),
  advertisingChannelType: z.string().optional(),
  biddingStrategyType: z.string().optional(),
  campaignBudget: z.string().optional(),
});
const BudgetFields = z.looseObject({
  id: Id.optional(),
  name: z.string().optional(),
  amountMicros: Int64.optional(),
  explicitlyShared: z.boolean().optional(),
  status: z.string().optional(),
  period: z.string().optional(),
  deliveryMethod: z.string().optional(),
  referenceCount: Count.optional(),
});
const AdGroupFields = z.looseObject({
  id: Id,
  name: z.string().optional(),
  status: z.string().optional(),
  primaryStatus: z.string().optional(),
  primaryStatusReasons: z.array(z.string()).optional(),
  type: z.string().optional(),
  cpcBidMicros: Int64.optional(),
});
const CriterionFields = z.looseObject({
  criterionId: Id,
  status: z.string().optional(),
  primaryStatus: z.string().optional(),
  primaryStatusReasons: z.array(z.string()).optional(),
  keyword: z.looseObject({ text: z.string().optional(), matchType: z.string().optional() }).optional(),
  cpcBidMicros: Int64.optional(),
});

const CampaignRow = z.looseObject({ campaign: CampaignFields, campaignBudget: BudgetFields.optional() });
const AdGroupRow = z.looseObject({ adGroup: AdGroupFields, campaign: CampaignRef });
const KeywordRow = z.looseObject({ adGroupCriterion: CriterionFields, adGroup: AdGroupRef, campaign: CampaignRef });
const BudgetRow = z.looseObject({ campaignBudget: BudgetFields.extend({ id: Id }) });
const MetricsRow = z.looseObject({
  campaign: CampaignRef.optional(),
  adGroup: AdGroupRef.optional(),
  adGroupCriterion: z.looseObject({ criterionId: Id }).optional(),
  metrics: Metrics,
  segments: Segments,
});
type MetricsRow = z.infer<typeof MetricsRow>;
const CustomerRow = z.looseObject({
  customer: z.looseObject({
    id: Id,
    descriptiveName: z.string().optional(),
    currencyCode: z.string().length(3),
    timeZone: z.string().min(1),
    autoTaggingEnabled: z.boolean().optional(),
    manager: z.boolean().optional(),
    status: z.string().optional(),
    testAccount: z.boolean().optional(),
  }),
});
const ClientRow = z.looseObject({
  customerClient: z.looseObject({
    id: Id,
    descriptiveName: z.string().optional(),
    level: Count.optional(),
    manager: z.boolean().optional(),
    status: z.string().optional(),
    timeZone: z.string().optional(),
    currencyCode: z.string().optional(),
  }),
});
const SearchTermViewRow = z.looseObject({
  searchTermView: z.looseObject({ searchTerm: z.string(), status: z.string().optional() }),
  adGroup: AdGroupRef,
  campaign: CampaignRef.optional(),
  metrics: Metrics,
  segments: z.looseObject({ date: z.iso.date() }),
});
const ClickViewRow = z.looseObject({
  clickView: z.looseObject({ gclid: z.string().optional() }),
  campaign: CampaignRef,
  adGroup: AdGroupRef.optional(),
  segments: z.looseObject({ date: z.iso.date() }),
});
const ConversionActionRow = z.looseObject({
  conversionAction: z.looseObject({
    id: Id,
    name: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    category: z.string().optional(),
  }),
});

export interface GoogleAccountInfo {
  name: string;
  timezone: string;
  currency: string;
  /** Whether Google adds the gclid to ad clicks (needed for attribution, D-060). */
  autoTaggingEnabled: boolean;
  /** A manager account can't be synced: link its client account instead. */
  manager: boolean;
  /** Google's account status, e.g. ENABLED. */
  status?: string;
  testAccount: boolean;
}

export interface ClientAccount {
  id: string;
  level: number;
  manager: boolean;
  status: string | null;
  timezone: string | null;
  currency: string | null;
}

export interface GoogleReadClientOptions {
  api: GoogleAdsClient;
  /** Conversion action ids (digits) whose conversions count as this product's platform conversions: the Google
   *  feedback routes of the primary KPI stage. Empty = none configured yet, so conversions read 0. */
  conversionActionIds: readonly string[];
  now?: () => Date;
}

export type GoogleSnapshot = {
  name: string;
  status: string;
  rawStatus: string;
  dailyBudgetMicros: string | null;
  budgetShared: boolean | null;
  budgetType: 'daily' | 'custom' | null;
  bidStrategy: string | null;
};

/** The tracked fields of an entity (BLUEPRINT §5.7: status, budget, bid strategy, name), as stored in
 *  `ad_entity_snapshots`. It includes the fingerprint fields (`contracts/undo.ts`). The primary status is left
 *  out on purpose: it flips between ELIGIBLE and LEARNING on its own; its effect shows in `status`. */
export function snapshotOf(record: AdEntityRecord): { snapshot: GoogleSnapshot; hash: string } {
  const a = record.attributes ?? {};
  const snapshot: GoogleSnapshot = {
    name: record.name,
    status: record.status,
    rawStatus: record.rawStatus,
    dailyBudgetMicros: record.dailyBudgetMicros,
    budgetShared: record.budgetShared,
    budgetType: a['budgetType'] === 'daily' || a['budgetType'] === 'custom' ? a['budgetType'] : null,
    bidStrategy: typeof a['biddingStrategyType'] === 'string' ? a['biddingStrategyType'] : null,
  };
  return { snapshot, hash: sha256Hex(canonicalJson(snapshot)) };
}

type Level = 'campaign' | 'ad_group' | 'keyword';
const LEVELS: readonly Level[] = ['campaign', 'ad_group', 'keyword'];
const isLevel = (t: EntityType): t is Level => (LEVELS as readonly string[]).includes(t);

const LEVEL_QUERY = {
  campaign: { from: 'campaign', ids: ['campaign.id'] },
  ad_group: { from: 'ad_group', ids: ['campaign.id', 'ad_group.id'] },
  keyword: { from: 'keyword_view', ids: ['campaign.id', 'ad_group.id', 'ad_group_criterion.criterion_id'] },
} as const;

const between = <R extends GaqlResource>(range: DateRange): GaqlCondition<WhereField<R>> => ({
  field: 'segments.date' as WhereField<R>,
  op: 'BETWEEN',
  from: lit.date(range.from),
  to: lit.date(range.to),
});

const count = (v: string | undefined): number => Number(v ?? '0');
const budgetType = (period: string | undefined): 'daily' | 'custom' | null =>
  period === 'DAILY' ? 'daily' : period === 'CUSTOM_PERIOD' ? 'custom' : null;
/** A budget is shared if Google says so; unknown (null) if it doesn't, unless several campaigns use it. */
const sharedFlag = (explicitlyShared: boolean | undefined, referenceCount: string | undefined): boolean | null =>
  explicitlyShared ?? (count(referenceCount) > 1 ? true : null);

export class GoogleReadClient implements PlatformReadClient {
  readonly platform = 'google' as const;
  readonly api: GoogleAdsClient;
  readonly #conversionActionIds: readonly string[];
  readonly #now: () => Date;

  constructor(opts: GoogleReadClientOptions) {
    for (const id of opts.conversionActionIds) {
      if (!/^\d{1,19}$/.test(id)) throw new Error('a Google conversion action id is digits');
    }
    this.api = opts.api;
    this.#conversionActionIds = [...new Set(opts.conversionActionIds)];
    this.#now = opts.now ?? (() => new Date());
  }

  async getAccountInfo(accountId: string): Promise<GoogleAccountInfo> {
    assertAccountId(accountId);
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'customer',
        select: [
          'customer.id',
          'customer.descriptive_name',
          'customer.currency_code',
          'customer.time_zone',
          'customer.auto_tagging_enabled',
          'customer.manager',
          'customer.status',
          'customer.test_account',
        ],
      }),
      CustomerRow,
    );
    const c = rows[0]?.customer;
    if (c === undefined || rows.length !== 1)
      throw new Error(`Google returned ${rows.length} customer rows for ${accountId}`);
    return {
      name: c.descriptiveName ?? '',
      timezone: c.timeZone,
      currency: c.currencyCode,
      autoTaggingEnabled: c.autoTaggingEnabled ?? false,
      manager: c.manager ?? false,
      ...(c.status === undefined ? {} : { status: c.status }),
      testAccount: c.testAccount ?? false,
    };
  }

  /** The client accounts under a manager account, one level down (`customer_client`), the manager included at
   *  level 0. Query it with `login-customer-id` = the manager. */
  async listClientAccounts(managerId: string): Promise<ClientAccount[]> {
    assertAccountId(managerId);
    const rows = await this.api.search(
      managerId,
      gaql({
        from: 'customer_client',
        select: [
          'customer_client.id',
          'customer_client.level',
          'customer_client.manager',
          'customer_client.status',
          'customer_client.time_zone',
          'customer_client.currency_code',
        ],
        where: [{ field: 'customer_client.level', op: '<=', value: lit.int(1) }],
      }),
      ClientRow,
      { loginCustomerId: managerId },
    );
    return rows.map(({ customerClient: c }) => ({
      id: c.id,
      level: count(c.level),
      manager: c.manager ?? false,
      status: c.status ?? null,
      timezone: c.timeZone ?? null,
      currency: c.currencyCode ?? null,
    }));
  }

  /** Resolves manager → client: the account to put in `login-customer-id` for a client account. Undefined when the
   *  signed-in identity reaches the account directly; otherwise the first accessible account that lists it as a
   *  client one level down. Throws if none does. One operation per accessible account, plus one. */
  async findManagerFor(clientId: string): Promise<string | undefined> {
    assertAccountId(clientId);
    const accessible = await this.api.listAccessibleCustomers();
    if (accessible.includes(clientId)) return undefined;
    for (const id of accessible) {
      const clients = await this.listClientAccounts(id);
      if (clients.some((c) => c.id === clientId && c.level === 1)) return id;
    }
    throw new Error(
      `the signed-in Google identity can't reach ${clientId}: add it to the manager account (Admin → Access and security)`,
    );
  }

  async listEntities(accountId: string, types: EntityType[]): Promise<AdEntityRecord[]> {
    assertAccountId(accountId);
    const out: AdEntityRecord[] = [];
    if (types.includes('campaign')) out.push(...(await this.#campaigns(accountId)));
    if (types.includes('ad_group')) out.push(...(await this.#adGroups(accountId)));
    if (types.includes('keyword')) out.push(...(await this.#keywords(accountId)));
    if (types.includes('budget')) out.push(...(await this.#budgets(accountId)));
    return out;
  }

  async #campaigns(accountId: string, id?: string): Promise<AdEntityRecord[]> {
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'campaign',
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
        ],
        ...(id === undefined ? {} : { where: [{ field: 'campaign.id', op: '=', value: lit.id(id) }] }),
      }),
      CampaignRow,
    );
    return rows.map(({ campaign: c, campaignBudget: b }) => {
      const daily = b?.period === 'DAILY' && b.amountMicros !== undefined ? microsFromGoogle(b.amountMicros) : null;
      const budgetId = /\/campaignBudgets\/(\d+)$/.exec(c.campaignBudget ?? '')?.[1] ?? null;
      return {
        ref: ref(accountId, 'campaign', c.id),
        parent: null,
        name: c.name ?? '',
        status: normaliseGoogleStatus(c.status ?? '', c.primaryStatus),
        rawStatus: c.status ?? '',
        dailyBudgetMicros: daily === null ? null : microsToJson(daily),
        budgetShared: b === undefined ? null : sharedFlag(b.explicitlyShared, undefined),
        attributes: compact({
          primaryStatus: c.primaryStatus,
          primaryStatusReasons: c.primaryStatusReasons,
          channelType: c.advertisingChannelType,
          biddingStrategyType: c.biddingStrategyType,
          budgetId,
          budgetType: budgetType(b?.period),
        }),
        raw: { campaign: { ...c }, ...(b === undefined ? {} : { campaignBudget: { ...b } }) },
      };
    });
  }

  async #adGroups(accountId: string, id?: string): Promise<AdEntityRecord[]> {
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'ad_group',
        select: [
          'ad_group.id',
          'ad_group.name',
          'ad_group.status',
          'ad_group.primary_status',
          'ad_group.primary_status_reasons',
          'ad_group.type',
          'ad_group.cpc_bid_micros',
          'campaign.id',
        ],
        ...(id === undefined ? {} : { where: [{ field: 'ad_group.id', op: '=', value: lit.id(id) }] }),
      }),
      AdGroupRow,
    );
    return rows.map(({ adGroup: g, campaign }) => ({
      ref: ref(accountId, 'ad_group', g.id),
      parent: ref(accountId, 'campaign', campaign.id),
      name: g.name ?? '',
      status: normaliseGoogleStatus(g.status ?? '', g.primaryStatus),
      rawStatus: g.status ?? '',
      dailyBudgetMicros: null, // Google budgets belong to campaigns
      budgetShared: null,
      attributes: compact({
        primaryStatus: g.primaryStatus,
        primaryStatusReasons: g.primaryStatusReasons,
        adGroupType: g.type,
        cpcBidMicros: g.cpcBidMicros,
      }),
      raw: { adGroup: { ...g }, campaign: { ...campaign } },
    }));
  }

  async #keywords(accountId: string, key?: { adGroupId: string; criterionId: string }): Promise<AdEntityRecord[]> {
    const where: GaqlCondition<WhereField<'ad_group_criterion'>>[] = [
      { field: 'ad_group_criterion.type', op: '=', value: lit.enum('KEYWORD') },
      { field: 'ad_group_criterion.negative', op: '=', value: lit.bool(false) },
    ];
    if (key !== undefined) {
      where.push(
        { field: 'ad_group.id', op: '=', value: lit.id(key.adGroupId) },
        { field: 'ad_group_criterion.criterion_id', op: '=', value: lit.id(key.criterionId) },
      );
    }
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'ad_group_criterion',
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
        where,
      }),
      KeywordRow,
    );
    return rows.map(({ adGroupCriterion: k, adGroup, campaign }) => ({
      ref: ref(accountId, 'keyword', `${adGroup.id}~${k.criterionId}`),
      parent: ref(accountId, 'ad_group', adGroup.id),
      name: k.keyword?.text ?? '', // untrusted platform text: stored as data only (invariant 5)
      status: normaliseGoogleStatus(k.status ?? '', k.primaryStatus),
      rawStatus: k.status ?? '',
      dailyBudgetMicros: null,
      budgetShared: null,
      attributes: compact({
        matchType: k.keyword?.matchType,
        primaryStatus: k.primaryStatus,
        primaryStatusReasons: k.primaryStatusReasons,
        cpcBidMicros: k.cpcBidMicros,
        campaignId: campaign.id,
      }),
      raw: { adGroupCriterion: { ...k }, adGroup: { ...adGroup }, campaign: { ...campaign } },
    }));
  }

  async #budgets(accountId: string, id?: string): Promise<AdEntityRecord[]> {
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'campaign_budget',
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
        ...(id === undefined ? {} : { where: [{ field: 'campaign_budget.id', op: '=', value: lit.id(id) }] }),
      }),
      BudgetRow,
    );
    return rows.map(({ campaignBudget: b }) => {
      const daily = b.period === 'DAILY' && b.amountMicros !== undefined ? microsFromGoogle(b.amountMicros) : null;
      return {
        ref: ref(accountId, 'budget', b.id),
        parent: null,
        name: b.name ?? '',
        status: normaliseGoogleStatus(b.status ?? ''),
        rawStatus: b.status ?? '',
        dailyBudgetMicros: daily === null ? null : microsToJson(daily),
        // Shared budgets belong to several campaigns: this system never changes them (GOTCHAS).
        budgetShared: sharedFlag(b.explicitlyShared, b.referenceCount),
        attributes: compact({
          budgetType: budgetType(b.period),
          amountMicros: b.amountMicros,
          deliveryMethod: b.deliveryMethod,
          referenceCount: b.referenceCount === undefined ? undefined : count(b.referenceCount),
        }),
        raw: { campaignBudget: { ...b } },
      };
    });
  }

  async getMetricsDaily(accountId: string, range: DateRange, level: EntityType): Promise<MetricRow[]> {
    assertAccountId(accountId);
    if (!isLevel(level)) return [];
    assertRange(range);
    const spec = LEVEL_QUERY[level];
    const base = await this.api.search(
      accountId,
      gaql({
        from: spec.from,
        select: [
          ...spec.ids,
          'segments.date',
          'metrics.impressions',
          'metrics.clicks',
          'metrics.cost_micros',
        ] as SelectField<typeof spec.from>[],
        where: [between(range)],
      }),
      MetricsRow,
    );
    const rows = new Map<string, MetricRow>();
    for (const r of base) {
      const m = this.#metricRow(accountId, level, r);
      rows.set(`${m.ref.externalId}|${m.day}`, m);
    }
    for (const r of await this.#conversionsBy(accountId, spec.from, [...spec.ids], range)) {
      const blank = this.#metricRow(accountId, level, r);
      const key = `${blank.ref.externalId}|${blank.day}`;
      const row = rows.get(key) ?? { ...blank, platformConversions: 0, platformConversionValueMicros: '0' };
      row.platformConversions += r.metrics?.allConversions ?? 0;
      row.platformConversionValueMicros = microsToJson(
        BigInt(row.platformConversionValueMicros ?? '0') + doubleToMicros(r.metrics?.allConversionsValue ?? 0),
      );
      rows.set(key, row);
    }
    return [...rows.values()];
  }

  /** Conversions of the KPI stage's conversion actions only (`segments.conversion_action`), so funnel stages are
   *  never added together (D-069's rule, applied to Google). Nothing configured = no query. */
  async #conversionsBy(
    accountId: string,
    from: 'campaign' | 'ad_group' | 'keyword_view' | 'customer',
    ids: string[],
    range: DateRange,
  ): Promise<MetricsRow[]> {
    if (this.#conversionActionIds.length === 0) return [];
    const select = [
      ...ids,
      ...(from === 'customer' ? [] : ['segments.date']),
      'segments.conversion_action',
      'metrics.all_conversions',
      'metrics.all_conversions_value',
    ] as SelectField<typeof from>[];
    return this.api.search(
      accountId,
      gaql({
        from,
        select,
        where: [
          between(range),
          {
            field: 'segments.conversion_action',
            op: 'IN',
            values: this.#conversionActionIds.map((id) =>
              lit.resource(`customers/${accountId}/conversionActions/${id}`),
            ),
          },
        ],
      }),
      MetricsRow,
    );
  }

  #metricRow(accountId: string, level: Level, r: MetricsRow): MetricRow {
    const day = r.segments?.date;
    if (day === undefined) throw new Error(`Google metrics row at ${level} level has no date`);
    let externalId: string | undefined;
    if (level === 'campaign') externalId = r.campaign?.id;
    if (level === 'ad_group') externalId = r.adGroup?.id;
    if (level === 'keyword') {
      externalId = r.adGroup && r.adGroupCriterion ? `${r.adGroup.id}~${r.adGroupCriterion.criterionId}` : undefined;
    }
    if (externalId === undefined) throw new Error(`Google metrics row at ${level} level has no id`);
    return {
      ref: ref(accountId, level, externalId),
      day,
      impressions: count(r.metrics?.impressions),
      clicks: count(r.metrics?.clicks),
      spendMicros: microsToJson(microsFromGoogle(r.metrics?.costMicros ?? '0')),
      platformConversions: 0,
      platformConversionValueMicros: '0',
      attributionSetting: null, // Google applies each conversion action's own attribution settings
    };
  }

  async getSearchTerms(accountId: string, range: DateRange): Promise<SearchTermRow[]> {
    assertAccountId(accountId);
    assertRange(range);
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'search_term_view',
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
        where: [between(range)],
      }),
      SearchTermViewRow,
    );
    return rows.map((r) => ({
      adGroup: ref(accountId, 'ad_group', r.adGroup.id),
      day: r.segments.date,
      searchTerm: r.searchTermView.searchTerm, // untrusted text: data, never instructions (invariant 5)
      impressions: count(r.metrics?.impressions),
      clicks: count(r.metrics?.clicks),
      spendMicros: microsToJson(microsFromGoogle(r.metrics?.costMicros ?? '0')),
    }));
  }

  /** Click ids for one day (Google allows only one day per `click_view` query, at most 90 days back). */
  async getClickIds(accountId: string, day: string): Promise<ClickRow[]> {
    assertAccountId(accountId);
    const rows = await this.api.search(
      accountId,
      gaql({
        from: 'click_view',
        select: ['click_view.gclid', 'campaign.id', 'ad_group.id', 'segments.date'],
        where: [{ field: 'segments.date', op: '=', value: lit.date(day) }],
      }),
      ClickViewRow,
    );
    return rows.flatMap((r) =>
      r.clickView.gclid === undefined || r.clickView.gclid === ''
        ? [] // some clicks carry no gclid (e.g. app campaigns)
        : [
            {
              gclid: r.clickView.gclid,
              day: r.segments.date,
              campaignId: r.campaign.id,
              adGroupId: r.adGroup?.id ?? null,
            },
          ],
    );
  }

  async snapshot(entity: EntityRef): Promise<{ snapshot: Record<string, unknown>; hash: string; takenAt: Date }> {
    if (entity.platform !== 'google') throw new Error(`not a Google entity: ${entity.platform}`);
    assertAccountId(entity.accountId);
    let found: AdEntityRecord[];
    if (entity.type === 'keyword') {
      const m = /^(\d{1,19})~(\d{1,19})$/.exec(entity.externalId);
      if (!m?.[1] || !m[2]) throw new Error('a Google keyword id is <adGroupId>~<criterionId>');
      found = await this.#keywords(entity.accountId, { adGroupId: m[1], criterionId: m[2] });
    } else {
      if (!/^\d{1,19}$/.test(entity.externalId)) throw new Error('a Google entity id is digits');
      if (entity.type === 'campaign') found = await this.#campaigns(entity.accountId, entity.externalId);
      else if (entity.type === 'ad_group') found = await this.#adGroups(entity.accountId, entity.externalId);
      else if (entity.type === 'budget') found = await this.#budgets(entity.accountId, entity.externalId);
      else throw new Error(`Google ${entity.type} entities are not read`);
    }
    const [record] = found;
    if (record === undefined || found.length !== 1 || record.ref.externalId !== entity.externalId) {
      throw new Error(`Google ${entity.type} ${entity.externalId} not found in ${entity.accountId}`);
    }
    const { snapshot, hash } = snapshotOf(record);
    return { snapshot, hash, takenAt: this.#now() };
  }

  /** Trust-check inputs (BLUEPRINT §5.8) for Google: clicks and spend, the KPI stage's conversions, whether its
   *  conversion actions exist and are enabled, and whether auto-tagging is on. */
  async trustSignals(accountId: string, range: DateRange): Promise<TrustSignalRow> {
    assertAccountId(accountId);
    assertRange(range);
    const info = await this.getAccountInfo(accountId);
    const totals = await this.api.search(
      accountId,
      gaql({ from: 'customer', select: ['metrics.clicks', 'metrics.cost_micros'], where: [between(range)] }),
      MetricsRow,
    );
    let clicks = 0;
    let spend = 0n;
    for (const r of totals) {
      clicks += count(r.metrics?.clicks);
      spend += microsFromGoogle(r.metrics?.costMicros ?? '0');
    }
    let conversions = 0;
    for (const r of await this.#conversionsBy(accountId, 'customer', [], range)) {
      conversions += r.metrics?.allConversions ?? 0;
    }
    const actions = await this.api.search(
      accountId,
      gaql({
        from: 'conversion_action',
        select: ['conversion_action.id', 'conversion_action.status', 'conversion_action.type'],
      }),
      ConversionActionRow,
    );
    const enabled = new Set(
      actions.filter((a) => a.conversionAction.status === 'ENABLED').map((a) => a.conversionAction.id),
    );
    return {
      clicks,
      platformConversions: conversions,
      spendMicros: microsToJson(spend),
      spendCapMicros: null, // Meta-only check (D-063)
      amountSpentMicros: null,
      autoTaggingEnabled: info.autoTaggingEnabled,
      conversionActionsEnabled: enabled.size,
      conversionActionsMissing: this.#conversionActionIds.filter((id) => !enabled.has(id)),
    };
  }
}

function ref(accountId: string, type: EntityType, externalId: string): EntityRef {
  return { platform: 'google', accountId, type, externalId };
}

function assertAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERNS.google.test(accountId)) throw new Error(ACCOUNT_ID_HINTS.google);
}

function assertRange(range: DateRange): void {
  if (range.from > range.to) throw new Error(`empty date range ${range.from}..${range.to}`);
}

/** Drops undefined values, so attributes hold only what Google reported. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
