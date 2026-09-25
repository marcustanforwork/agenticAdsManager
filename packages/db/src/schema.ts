// The database schema: BLUEPRINT §4, table for table (source_copy arrives in M15a).
// Conventions: uuid ids with gen_random_uuid(), timestamptz times, money as bigint micros,
// and every product-scoped table has product_id plus an index on it (invariant 11).
// Change this file, then `pnpm --filter @ads/db db:generate --name <what>` (see the db-migration skill).
import { sql } from 'drizzle-orm';
import { EntityType, Platform, ProposalStatus } from '@ads/contracts';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** A zod enum's options as the non-empty tuple Drizzle's `enum` option expects. */
const asTuple = <T extends string>(options: readonly T[]): readonly [T, ...T[]] => options as readonly [T, ...T[]];

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const id = () => uuid('id').primaryKey().defaultRandom();
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const micros = (name: string) => bigint(name, { mode: 'bigint' });
const productId = () =>
  uuid('product_id')
    .notNull()
    .references(() => products.id);
/** `<column> in ('a','b',…)` for check constraints. The values are constants from this file, never input. */
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(',')})`);

// ── Products, settings, documents ─────────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ['active', 'halted', 'dormant'] as const;

export const products = pgTable(
  'products',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    packId: text('pack_id').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('SGD'),
    timezone: text('timezone').notNull().default('Asia/Singapore'),
    // active: cycles and applies run · halted: agent stopped, Marcus's pauses still run
    // dormant: no scheduled cycles (the product isn't advertising)
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('active'),
    settings: jsonb('settings').notNull(), // ProductSettings; validated on every write AND every read
    settingsVersion: integer('settings_version').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('products_slug_check', sql`${t.slug} ~ '^[a-z][a-z0-9-]*$'`),
    check('products_status_check', oneOf('status', PRODUCT_STATUSES)),
  ],
);

export const settingsHistory = pgTable(
  'settings_history',
  {
    id: id(),
    productId: productId(),
    version: integer('version').notNull(),
    settings: jsonb('settings').notNull(), // full snapshot of that version
    requestId: uuid('request_id'), // the operator request that caused it (null for seed)
    changedAt: tstz('changed_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.productId, t.version)],
);

export const PRODUCT_DOCS = ['strategy', 'playbook', 'learnings'] as const;

export const productDocs = pgTable(
  'product_docs',
  {
    id: id(),
    productId: productId(),
    doc: text('doc', { enum: PRODUCT_DOCS }).notNull(),
    version: integer('version').notNull(),
    markdown: text('markdown').notNull(),
    requestId: uuid('request_id'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.productId, t.doc, t.version), check('product_docs_doc_check', oneOf('doc', PRODUCT_DOCS))],
);

/** GLOBAL; published by the worker at startup. */
export const packManifests = pgTable(
  'pack_manifests',
  {
    packId: text('pack_id').notNull(),
    version: text('version').notNull(),
    manifest: jsonb('manifest').notNull(), // defaults, phases, thresholds, facts JSON Schema…
    publishedAt: tstz('published_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.version] })],
);

// ── Accounts and credentials ──────────────────────────────────────────────────────────────────

export const PLATFORMS = asTuple(Platform.options); // from @ads/contracts
export const ACCOUNT_STATUSES = ['active', 'paused', 'disconnected'] as const;

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    productId: productId(),
    platform: text('platform', { enum: PLATFORMS }).notNull(),
    externalId: text('external_id').notNull(), // Google customer id / Meta act_…
    name: text('name'),
    timezone: text('timezone'), // as reported by the platform; checked against the product
    currency: char('currency', { length: 3 }),
    status: text('status', { enum: ACCOUNT_STATUSES }).notNull().default('active'),
    lastSyncedAt: tstz('last_synced_at'),
  },
  (t) => [
    unique().on(t.platform, t.externalId),
    index().on(t.productId),
    check('accounts_platform_check', oneOf('platform', PLATFORMS)),
    check('accounts_status_check', oneOf('status', ACCOUNT_STATUSES)),
  ],
);

export const CREDENTIAL_ROLES = ['read', 'write', 'feedback'] as const;

export const credentials = pgTable(
  'credentials',
  {
    id: id(),
    productId: productId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    role: text('role', { enum: CREDENTIAL_ROLES }).notNull(),
    ciphertext: bytea('ciphertext').notNull(), // AES-256-GCM(data key, token JSON)
    dataKeyCiphertext: bytea('data_key_ciphertext').notNull(), // AES-256-GCM(master key, data key)
    masterKeyId: text('master_key_id').notNull(), // 'read-v1' for role read; 'write-v1' for write/feedback
    rotatedAt: tstz('rotated_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.accountId, t.role),
    index().on(t.productId),
    check('credentials_role_check', oneOf('role', CREDENTIAL_ROLES)),
  ],
);

export const PROCESSES = ['worker', 'gateway', 'cli'] as const;

/** GLOBAL audit. */
export const credentialAccess = pgTable(
  'credential_access',
  {
    id: id(),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id),
    accessedAt: tstz('accessed_at').notNull().defaultNow(),
    process: text('process', { enum: PROCESSES }).notNull(),
    purpose: text('purpose').notNull(),
  },
  () => [check('credential_access_process_check', oneOf('process', PROCESSES))],
);

// ── What's being sold (fact base) ─────────────────────────────────────────────────────────────

export const offerings = pgTable(
  'offerings',
  {
    id: id(),
    productId: productId(),
    kind: text('kind').notNull(), // pack-defined: 'project' | 'product'
    key: text('key').notNull(), // the offering's slug, unique within the product
    name: text('name').notNull(),
    facts: jsonb('facts').notNull().default({}), // validated against the pack's fact schema on write
    factsVersion: integer('facts_version').notNull().default(1),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.productId, t.key)],
);

// ── What's in the ad accounts ─────────────────────────────────────────────────────────────────

export const ENTITY_TYPES = asTuple(EntityType.options); // from @ads/contracts

/** Every level: campaign, ad group/ad set, ad, keyword, budget. */
export const adEntities = pgTable(
  'ad_entities',
  {
    id: id(),
    productId: productId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    platform: text('platform', { enum: PLATFORMS }).notNull(),
    type: text('type', { enum: ENTITY_TYPES }).notNull(),
    externalId: text('external_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    status: text('status').notNull(), // normalised (§5.7)
    rawStatus: text('raw_status').notNull(), // the platform's own value
    dailyBudgetMicros: micros('daily_budget_micros'),
    budgetShared: boolean('budget_shared').notNull().default(false), // Google shared budget: never changed by us
    offeringId: uuid('offering_id').references(() => offerings.id), // what this campaign sells
    attributes: jsonb('attributes').notNull().default({}), // objective, bid strategy type, special ad categories…
    createdByUs: boolean('created_by_us').notNull().default(false),
    firstSeenAt: tstz('first_seen_at').notNull().defaultNow(),
    lastSyncedAt: tstz('last_synced_at').notNull(),
  },
  (t) => [
    unique().on(t.accountId, t.type, t.externalId),
    index().on(t.productId),
    index().on(t.parentId),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }),
    check('ad_entities_type_check', oneOf('type', ENTITY_TYPES)),
  ],
);

/** Stored ONLY when the hash changes. */
export const adEntitySnapshots = pgTable(
  'ad_entity_snapshots',
  {
    id: id(),
    productId: productId(),
    adEntityId: uuid('ad_entity_id')
      .notNull()
      .references(() => adEntities.id),
    takenAt: tstz('taken_at').notNull().defaultNow(),
    snapshot: jsonb('snapshot').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [index().on(t.adEntityId, t.takenAt.desc()), index().on(t.productId)],
);

/** One row per entity per day, any level. */
export const metricsDaily = pgTable(
  'metrics_daily',
  {
    productId: productId(),
    adEntityId: uuid('ad_entity_id')
      .notNull()
      .references(() => adEntities.id),
    date: date('date', { mode: 'string' }).notNull(), // the account's local day (= product timezone; trust-checked)
    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
    clicks: bigint('clicks', { mode: 'number' }).notNull().default(0),
    spendMicros: micros('spend_micros')
      .notNull()
      .default(sql`0`),
    platformConversions: numeric('platform_conversions').notNull().default('0'), // the platform's own count
    platformConversionValueMicros: micros('platform_conversion_value_micros')
      .notNull()
      .default(sql`0`),
    restatedAt: tstz('restated_at').notNull().defaultNow(), // last time a re-download changed this row
  },
  (t) => [primaryKey({ columns: [t.adEntityId, t.date] }), index().on(t.productId, t.date)],
);

/** Google only. The term is untrusted platform text (invariant 5). */
export const searchTerms = pgTable(
  'search_terms',
  {
    productId: productId(),
    adGroupEntityId: uuid('ad_group_entity_id')
      .notNull()
      .references(() => adEntities.id),
    date: date('date', { mode: 'string' }).notNull(),
    term: text('term').notNull(),
    impressions: bigint('impressions', { mode: 'number' }).notNull(),
    clicks: bigint('clicks', { mode: 'number' }).notNull(),
    spendMicros: micros('spend_micros').notNull(),
    conversions: numeric('conversions').notNull(),
  },
  (t) => [primaryKey({ columns: [t.adGroupEntityId, t.date, t.term] }), index().on(t.productId, t.date)],
);

/** gclid → campaign (click_view: one day per query, last 90 days). */
export const googleClicks = pgTable(
  'google_clicks',
  {
    productId: productId(),
    gclid: text('gclid').primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    campaignExternalId: text('campaign_external_id').notNull(),
    adGroupExternalId: text('ad_group_external_id'),
  },
  (t) => [index().on(t.productId, t.date)],
);

export const driftEvents = pgTable(
  'drift_events',
  {
    id: id(),
    productId: productId(),
    adEntityId: uuid('ad_entity_id')
      .notNull()
      .references(() => adEntities.id),
    detectedAt: tstz('detected_at').notNull().defaultNow(),
    field: text('field').notNull(),
    expected: jsonb('expected'),
    observed: jsonb('observed'),
    acknowledgedAt: tstz('acknowledged_at'),
  },
  (t) => [index().on(t.productId, t.detectedAt.desc())],
);

// ── Outcomes ──────────────────────────────────────────────────────────────────────────────────

export const ATTRIBUTION_METHODS = ['platform_ids', 'gclid_lookup', 'utm', 'none'] as const;

export const outcomes = pgTable(
  'outcomes',
  {
    id: id(),
    productId: productId(),
    sourceId: text('source_id').notNull(),
    stage: text('stage').notNull(),
    occurredAt: tstz('occurred_at').notNull(),
    valueMicros: micros('value_micros'),
    currency: char('currency', { length: 3 }),
    isTest: boolean('is_test').notNull().default(false),
    ids: jsonb('ids').notNull().default({}), // ClickAndPlatformIds
    hashedContact: jsonb('hashed_contact'), // SHA-256 only, never raw
    attributedEntityId: uuid('attributed_entity_id').references(() => adEntities.id), // campaign level
    attributionMethod: text('attribution_method', { enum: ATTRIBUTION_METHODS }),
    fedBackGoogleAt: tstz('fed_back_google_at'),
    fedBackMetaAt: tstz('fed_back_meta_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.productId, t.sourceId, t.stage),
    index().on(t.productId, t.occurredAt),
    check('outcomes_attribution_method_check', oneOf('attribution_method', ATTRIBUTION_METHODS)),
  ],
);

// ── The agent's work ──────────────────────────────────────────────────────────────────────────

export const CYCLE_KINDS = ['daily', 'weekly', 'manual'] as const;
/** In order: a cycle only ever moves forward through these (BLUEPRINT §5.6). */
export const CYCLE_STAGES = [
  'started',
  'synced',
  'trust_checked',
  'detected',
  'analysed',
  'drafted',
  'reported',
  'done',
] as const;
export const TRUST_RESULTS = ['ok', 'degraded', 'fail'] as const;

export const cycles = pgTable(
  'cycles',
  {
    id: id(),
    productId: productId(),
    kind: text('kind', { enum: CYCLE_KINDS }).notNull(),
    cycleDate: date('cycle_date', { mode: 'string' }).notNull(), // in the product's timezone
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    stageReached: text('stage_reached', { enum: CYCLE_STAGES }).notNull().default('started'),
    trustResult: text('trust_result', { enum: TRUST_RESULTS }),
    modelCostMicros: micros('model_cost_micros')
      .notNull()
      .default(sql`0`),
    lookups: integer('lookups').notNull().default(0),
    error: text('error'),
  },
  (t) => [
    index().on(t.productId, t.startedAt.desc()),
    uniqueIndex('cycles_one_scheduled_per_day')
      .on(t.productId, t.kind, t.cycleDate)
      .where(sql`${t.kind} <> 'manual'`),
    check('cycles_kind_check', oneOf('kind', CYCLE_KINDS)),
    check('cycles_stage_reached_check', oneOf('stage_reached', CYCLE_STAGES)),
    check('cycles_trust_result_check', oneOf('trust_result', TRUST_RESULTS)),
  ],
);

export const TRUST_CHECK_RESULTS = ['pass', 'warn', 'fail', 'no_signal'] as const;

export const trustChecks = pgTable(
  'trust_checks',
  {
    id: id(),
    productId: productId(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id),
    accountId: uuid('account_id').references(() => accounts.id), // null for product-level checks
    checkId: text('check_id').notNull(), // §5.8
    result: text('result', { enum: TRUST_CHECK_RESULTS }).notNull(),
    detail: jsonb('detail').notNull().default({}),
    checkedAt: tstz('checked_at').notNull().defaultNow(),
  },
  (t) => [index().on(t.productId, t.cycleId), check('trust_checks_result_check', oneOf('result', TRUST_CHECK_RESULTS))],
);

export const FINDING_SOURCES = ['detector', 'analyst'] as const;
export const ANALYST_VERDICTS = ['confirmed', 'dismissed', 'added'] as const;

export const findings = pgTable(
  'findings',
  {
    id: id(),
    productId: productId(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id),
    type: text('type').notNull(),
    source: text('source', { enum: FINDING_SOURCES }).notNull(),
    targetEntityId: uuid('target_entity_id')
      .notNull()
      .references(() => adEntities.id),
    analystVerdict: text('analyst_verdict', { enum: ANALYST_VERDICTS }),
    dismissedReason: text('dismissed_reason'),
    summary: text('summary').notNull(),
    whyNow: text('why_now'),
    evidence: jsonb('evidence').notNull(), // ComputedEvidence — from the DB, never from the AI
    evidenceRefs: jsonb('evidence_refs').notNull().default([]),
    params: jsonb('params'), // AI hints, clamped by core
    confidence: text('confidence'),
    passedThreshold: boolean('passed_threshold').notNull(),
    proposedAction: jsonb('proposed_action'), // WriteOp derived by core, or null
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index().on(t.productId, t.cycleId),
    check('findings_source_check', oneOf('source', FINDING_SOURCES)),
    check('findings_analyst_verdict_check', oneOf('analyst_verdict', ANALYST_VERDICTS)),
  ],
);

export const PROPOSAL_ORIGINS = ['agent', 'operator', 'policy'] as const;
export const PROPOSAL_STATUSES = asTuple(ProposalStatus.options); // one source of truth: @ads/contracts

export const proposals = pgTable(
  'proposals',
  {
    id: id(),
    shortId: text('short_id').notNull().unique(),
    productId: productId(),
    cycleId: uuid('cycle_id').references(() => cycles.id), // null for operator / policy origin
    findingId: uuid('finding_id').references(() => findings.id),
    origin: text('origin', { enum: PROPOSAL_ORIGINS }).notNull(),
    version: integer('version').notNull().default(1),
    action: jsonb('action').notNull(),
    actionHash: text('action_hash').notNull(),
    undo: jsonb('undo'), // null only for irreversible actions
    revertsRevisionId: text('reverts_revision_id'),
    preconditionHash: text('precondition_hash'),
    preconditionFields: text('precondition_fields')
      .array()
      .notNull()
      .default(sql`'{}'`),
    rationale: text('rationale').notNull(),
    expectedEffect: text('expected_effect').notNull(),
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('pending'),
    statusDetail: jsonb('status_detail'),
    idempotencyKey: text('idempotency_key').unique(), // '<proposalId>:<version>', set on entering 'applying'
    applyingSince: tstz('applying_since'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    index().on(t.productId, t.status),
    check('proposals_origin_check', oneOf('origin', PROPOSAL_ORIGINS)),
    check('proposals_status_check', oneOf('status', PROPOSAL_STATUSES)),
  ],
);

/** Edit history: one row per version, including version 1. */
export const proposalVersions = pgTable(
  'proposal_versions',
  {
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    productId: productId(),
    version: integer('version').notNull(),
    action: jsonb('action').notNull(),
    actionHash: text('action_hash').notNull(),
    undo: jsonb('undo'),
    preconditionHash: text('precondition_hash'),
    requestId: uuid('request_id'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.version] }), index().on(t.productId)],
);

export const DECISIONS = ['approve', 'reject'] as const;
export const APPROVAL_CHANNELS = ['telegram', 'web', 'cli', 'policy'] as const;

export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    productId: productId(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    proposalVersion: integer('proposal_version').notNull(),
    actionHash: text('action_hash').notNull(),
    decision: text('decision', { enum: DECISIONS }).notNull(),
    reason: text('reason'),
    actor: text('actor').notNull(),
    channel: text('channel', { enum: APPROVAL_CHANNELS }).notNull(),
    requestId: uuid('request_id'),
    decidedAt: tstz('decided_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.proposalId, t.proposalVersion), // one decision per version (double taps are harmless)
    index().on(t.productId, t.decidedAt.desc()),
    check('approvals_decision_check', oneOf('decision', DECISIONS)),
    check('approvals_channel_check', oneOf('channel', APPROVAL_CHANNELS)),
    check('approvals_reject_reason_check', sql`${t.decision} <> 'reject' or ${t.reason} is not null`),
  ],
);

export const changeLog = pgTable(
  'change_log',
  {
    revisionId: text('revision_id').primaryKey(), // 'rev_' + ULID
    productId: productId(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    action: jsonb('action').notNull(),
    undo: jsonb('undo'),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
    appliedAt: tstz('applied_at').notNull().defaultNow(),
    approvedBy: text('approved_by').notNull(),
    verified: boolean('verified').notNull(),
    revertedByRevisionId: text('reverted_by_revision_id').references((): AnyPgColumn => changeLog.revisionId),
  },
  (t) => [index().on(t.productId, t.appliedAt.desc())],
);

export const BRIEF_KINDS = ['weekly', 'diagnostic'] as const;

export const briefs = pgTable(
  'briefs',
  {
    id: id(),
    productId: productId(),
    cycleId: uuid('cycle_id').references(() => cycles.id),
    kind: text('kind', { enum: BRIEF_KINDS }).notNull(),
    numbers: jsonb('numbers').notNull(), // every figure the brief may quote (from SQL)
    markdown: text('markdown').notNull(),
    usedTemplateFallback: boolean('used_template_fallback').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
    feedbackUseful: boolean('feedback_useful'), // Phase 0 gate
    feedbackNewInfo: boolean('feedback_new_info'),
  },
  (t) => [index().on(t.productId, t.createdAt.desc()), check('briefs_kind_check', oneOf('kind', BRIEF_KINDS))],
);

// ── Plumbing ──────────────────────────────────────────────────────────────────────────────────

export const REQUEST_CHANNELS = ['telegram', 'web', 'cli'] as const;
export const REQUEST_STATUSES = ['queued', 'done', 'refused'] as const;

export const operatorRequests = pgTable(
  'operator_requests',
  {
    id: id(),
    productId: uuid('product_id').references(() => products.id), // null for global requests (halt all)
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(), // OperatorRequest
    actor: text('actor').notNull(),
    channel: text('channel', { enum: REQUEST_CHANNELS }).notNull(),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('queued'),
    result: jsonb('result'), // what happened, or why it was refused (shown to Marcus)
    createdAt: tstz('created_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
  },
  (t) => [
    index().on(t.status, t.createdAt),
    index().on(t.productId),
    check('operator_requests_channel_check', oneOf('channel', REQUEST_CHANNELS)),
    check('operator_requests_status_check', oneOf('status', REQUEST_STATUSES)),
  ],
);

/** Outbox: anyone writes; the worker's bot sends. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    productId: uuid('product_id').references(() => products.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
  },
  (t) => [
    index()
      .on(t.createdAt)
      .where(sql`${t.sentAt} is null`),
    index().on(t.productId),
  ],
);

export const JOB_QUEUES = ['worker', 'gateway'] as const;
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;

/** GLOBAL queue (the queue functions arrive in M01b). */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    queue: text('queue', { enum: JOB_QUEUES }).notNull().default('worker'),
    kind: text('kind').notNull(), // cycle | apply | feedback | digest | brief | requests | …
    productId: uuid('product_id').references(() => products.id),
    payload: jsonb('payload').notNull().default({}),
    priority: integer('priority').notNull().default(0), // higher runs first (Marcus's pauses = 100)
    runAt: tstz('run_at').notNull().defaultNow(),
    leasedUntil: tstz('leased_until'),
    leasedBy: text('leased_by'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    lastError: text('last_error'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index().on(t.queue, t.status, t.priority.desc(), t.runAt),
    check('jobs_queue_check', oneOf('queue', JOB_QUEUES)),
    check('jobs_status_check', oneOf('status', JOB_STATUSES)),
  ],
);

/** GLOBAL, e.g. writes_enabled. */
export const systemFlags = pgTable('system_flags', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  requestId: uuid('request_id'),
});

/** GLOBAL quota accounting. */
export const apiUsage = pgTable(
  'api_usage',
  {
    platform: text('platform', { enum: PLATFORMS }).notNull(),
    accountExternalId: text('account_external_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    operations: integer('operations').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.platform, t.accountExternalId, t.date] })],
);
