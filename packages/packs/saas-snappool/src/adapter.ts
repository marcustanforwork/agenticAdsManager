// The SnapPool outcome adapter (BLUEPRINT M05a, SNAPPOOL-TRACKING §2 and §4). It reads SnapPool's database with a
// read-only connection (setup task T6a, env SNAPPOOL_DATABASE_URL), in a READ ONLY transaction, and emits one
// outcome per stage:
//   pool_request  a /start request              pool_requests.created_at   source id pool_requests.id
//   signup        that request claimed          pool_requests.claimed_at   source id pool_requests.id
//   activated     the first photo in its pool   events.first_upload_at     source id events.id
// Only claimed /start requests count as signups: hosts who arrive any other way aren't acquisitions.
//
// Personal data stays here (BLUEPRINT §5.18): the email is hashed inside this file and the raw value is never
// returned, logged or put in an error. The attribution cookie and headers SnapPool stores came from the visitor's
// browser: they're untrusted data, copied into fixed fields after length checks, never interpreted.
import {
  type ClickAndPlatformIds,
  type OutcomeAdapter,
  type OutcomeEvent,
  type ProductSettings,
  type WebContext,
  hashEmail,
} from '@ads/contracts';
import pg from 'pg';

export const DATABASE_URL_ENV = 'SNAPPOOL_DATABASE_URL';

/** Whether the request's email belongs to the superadmin (SnapPool stores emails lower-cased; compared case-blind).
 *  Evaluated per selected row only. */
const IS_SUPERADMIN = `coalesce((select bool_or(h.is_superadmin) from hosts h where lower(h.email) = lower(pr.email)), false)`;

/** Every outcome since $1, oldest first, at most $2 rows. Each part filters on its own time column first, so a read
 *  touches only the window, not SnapPool's whole history. */
export const OUTCOMES_SQL = `
select 'pool_request' as stage, pr.id::text as source_id, pr.created_at as occurred_at,
       pr.email, ${IS_SUPERADMIN} as is_superadmin, pr.attribution, pr.user_agent, pr.page_url
  from pool_requests pr
 where pr.created_at >= $1
union all
select 'signup', pr.id::text, pr.claimed_at,
       pr.email, ${IS_SUPERADMIN}, pr.attribution, pr.user_agent, pr.page_url
  from pool_requests pr
 where pr.status = 'claimed' and pr.claimed_at >= $1
union all
select 'activated', e.id::text, e.first_upload_at,
       pr.email, ${IS_SUPERADMIN}, pr.attribution, pr.user_agent, pr.page_url
  from events e
  join pool_requests pr on pr.event_id = e.id and pr.status = 'claimed'
 where e.first_upload_at >= $1
order by occurred_at, stage, source_id
limit $2`;

/** The latest activity: the newest /start request or claim. */
export const LATEST_ACTIVITY_SQL = `
select greatest(max(created_at), max(claimed_at)) as latest from pool_requests`;

export const DEFAULT_LIMIT = 5000;
const STATEMENT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

interface OutcomeRow {
  stage: 'pool_request' | 'signup' | 'activated';
  source_id: string;
  occurred_at: Date;
  email: string;
  is_superadmin: boolean;
  attribution: unknown;
  user_agent: string | null;
  page_url: string | null;
}

const META_SOURCES = new Set(['meta', 'facebook', 'instagram', 'fb', 'ig']);
const CLICK_ID_MAX = 512; // SnapPool keeps click ids whole up to 512 characters
const VALUE_MAX = 255; // and truncates other values to 255
const PLATFORM_ID = /^\d{1,30}$/;

/** The ids SnapPool saved with the request (its `sp_attr` cookie, SNAPPOOL-TRACKING §3.1–3.3). `utm_campaign`
 *  and `sp_agid`/`sp_adid` carry the platform's own ids (the ad URL settings, T14); a value that isn't an id
 *  (a campaign name, say) stays only as `utmCampaign`. */
export function idsFromAttribution(attribution: unknown): ClickAndPlatformIds {
  if (attribution === null || typeof attribution !== 'object' || Array.isArray(attribution)) return {};
  const a = attribution as Record<string, unknown>;
  const text = (key: string, max: number): string | undefined => {
    const v = a[key];
    return typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : undefined;
  };
  const id = (key: string): string | undefined => {
    const v = text(key, VALUE_MAX);
    return v !== undefined && PLATFORM_ID.test(v) ? v : undefined;
  };
  const ids: Record<string, string | undefined> = {
    gclid: text('gclid', CLICK_ID_MAX),
    gbraid: text('gbraid', CLICK_ID_MAX),
    wbraid: text('wbraid', CLICK_ID_MAX),
    fbclid: text('fbclid', CLICK_ID_MAX),
    fbc: text('fbc', CLICK_ID_MAX + 64),
    utmSource: text('utm_source', VALUE_MAX),
    utmMedium: text('utm_medium', VALUE_MAX),
    utmCampaign: text('utm_campaign', VALUE_MAX),
  };
  const source = ids['utmSource']?.toLowerCase();
  if (source === 'google') {
    ids['googleCampaignId'] = id('utm_campaign');
    ids['googleAdGroupId'] = id('sp_agid');
  } else if (source !== undefined && META_SOURCES.has(source)) {
    ids['metaCampaignId'] = id('utm_campaign');
    ids['metaAdSetId'] = id('sp_agid');
    ids['metaAdId'] = id('sp_adid');
  }
  const present: ClickAndPlatformIds = Object.fromEntries(Object.entries(ids).filter(([, v]) => v !== undefined));
  return present;
}

/** The browser context SnapPool captured at /start (Meta needs both for website events). */
export function webFrom(userAgent: string | null, pageUrl: string | null): WebContext | undefined {
  const web: WebContext = {};
  if (userAgent !== null && userAgent.trim() !== '') web.userAgent = userAgent.slice(0, 512);
  if (pageUrl !== null && pageUrl.trim() !== '') web.pageUrl = pageUrl.slice(0, 1024);
  return Object.keys(web).length === 0 ? undefined : web;
}

/** A test or internal signup (D-059): an email domain in the settings list (or a subdomain of one), or the
 *  superadmin. */
export function isTestEmail(email: string, testDomains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  const domain = (at < 0 ? '' : email.slice(at + 1)).trim().toLowerCase();
  if (domain === '') return false;
  return testDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** An error message without a connection string in it (pg errors don't carry the password, but be sure). */
const safeMessage = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/postgres(?:ql)?:\/\/\S+/gi, '<database url>');

export class SnapPoolSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapPoolSourceError';
  }
}

async function readOnly<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: url,
    application_name: 'ads-agent-snappool',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // A dropped connection emits 'error' on the client; without a listener it would crash the process.
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await run(client);
    await client.query('commit');
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** The adapter for one product's settings (they carry the test-traffic domains). */
export function snapPoolAdapter(
  env: Readonly<Record<string, string | undefined>>,
  settings: ProductSettings,
): OutcomeAdapter {
  const url = env[DATABASE_URL_ENV];
  const missing = `${DATABASE_URL_ENV} is not set (the read-only SnapPool connection string, setup task T6a)`;
  const testDomains = settings.testTraffic.emailDomains;

  const toEvent = (row: OutcomeRow): OutcomeEvent => {
    const ids = idsFromAttribution(row.attribution);
    const web = webFrom(row.user_agent, row.page_url);
    const hashed = hashEmail(row.email);
    return {
      sourceId: row.source_id,
      stage: row.stage,
      occurredAt: row.occurred_at.toISOString(),
      isTest: row.is_superadmin || isTestEmail(row.email, testDomains),
      ids,
      ...(Object.keys(hashed).length === 0 ? {} : { hashedContact: hashed }),
      ...(web === undefined ? {} : { web }),
    };
  };

  return {
    async fetchSince(since: Date, limit = DEFAULT_LIMIT): Promise<OutcomeEvent[]> {
      if (url === undefined || url === '') throw new SnapPoolSourceError(missing);
      try {
        const rows = await readOnly(url, async (c) => (await c.query<OutcomeRow>(OUTCOMES_SQL, [since, limit])).rows);
        return rows.map(toEvent);
      } catch (e) {
        throw new SnapPoolSourceError(`reading SnapPool failed: ${safeMessage(e)}`);
      }
    },
    async healthcheck() {
      if (url === undefined || url === '') return { ok: false, detail: missing };
      try {
        const latest = await readOnly(
          url,
          async (c) => (await c.query<{ latest: Date | null }>(LATEST_ACTIVITY_SQL)).rows[0]?.latest ?? null,
        );
        return latest === null
          ? { ok: true, detail: 'no /start requests yet' }
          : { ok: true, latestActivityAt: latest };
      } catch (e) {
        return { ok: false, detail: `cannot read SnapPool: ${safeMessage(e)}` };
      }
    },
  };
}
