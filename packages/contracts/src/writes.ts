import { z } from 'zod';
import { IsoDateTime } from './hash.ts';
import { MicrosJson } from './money.ts';
import { ClickAndPlatformIds, HashedContact, WebContext } from './outcomes.ts';
import type {
  AdEntityRecord,
  ClickRow,
  DateRange,
  EntityType,
  MetricRow,
  SearchTermRow,
  TrustSignalRow,
} from './platform.ts';
import { EntityRef, Platform } from './platform.ts';

export interface PlatformReadClient {
  platform: Platform;
  getAccountInfo(
    accountId: string,
  ): Promise<{ name: string; timezone: string; currency: string; spendCapMicros?: bigint }>;
  listEntities(accountId: string, types: EntityType[]): Promise<AdEntityRecord[]>; // normalised + raw status
  getMetricsDaily(accountId: string, range: DateRange, level: EntityType): Promise<MetricRow[]>;
  getSearchTerms?(accountId: string, range: DateRange): Promise<SearchTermRow[]>; // Google only
  getClickIds?(accountId: string, day: string): Promise<ClickRow[]>; // Google click_view, one day per call
  snapshot(ref: EntityRef): Promise<{ snapshot: Record<string, unknown>; hash: string; takenAt: Date }>;
  trustSignals(accountId: string, range: DateRange): Promise<TrustSignalRow>;
}

export const ConversionEvent = z.object({
  eventId: z.string(), // `${sourceId}:${stage}` — the de-duplication key on both platforms
  stage: z.string(),
  occurredAt: IsoDateTime,
  valueMicros: MicrosJson.optional(),
  currency: z.string().length(3).optional(),
  ids: ClickAndPlatformIds,
  hashedContact: HashedContact.optional(),
  web: WebContext.optional(),
});
export type ConversionEvent = z.infer<typeof ConversionEvent>;

export const NegativeMatchType = z.enum(['EXACT', 'PHRASE']);

export const WriteOp = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause_entity'), target: EntityRef }),
  z.object({
    action: z.literal('add_negative_keyword'),
    target: EntityRef, // campaign or ad_group
    text: z.string().min(1).max(80),
    matchType: NegativeMatchType,
  }),
  z.object({
    action: z.literal('adjust_budget'),
    target: EntityRef, // campaign | Meta ad set | Google non-shared budget
    newDailyBudgetMicros: MicrosJson,
    netIncrease: z.boolean(),
  }),
  z.object({
    action: z.literal('create_entity_paused'),
    parent: EntityRef,
    type: z.enum(['campaign', 'ad_group', 'ad']),
    spec: z.record(z.string(), z.unknown()),
    idempotencyTag: z.string(),
  }),
  z.object({
    action: z.literal('upload_conversions'),
    platform: Platform,
    accountId: z.string(),
    destinationId: z.string(), // Google conversion action id / Meta dataset id
    eventName: z.string().optional(), // Meta event name for this route
    events: z.array(ConversionEvent).min(1).max(500),
  }),
  // Undo-only actions: never produced from a finding. They exist only as the stored undo of a change we made.
  z.object({ action: z.literal('resume_entity'), target: EntityRef }),
  z.object({ action: z.literal('remove_negative_keyword'), target: EntityRef, criterionId: z.string() }),
  z.object({ action: z.literal('mark_abandoned'), target: EntityRef }),
]);
export type WriteOp = z.infer<typeof WriteOp>;

/** Implemented only in connector-*-write packages; only the gateway depends on them. */
export interface PlatformWriteClient {
  platform: Platform;
  validate(op: WriteOp): Promise<{ ok: boolean; errors: string[] }>; // Google: validate_only. Meta: local + permission probe
  apply(op: WriteOp, idempotencyKey: string): Promise<{ ok: boolean; resultRef?: EntityRef; raw: unknown }>;
  readBack(ref: EntityRef): Promise<Record<string, unknown>>;
  findByIdempotencyTag(parent: EntityRef, tag: string): Promise<EntityRef | null>; // makes create retries safe
}
