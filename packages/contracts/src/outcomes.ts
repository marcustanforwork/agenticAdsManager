import { z } from 'zod';
import { IsoDateTime } from './hash.ts';
import { MicrosJson } from './money.ts';

export const ClickAndPlatformIds = z.object({
  gclid: z.string().optional(),
  gbraid: z.string().optional(),
  wbraid: z.string().optional(),
  fbclid: z.string().optional(),
  fbc: z.string().optional(),
  fbp: z.string().optional(),
  googleCampaignId: z.string().optional(),
  googleAdGroupId: z.string().optional(),
  metaCampaignId: z.string().optional(),
  metaAdSetId: z.string().optional(),
  metaAdId: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
});
export type ClickAndPlatformIds = z.infer<typeof ClickAndPlatformIds>;

/** SHA-256 of normalised values, computed INSIDE the pack's adapter. Raw contact details never leave it. */
export const HashedContact = z.object({
  emailSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  phoneSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type HashedContact = z.infer<typeof HashedContact>;

/** Captured by the product at the moment of conversion (SnapPool: at /start). No IP address, by design. */
export const WebContext = z.object({
  userAgent: z.string().max(512).optional(), // Meta CAPI `client_user_agent` (required for website events)
  pageUrl: z.string().max(1024).optional(), // Meta CAPI `event_source_url` (required for website events)
});
export type WebContext = z.infer<typeof WebContext>;

export const OutcomeEvent = z.object({
  sourceId: z.string(), // stable id in the source system (also the basis of the upload event id)
  stage: z.string(), // one of the product's outcome stage ids
  occurredAt: IsoDateTime,
  valueMicros: MicrosJson.optional(),
  currency: z.string().length(3).optional(),
  isTest: z.boolean(), // test/internal: never uploaded, excluded from KPIs
  ids: ClickAndPlatformIds,
  hashedContact: HashedContact.optional(),
  web: WebContext.optional(), // browser context captured with the conversion (Meta requires it for website events)
});
export type OutcomeEvent = z.infer<typeof OutcomeEvent>;

export interface OutcomeAdapter {
  fetchSince(since: Date, limit?: number): Promise<OutcomeEvent[]>;
  healthcheck(): Promise<{ ok: boolean; latestActivityAt?: Date; detail?: string }>;
}
