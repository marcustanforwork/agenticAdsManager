// The Property SG outcome adapter (BLUEPRINT M05b). Leads come from the existing pipeline, a Tally form that
// writes one record per submission into an Airtable table. The adapter reads that table with the Airtable Web API
// (list records, read only; GOTCHAS "Airtable Web API") and emits one outcome per stage:
//   form_fill          the form submitted       the record's createdTime         source id: the record id
//   qualified_viewing  a qualified viewing      the LEAD_FIELDS.qualifiedViewingOn day (Marcus fills it in)
//   booked             a unit booked           the LEAD_FIELDS.bookedOn day
// LEAD_FIELDS is the stage ↔ field mapping. It is written against a hand-made fixture in Airtable's documented
// response shape: confirm the names against the real base when property resumes (BLUEPRINT M05b "Leave behind").
//
// Personal data stays here (BLUEPRINT §5.18): of the lead's details only the email is read (never the name or the
// phone), hashed in this file, and never returned, logged or put in an error. Click ids and utm values reach the
// table from the visitor's URL through the form's hidden fields (setup task T12): untrusted data, copied into
// fixed fields after type and length checks, never interpreted.
import {
  type ClickAndPlatformIds,
  type OutcomeAdapter,
  type OutcomeEvent,
  type ProductSettings,
  hashEmail,
  platformOfUtmSource,
} from '@ads/contracts';
import { z } from 'zod';
import { singaporeDayStart } from './days.ts';

/** A personal access token with the `data.records:read` scope on the leads base only (setup task T12). */
export const AIRTABLE_TOKEN_ENV = 'PROPERTY_AIRTABLE_TOKEN';
/** The base id, `app…`. */
export const AIRTABLE_BASE_ENV = 'PROPERTY_AIRTABLE_BASE_ID';
/** The leads table: its id (`tbl…`, which survives a rename) or its name. */
export const AIRTABLE_TABLE_ENV = 'PROPERTY_AIRTABLE_TABLE';
export const AIRTABLE_API = 'https://api.airtable.com/v0';

/** The leads table's fields the adapter reads, by name. Click ids and platform ids must be text fields: a number
 *  field would round a Meta id (above 2^53). */
export const LEAD_FIELDS = {
  email: 'Email',
  /** A date (or date and time) field: the day the lead had a qualified viewing. Empty until then. */
  qualifiedViewingOn: 'Qualified viewing on',
  /** A date (or date and time) field: the day the lead booked a unit. */
  bookedOn: 'Booked on',
  // Hidden fields on the form, filled from the ad's URL (the ad URL settings, T12/T14).
  gclid: 'gclid',
  gbraid: 'gbraid',
  wbraid: 'wbraid',
  fbclid: 'fbclid',
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign', // the platform's campaign id
  adGroupId: 'sp_agid', // Google ad group id / Meta ad set id
  adId: 'sp_adid', // Meta ad id
} as const;

/** Airtable returns at most 100 records a page. */
export const PAGE_SIZE = 100;
/** Pages read per call at most (10,000 records), so a wrong filter can't page forever. */
export const MAX_PAGES = 100;
/** The health check looks for form fills this far back: long enough for any staleness setting a slow product needs,
 *  short enough to be one call (Airtable's Free plan allows 1,000 calls a month). */
export const HEALTH_WINDOW_DAYS = 14;
/** The pause between page requests: Airtable allows 5 requests a second per base (GOTCHAS). */
export const PAGE_PAUSE_MS = 250;
export const DEFAULT_LIMIT = 5000;
const TIMEOUT_MS = 30_000;
const CLICK_ID_MAX = 512;
const VALUE_MAX = 255;
const PLATFORM_ID = /^\d{1,30}$/;

/** One record of a list-records page. Airtable leaves empty fields out of `fields`. */
const AirtableRecord = z.object({
  id: z.string().min(1).max(64),
  createdTime: z.string().max(40),
  fields: z.record(z.string(), z.unknown()),
});
type AirtableRecord = z.infer<typeof AirtableRecord>;
const ListResponse = z.object({ records: z.array(AirtableRecord), offset: z.string().min(1).max(512).optional() });

export class AirtableSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AirtableSourceError';
  }
}

interface Source {
  token: string;
  baseId: string;
  table: string;
  fetch: typeof fetch;
  pause: (ms: number) => Promise<void>;
}

/** The connection settings from the environment, or why they're missing. */
function sourceFrom(
  env: Readonly<Record<string, string | undefined>>,
  fetchFn: typeof fetch,
  pause: (ms: number) => Promise<void>,
): Source | string {
  const token = env[AIRTABLE_TOKEN_ENV]?.trim() ?? '';
  const baseId = env[AIRTABLE_BASE_ENV]?.trim() ?? '';
  const table = env[AIRTABLE_TABLE_ENV]?.trim() ?? '';
  const unset = [
    token === '' ? AIRTABLE_TOKEN_ENV : null,
    baseId === '' ? AIRTABLE_BASE_ENV : null,
    table === '' ? AIRTABLE_TABLE_ENV : null,
  ].filter((v) => v !== null);
  if (unset.length > 0) return `${unset.join(', ')} not set (the leads table in Airtable, setup task T12)`;
  if (!/^app[A-Za-z0-9]{3,40}$/.test(baseId)) return `${AIRTABLE_BASE_ENV} is not a base id (app…)`;
  if (table.length > 100) return `${AIRTABLE_TABLE_ENV} is too long for a table id or name`;
  return { token, baseId, table, fetch: fetchFn, pause };
}

const shortMessage = (e: unknown): string => {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
};

const FAILURES: Record<number, string> = {
  401: 'the token was refused',
  403: 'the token may not read this base',
  404: 'the base or table was not found',
  422: 'the request was refused; a field in LEAD_FIELDS may not match the table',
  429: 'rate limited: Airtable asks for 30 seconds before the next call',
};

/** Why a call failed: the status, Airtable's error type (an upper-case code) and a short, single-line message.
 *  Airtable's messages name fields or formula parts, never record values; the token is never in them. */
async function failureOf(response: Response): Promise<string> {
  let type = '';
  let message = '';
  try {
    const body = (await response.json()) as { error?: unknown };
    const error = body.error;
    if (typeof error === 'string') type = error;
    else if (error !== null && typeof error === 'object') {
      const e = error as { type?: unknown; message?: unknown };
      if (typeof e.type === 'string') type = e.type;
      if (typeof e.message === 'string') message = e.message;
    }
  } catch {
    // no JSON body
  }
  const code = /^[A-Z][A-Z0-9_]{0,59}$/.test(type) ? ` ${type}` : '';
  const said = message === '' ? '' : `: ${message.replace(/\s+/g, ' ').slice(0, 160)}`;
  return `HTTP ${response.status}${code} (${FAILURES[response.status] ?? 'Airtable returned an error'})${said}`;
}

/** Every record the formula selects, page by page: one call at a time, paced under Airtable's 5 a second per base.
 *  A 429 (other traffic on the base) fails the read; the next cycle reads again. */
async function listRecords(
  source: Source,
  query: { filterByFormula: string; fields: readonly string[] },
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await source.pause(PAGE_PAUSE_MS);
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), filterByFormula: query.filterByFormula });
    for (const field of query.fields) params.append('fields[]', field);
    if (offset !== undefined) params.set('offset', offset);
    const url = `${AIRTABLE_API}/${encodeURIComponent(source.baseId)}/${encodeURIComponent(source.table)}?${params.toString()}`;
    let response: Response;
    try {
      response = await source.fetch(url, {
        headers: { Authorization: `Bearer ${source.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new AirtableSourceError(`Airtable did not answer (${shortMessage(e)})`);
    }
    if (!response.ok) throw new AirtableSourceError(`reading Airtable failed: ${await failureOf(response)}`);
    const parsed = ListResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AirtableSourceError('Airtable answered in an unexpected shape');
    records.push(...parsed.data.records);
    offset = parsed.data.offset;
    if (offset === undefined) return records;
  }
  throw new AirtableSourceError(`more than ${MAX_PAGES * PAGE_SIZE} records matched: paging stopped`);
}

/** A formula time: Airtable parses ISO 8601. The value comes from a Date, never from outside. */
const formulaTime = (at: Date): string => `DATETIME_PARSE('${at.toISOString()}')`;

/** The records that may hold an outcome since `since`: created since then (IS_AFTER is strict, so a second
 *  early; the adapter filters exactly), or with a viewing or booking day at all (few, so read every time). */
export const sinceFormula = (since: Date): string =>
  `OR(IS_AFTER(CREATED_TIME(), ${formulaTime(new Date(since.getTime() - 1000))}), ` +
  `{${LEAD_FIELDS.qualifiedViewingOn}}, {${LEAD_FIELDS.bookedOn}})`;

/** A test or internal lead (D-059): an email domain in the settings list, or a subdomain of one. */
export function isTestEmail(email: string, testDomains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  const domain = (at < 0 ? '' : email.slice(at + 1)).trim().toLowerCase();
  if (domain === '') return false;
  return testDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** The ids the form's hidden fields captured. `utm_campaign`, `sp_agid` and `sp_adid` carry the platform's own
 *  ids (the ad URL settings); a value that isn't an id (a campaign name, say) stays only as `utmCampaign`. Meta's
 *  click cookie is rebuilt from `fbclid` in its documented format, timed at the form fill. */
export function idsFromFields(fields: Record<string, unknown>, filledAt: Date): ClickAndPlatformIds {
  const text = (key: string, max: number): string | undefined => {
    const v = fields[key];
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t !== '' && t.length <= max ? t : undefined;
  };
  const id = (key: string): string | undefined => {
    const v = text(key, VALUE_MAX);
    return v !== undefined && PLATFORM_ID.test(v) ? v : undefined;
  };
  const fbclid = text(LEAD_FIELDS.fbclid, CLICK_ID_MAX);
  const ids: Record<string, string | undefined> = {
    gclid: text(LEAD_FIELDS.gclid, CLICK_ID_MAX),
    gbraid: text(LEAD_FIELDS.gbraid, CLICK_ID_MAX),
    wbraid: text(LEAD_FIELDS.wbraid, CLICK_ID_MAX),
    fbclid,
    fbc: fbclid === undefined ? undefined : `fb.1.${filledAt.getTime()}.${fbclid}`,
    utmSource: text(LEAD_FIELDS.utmSource, VALUE_MAX),
    utmMedium: text(LEAD_FIELDS.utmMedium, VALUE_MAX),
    utmCampaign: text(LEAD_FIELDS.utmCampaign, VALUE_MAX),
  };
  const platform = platformOfUtmSource(ids['utmSource']);
  if (platform === 'google') {
    ids['googleCampaignId'] = id(LEAD_FIELDS.utmCampaign);
    ids['googleAdGroupId'] = id(LEAD_FIELDS.adGroupId);
  } else if (platform === 'meta') {
    ids['metaCampaignId'] = id(LEAD_FIELDS.utmCampaign);
    ids['metaAdSetId'] = id(LEAD_FIELDS.adGroupId);
    ids['metaAdId'] = id(LEAD_FIELDS.adId);
  }
  return Object.fromEntries(Object.entries(ids).filter(([, v]) => v !== undefined));
}

/** A stage's time from a date field (`YYYY-MM-DD`, the start of that day in Singapore) or a date-and-time field
 *  (ISO with a zone); null when empty or not a time. */
function stageTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const day = singaporeDayStart(value);
  if (day !== null) return day;
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
}

const STAGE_FIELDS = [
  ['qualified_viewing', LEAD_FIELDS.qualifiedViewingOn],
  ['booked', LEAD_FIELDS.bookedOn],
] as const;

/** A record's outcomes: the form fill, plus each later stage whose day has come. A record without a valid
 *  creation time gives none (it can't be placed in time). */
function eventsOf(record: AirtableRecord, testDomains: readonly string[], now: Date): OutcomeEvent[] {
  const filledAt = new Date(record.createdTime);
  if (!Number.isFinite(filledAt.getTime())) return [];
  const email = record.fields[LEAD_FIELDS.email];
  const raw = typeof email === 'string' ? email : '';
  const hashed = hashEmail(raw);
  const common = {
    sourceId: record.id,
    isTest: isTestEmail(raw, testDomains),
    ids: idsFromFields(record.fields, filledAt),
    ...(Object.keys(hashed).length === 0 ? {} : { hashedContact: hashed }),
  };
  const events: OutcomeEvent[] = [{ ...common, stage: 'form_fill', occurredAt: filledAt.toISOString() }];
  for (const [stage, field] of STAGE_FIELDS) {
    const at = stageTime(record.fields[field]);
    if (at !== null && at.getTime() <= now.getTime()) events.push({ ...common, stage, occurredAt: at.toISOString() });
  }
  return events;
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
/** Oldest first (every time is a `toISOString()`, so text order is time order), then by stage and source id. */
const byTimeStageSource = (a: OutcomeEvent, b: OutcomeEvent): number =>
  cmp(a.occurredAt, b.occurredAt) || cmp(a.stage, b.stage) || cmp(a.sourceId, b.sourceId);

export interface AirtableAdapterOptions {
  /** Replaces the network in tests. */
  fetch?: typeof fetch;
  /** Replaces the pause between page requests in tests. */
  pause?: (ms: number) => Promise<void>;
  /** Replaces the clock in tests. */
  now?: () => Date;
}

/** The adapter for one product's settings (they carry the test-traffic domains). */
export function airtableAdapter(
  env: Readonly<Record<string, string | undefined>>,
  settings: ProductSettings,
  opts: AirtableAdapterOptions = {},
): OutcomeAdapter {
  const pause = opts.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const source = sourceFrom(env, opts.fetch ?? globalThis.fetch, pause);
  const now = opts.now ?? (() => new Date());
  const testDomains = settings.testTraffic.emailDomains;

  return {
    async fetchSince(since: Date, limit = DEFAULT_LIMIT): Promise<OutcomeEvent[]> {
      if (typeof source === 'string') throw new AirtableSourceError(source);
      const records = await listRecords(source, {
        filterByFormula: sinceFormula(since),
        fields: Object.values(LEAD_FIELDS),
      });
      const at = now();
      return records
        .flatMap((r) => eventsOf(r, testDomains, at))
        .filter((e) => Date.parse(e.occurredAt) >= since.getTime())
        .sort(byTimeStageSource)
        .slice(0, limit);
    },
    async healthcheck() {
      if (typeof source === 'string') return { ok: false, detail: source };
      const from = new Date(now().getTime() - HEALTH_WINDOW_DAYS * 86_400_000);
      try {
        // Only a non-personal field: the check needs the creation times.
        const records = await listRecords(source, {
          filterByFormula: `IS_AFTER(CREATED_TIME(), ${formulaTime(from)})`,
          fields: [LEAD_FIELDS.utmSource],
        });
        const latest = Math.max(...records.map((r) => Date.parse(r.createdTime)).filter(Number.isFinite));
        return Number.isFinite(latest)
          ? { ok: true, latestActivityAt: new Date(latest) }
          : { ok: true, detail: `no form fills in the last ${HEALTH_WINDOW_DAYS} days` };
      } catch (e) {
        return { ok: false, detail: `cannot read Airtable: ${shortMessage(e)}` };
      }
    },
  };
}
