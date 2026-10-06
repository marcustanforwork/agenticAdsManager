import { createHash } from 'node:crypto';
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

const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

/** SHA-256 (hex) of normalised values, computed INSIDE the pack's adapter. Raw contact details never leave it.
 *  The platforms normalise an email differently (GOTCHAS, D-076), so it is hashed once per rule. */
export const HashedContact = z.object({
  emailSha256: Sha256Hex.optional(), // Meta: trimmed, lower-cased
  emailSha256Google: Sha256Hex.optional(), // Google: no whitespace, lower-cased, no dots before a Gmail address's @
  phoneSha256: Sha256Hex.optional(),
});
export type HashedContact = z.infer<typeof HashedContact>;

/** Meta's email normalisation (Conversions API `em`): trim, then lower-case. */
export const normaliseEmailForMeta = (email: string): string => email.trim().toLowerCase();

/** Google's email normalisation (Data Manager API): remove all whitespace, lower-case, and for gmail.com and
 *  googlemail.com addresses remove every dot before the @. */
export function normaliseEmailForGoogle(email: string): string {
  const compact = email.replace(/\s+/g, '').toLowerCase();
  const at = compact.lastIndexOf('@');
  if (at < 0) return compact;
  const domain = compact.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return compact;
  return `${compact.slice(0, at).replaceAll('.', '')}@${domain}`;
}

/** The hashes of an email for every platform. For pack adapters only: they call it on the raw value and drop
 *  the raw value (BLUEPRINT §5.18). An empty email gives no hashes. */
export function hashEmail(email: string): HashedContact {
  const meta = normaliseEmailForMeta(email);
  if (meta === '') return {};
  return {
    emailSha256: createHash('sha256').update(meta).digest('hex'),
    emailSha256Google: createHash('sha256').update(normaliseEmailForGoogle(email)).digest('hex'),
  };
}

/** Captured by the product at the moment of conversion (e.g. at signup). No IP address, by design. */
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

/** What the last read of a product's outcome source found. The sync stores it on the product (D-076), and the
 *  `outcome_source_fresh` trust check reads it, so a resumed cycle needs no second read. */
export const OutcomeSourceState = z.object({
  checkedAt: IsoDateTime,
  ok: z.boolean(),
  latestActivityAt: IsoDateTime.nullable(),
  detail: z.string().max(500).optional(),
  /** The outcomes read: from when, how many, how many were new, how many were left out (unknown stage). */
  read: z
    .object({
      since: IsoDateTime,
      events: z.number().int().min(0),
      new: z.number().int().min(0),
      skipped: z.number().int().min(0),
    })
    .optional(),
});
export type OutcomeSourceState = z.infer<typeof OutcomeSourceState>;

export interface OutcomeAdapter {
  fetchSince(since: Date, limit?: number): Promise<OutcomeEvent[]>;
  healthcheck(): Promise<{ ok: boolean; latestActivityAt?: Date; detail?: string }>;
}
