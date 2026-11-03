// The SnapPool outcome adapter (BLUEPRINT M05a and F4, SNAPPOOL-TRACKING §2, §2.1 and §4). It reads SnapPool's
// database with a read-only connection (setup task T6a, env SNAPPOOL_DATABASE_URL), in a READ ONLY transaction, and
// emits one outcome per stage:
//   pool_request  a /start request                         pool_requests.created_at       source id pool_requests.id
//   signup        that request claimed                     pool_requests.claimed_at       source id pool_requests.id
//   activated     the first photo in its pool              events.first_upload_at         source id events.id
//   card_saved    a paid plan chosen at /start, card saved deferred_event_charges.saved_at, or an onboarding
//                                                          subscription's created_at      source id the charge's or
//                                                                                         the subscription's id
//   paid          a host's first paid, live order          orders.paid_at, with its value source id orders.id
//   refunded      a counted refund on that order           refunds.created_at, its value  source id refunds.id
// Only claimed /start requests count as signups: hosts who arrive any other way aren't acquisitions. A purchase's
// ad click is the order's own (checkout), else the /start request its onboarding charge or subscription points to,
// else the host's latest claimed /start request with a click made before the purchase (D-096). The purchase tables
// are read through a column-level grant (`grant.ts`): this file's SQL may name only those columns.
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
  microsPerMinorUnit,
  platformOfUtmSource,
} from '@ads/contracts';
import pg from 'pg';

export const DATABASE_URL_ENV = 'SNAPPOOL_DATABASE_URL';

/** Whether the request's email belongs to the superadmin (SnapPool stores emails lower-cased; compared case-blind).
 *  Evaluated per selected row only. */
const IS_SUPERADMIN = `coalesce((select bool_or(h.is_superadmin) from hosts h where lower(h.email) = lower(pr.email)), false)`;

/** A host's first paid, live order (D-096): one per customer, over SnapPool's whole history, so a renewal, a tier
 *  change or an add-on in the window is never taken for a first purchase. Free grants (no `paid_at`, amount 0) and
 *  test-mode orders are left out. */
const FIRST_PAID = `
select distinct on (o.host_id) o.id, o.host_id, o.paid_at, o.amount_minor, o.currency, o.attribution,
       o.subscription_id, o.deferred_charge_id
  from orders o
 where o.livemode and o.paid_at is not null and o.amount_minor > 0
 order by o.host_id, o.paid_at, o.id`;

/** The purchase events since $1, each with its host, the /start request it came through (if any), its own click
 *  (checkout orders), and the time before which a fallback click must have been made. An onboarding subscription
 *  has no time its card was saved: its row is made when the plan is chosen at /start, minutes before (`awaiting_card`
 *  until the card is saved; `abandoned` if it never is). Refunds SnapPool doesn't count (failed or canceled) are
 *  left out, as SnapPool's own sums do. */
const PURCHASES = `
select 'card_saved' as stage, d.id::text as source_id, d.saved_at as occurred_at, d.host_id, d.pool_request_id,
       null::jsonb as own_attribution, d.saved_at as clicked_before, null::bigint as value_minor, null::text as currency
  from deferred_event_charges d
 where d.livemode and d.saved_at >= $1
union all
select 'card_saved', b.id::text, b.created_at, b.host_id, b.pool_request_id, null, b.created_at, null, null
  from billing_subscriptions b
 where b.livemode and b.pool_request_id is not null and b.status not in ('awaiting_card', 'abandoned')
   and b.created_at >= $1
union all
select 'paid', p.id::text, p.paid_at, p.host_id, coalesce(d.pool_request_id, b.pool_request_id), p.attribution,
       p.paid_at, p.amount_minor, p.currency
  from first_paid p
  left join deferred_event_charges d on d.id = p.deferred_charge_id
  left join billing_subscriptions b on b.id = p.subscription_id
 where p.paid_at >= $1
union all
select 'refunded', r.id::text, r.created_at, p.host_id, coalesce(d.pool_request_id, b.pool_request_id), p.attribution,
       p.paid_at, r.amount_minor, r.currency
  from refunds r
  join first_paid p on p.id = r.order_id
  left join deferred_event_charges d on d.id = p.deferred_charge_id
  left join billing_subscriptions b on b.id = p.subscription_id
 where r.created_at >= $1 and lower(r.status) not in ('failed', 'canceled', 'cancelled')`;

/** The request a purchase's click came from: the linked /start request when it has a click, else the host's latest
 *  claimed one with a click; its browser context goes with it (Meta needs both for a website event). */
const FROM_LINKED = `linked.attribution is not null or latest.attribution is null`;

/** Every outcome since $1, oldest first, at most $2 rows. Each part filters on its own time column first, so a read
 *  touches only the window, not SnapPool's whole history (except the first-paid order per host, which needs it). */
export const OUTCOMES_SQL = `
with first_paid as (${FIRST_PAID}),
purchases as (${PURCHASES})
select 'pool_request' as stage, pr.id::text as source_id, pr.created_at as occurred_at,
       pr.email, ${IS_SUPERADMIN} as is_superadmin, pr.attribution, pr.user_agent, pr.page_url,
       null::bigint as value_minor, null::text as currency
  from pool_requests pr
 where pr.created_at >= $1
union all
select 'signup', pr.id::text, pr.claimed_at,
       pr.email, ${IS_SUPERADMIN}, pr.attribution, pr.user_agent, pr.page_url, null, null
  from pool_requests pr
 where pr.status = 'claimed' and pr.claimed_at >= $1
union all
select 'activated', e.id::text, e.first_upload_at,
       pr.email, ${IS_SUPERADMIN}, pr.attribution, pr.user_agent, pr.page_url, null, null
  from events e
  join pool_requests pr on pr.event_id = e.id and pr.status = 'claimed'
 where e.first_upload_at >= $1
union all
select m.stage, m.source_id, m.occurred_at, h.email, h.is_superadmin,
       coalesce(m.own_attribution, linked.attribution, latest.attribution),
       case when ${FROM_LINKED} then linked.user_agent else latest.user_agent end,
       case when ${FROM_LINKED} then linked.page_url else latest.page_url end,
       m.value_minor, m.currency
  from purchases m
  join hosts h on h.id = m.host_id
  left join pool_requests linked on linked.id = m.pool_request_id
  left join lateral (
    select pr.attribution, pr.user_agent, pr.page_url
      from pool_requests pr
     where lower(pr.email) = lower(h.email) and pr.status = 'claimed' and pr.attribution is not null
       and pr.created_at <= m.clicked_before
     order by pr.created_at desc, pr.id desc
     limit 1
  ) latest on true
order by occurred_at, stage, source_id
limit $2`;

/** The latest activity: the newest /start request or claim. */
export const LATEST_ACTIVITY_SQL = `
select greatest(max(created_at), max(claimed_at)) as latest from pool_requests`;

export const DEFAULT_LIMIT = 5000;
const STATEMENT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

interface OutcomeRow {
  stage: 'pool_request' | 'signup' | 'activated' | 'card_saved' | 'paid' | 'refunded';
  source_id: string;
  occurred_at: Date;
  email: string;
  is_superadmin: boolean;
  attribution: unknown;
  user_agent: string | null;
  page_url: string | null;
  /** In the currency's minor unit (cents for SGD); pg returns a bigint as a string. Purchases only. */
  value_minor: string | null;
  currency: string | null;
}

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
  const platform = platformOfUtmSource(ids['utmSource']);
  if (platform === 'google') {
    ids['googleCampaignId'] = id('utm_campaign');
    ids['googleAdGroupId'] = id('sp_agid');
  } else if (platform === 'meta') {
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

const CURRENCY = /^[A-Za-z]{3}$/;

/** A payment's value as the contract carries it: micros in the payment's currency (SGD 2900 cents → "29000000").
 *  Nothing when either part is missing or isn't what SnapPool writes. */
export function valueFrom(
  minor: string | null,
  currency: string | null,
): { valueMicros: string; currency: string } | undefined {
  if (minor === null || currency === null || !CURRENCY.test(currency) || !/^\d{1,15}$/.test(minor)) return undefined;
  const code = currency.toUpperCase();
  return { valueMicros: (BigInt(minor) * microsPerMinorUnit(code)).toString(), currency: code };
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

/** Postgres's "insufficient privilege": the read-only login lacks a grant, most likely the purchases one (F4). */
const grantHint = (e: unknown): string =>
  (e as { code?: unknown } | null)?.code === '42501'
    ? " (the agent's login can't read it: run the purchases grant on SnapPool's database, F4)"
    : '';

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
    const value = valueFrom(row.value_minor, row.currency);
    return {
      sourceId: row.source_id,
      stage: row.stage,
      occurredAt: row.occurred_at.toISOString(),
      ...(value ?? {}),
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
        throw new SnapPoolSourceError(`reading SnapPool failed: ${safeMessage(e)}${grantHint(e)}`);
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
