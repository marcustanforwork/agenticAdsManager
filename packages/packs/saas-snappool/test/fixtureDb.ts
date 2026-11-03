// A throwaway Postgres database shaped like SnapPool's (the columns the adapter reads, with SnapPool's real names
// and types: lib/db/schema.ts at SnapPool commit 34d3473, 2026-10-06; the purchase tables at 2e0c8a2, 2026-11-03,
// with some of the columns the agent must never read, to prove the grant keeps them out), filled with fixture rows.
// The fixture emails are made up. Needs the test Postgres (cloud: `pg_ctlcluster 16 main start`; CI:
// TEST_DATABASE_URL).
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const ADMIN_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export const SNAPPOOL_SCHEMA = `
create table hosts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now()
);
create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  host_id uuid not null references hosts(id),
  title text not null,
  first_upload_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now()
);
create table pool_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  title text not null,
  event_type text not null,
  status text not null default 'pending',
  event_id uuid references events(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attribution jsonb,
  user_agent text,
  page_url text
);
create unique index pool_requests_pending_email_unique on pool_requests (email) where status = 'pending';
create table orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 100001) unique,
  host_id uuid not null references hosts(id),
  kind text not null,
  event_id uuid,
  "grant" jsonb not null default '{}',
  currency text not null,
  amount_minor integer not null,
  list_minor integer not null default 0,
  pricing_phase text not null default 'standard',
  status text not null default 'pending',
  buyer_country text,
  attribution jsonb,
  livemode boolean not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  fee_minor integer,
  net_minor integer,
  subscription_id uuid,
  deferred_charge_id uuid,
  comped_by uuid
);
create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  provider text not null default 'hitpay',
  provider_ref text not null,
  currency text not null,
  amount_minor integer not null,
  status text not null,
  created_at timestamptz not null default now()
);
create table deferred_event_charges (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references hosts(id),
  pool_request_id uuid not null,
  event_id uuid,
  plan text not null,
  provider text not null default 'hitpay',
  livemode boolean not null,
  status text not null default 'awaiting_card',
  card_ref text,
  card_url text,
  currency text not null,
  amount_minor integer not null,
  list_minor integer not null default 0,
  charge_at timestamptz not null,
  created_at timestamptz not null default now(),
  saved_at timestamptz
);
create table billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references hosts(id),
  provider text not null default 'hitpay',
  tier text not null,
  cadence text not null,
  status text not null default 'awaiting_card',
  livemode boolean not null,
  card_ref text,
  card_url text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  pool_request_id uuid
);
`;

export interface FixtureDb {
  url: string;
  query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
  drop: () => Promise<void>;
}

export async function createFixtureDb(): Promise<FixtureDb> {
  const name = `snappool_fixture_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `Cannot reach the test Postgres (${(e as Error).message}). Start it (cloud: pg_ctlcluster 16 main start) or set TEST_DATABASE_URL.`,
      { cause: e },
    );
  }
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(SNAPPOOL_SCHEMA);
  return {
    url: url.toString(),
    query: (sql, params) => client.query(sql, params),
    async drop() {
      await client.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** Fixture ids, so tests can name rows. */
export const ID = {
  hostAlice: '00000000-0000-4000-8000-0000000000a1',
  hostAdmin: '00000000-0000-4000-8000-0000000000a2',
  hostCarol: '00000000-0000-4000-8000-0000000000a3',
  eventAlice: '00000000-0000-4000-8000-0000000000e1',
  eventCarol: '00000000-0000-4000-8000-0000000000e3',
  eventAdmin: '00000000-0000-4000-8000-0000000000e4',
  reqAlice: '00000000-0000-4000-8000-000000000001',
  reqBob: '00000000-0000-4000-8000-000000000002',
  reqCarol: '00000000-0000-4000-8000-000000000003',
  reqAdmin: '00000000-0000-4000-8000-000000000004',
  reqOld: '00000000-0000-4000-8000-000000000005',
  reqDave: '00000000-0000-4000-8000-000000000006',
  reqEve: '00000000-0000-4000-8000-000000000007',
  // Purchases (seedPurchases)
  hostFrank: '00000000-0000-4000-8000-0000000000b1',
  hostGrace: '00000000-0000-4000-8000-0000000000b2',
  hostHenry: '00000000-0000-4000-8000-0000000000b3',
  hostIvy: '00000000-0000-4000-8000-0000000000b4',
  hostJack: '00000000-0000-4000-8000-0000000000b5',
  reqGrace: '00000000-0000-4000-8000-000000000011',
  reqHenryOld: '00000000-0000-4000-8000-000000000012',
  reqHenryNew: '00000000-0000-4000-8000-000000000013',
  reqHenryAfter: '00000000-0000-4000-8000-000000000014',
  reqJack: '00000000-0000-4000-8000-000000000015',
  chargeAlice: '00000000-0000-4000-8000-0000000000c1',
  chargeJackTest: '00000000-0000-4000-8000-0000000000c2',
  chargeJackOpen: '00000000-0000-4000-8000-0000000000c3',
  subGrace: '00000000-0000-4000-8000-0000000000d1',
  subHenry: '00000000-0000-4000-8000-0000000000d2',
  subJackAbandoned: '00000000-0000-4000-8000-0000000000d3',
  orderFrank: '00000000-0000-4000-8000-0000000000f1',
  orderFrankAddOn: '00000000-0000-4000-8000-0000000000f2',
  orderAlice: '00000000-0000-4000-8000-0000000000f3',
  orderGrace: '00000000-0000-4000-8000-0000000000f4',
  orderGraceRenewal: '00000000-0000-4000-8000-0000000000f5',
  orderHenry: '00000000-0000-4000-8000-0000000000f6',
  orderIvyOld: '00000000-0000-4000-8000-0000000000f7',
  orderIvy: '00000000-0000-4000-8000-0000000000f8',
  orderJackSandbox: '00000000-0000-4000-8000-0000000000f9',
  orderJackComp: '00000000-0000-4000-8000-0000000000fa',
  orderJackPending: '00000000-0000-4000-8000-0000000000fb',
  orderCarol: '00000000-0000-4000-8000-0000000000fc',
  orderAdmin: '00000000-0000-4000-8000-0000000000fd',
  refundFrank: '00000000-0000-4000-8000-0000000000e9',
  refundFrankFailed: '00000000-0000-4000-8000-0000000000ea',
  refundFrankAddOn: '00000000-0000-4000-8000-0000000000eb',
} as const;

/** Every email in the fixtures: none may ever appear in what the adapter returns. */
export const FIXTURE_EMAILS = [
  'alice@example.com',
  'b.ob@gmail.com',
  'carol@team.staff.example',
  'admin@example.org',
  'old@example.com',
  'dave@example.net',
  'eve@example.com',
  'frank@example.com',
  'grace@example.net',
  'henry@example.org',
  'ivy@example.com',
  'jack@example.net',
];

export const GOOGLE_ATTRIBUTION = {
  gclid: 'Cj0KCQjw-test-gclid',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: '12345678901',
  sp_agid: '5555',
  landing_url: '/?utm_source=google&utm_campaign=12345678901&gclid=Cj0KCQjw-test-gclid',
  captured_at: '2026-10-01T01:58:00.000Z',
};
export const META_ATTRIBUTION = {
  fbclid: 'IwAR-test-fbclid',
  fbc: 'fb.1.1759370000000.IwAR-test-fbclid',
  utm_source: 'meta',
  utm_medium: 'paid_social',
  utm_campaign: '120200000001',
  sp_agid: '120200000002',
  sp_adid: '120200000003',
  utm_content: 'not-a-click-id',
  landing_url: '/start',
  captured_at: '2026-10-02T02:59:00.000Z',
};

export async function seedFixtures(db: FixtureDb): Promise<void> {
  const host = (id: string, email: string, superadmin = false) =>
    db.query('insert into hosts (id, email, is_superadmin) values ($1, $2, $3)', [id, email, superadmin]);
  await host(ID.hostAlice, 'alice@example.com');
  await host(ID.hostAdmin, 'admin@example.org', true);
  await host(ID.hostCarol, 'carol@team.staff.example');
  const event = (id: string, hostId: string, slug: string, firstUpload: string | null) =>
    db.query('insert into events (id, host_id, slug, title, first_upload_at) values ($1, $2, $3, $4, $5)', [
      id,
      hostId,
      slug,
      'Pool',
      firstUpload,
    ]);
  await event(ID.eventAlice, ID.hostAlice, 'alice-wedding', '2026-10-04T09:00:00Z');
  await event(ID.eventCarol, ID.hostCarol, 'carol-test', null);
  await event(ID.eventAdmin, ID.hostAdmin, 'admin-party', '2026-10-03T08:00:00Z');

  const request = (r: {
    id: string;
    email: string;
    status?: string;
    eventId?: string;
    createdAt: string;
    claimedAt?: string;
    attribution?: unknown;
    userAgent?: string;
    pageUrl?: string;
  }) =>
    db.query(
      `insert into pool_requests (id, email, title, event_type, status, event_id, created_at, claimed_at,
                                  attribution, user_agent, page_url)
       values ($1, $2, 'My event', 'wedding', $3, $4, $5, $6, $7, $8, $9)`,
      [
        r.id,
        r.email,
        r.status ?? 'pending',
        r.eventId ?? null,
        r.createdAt,
        r.claimedAt ?? null,
        r.attribution === undefined ? null : JSON.stringify(r.attribution),
        r.userAgent ?? null,
        r.pageUrl ?? null,
      ],
    );
  await request({
    id: ID.reqAlice,
    email: 'alice@example.com',
    status: 'claimed',
    eventId: ID.eventAlice,
    createdAt: '2026-10-01T02:00:00Z',
    claimedAt: '2026-10-01T02:10:00Z',
    attribution: GOOGLE_ATTRIBUTION,
    userAgent: 'Mozilla/5.0 (fixture)',
    pageUrl: 'https://www.snappool.photos/start?utm_source=google',
  });
  await request({
    id: ID.reqBob,
    email: 'b.ob@gmail.com',
    createdAt: '2026-10-02T03:00:00Z',
    attribution: META_ATTRIBUTION,
    userAgent: 'Mozilla/5.0 (fixture phone)',
    pageUrl: 'https://www.snappool.photos/start',
  });
  await request({
    id: ID.reqCarol,
    email: 'carol@team.staff.example',
    status: 'claimed',
    eventId: ID.eventCarol,
    createdAt: '2026-10-02T04:00:00Z',
    claimedAt: '2026-10-02T05:00:00Z',
  });
  await request({
    id: ID.reqAdmin,
    email: 'admin@example.org',
    status: 'claimed',
    eventId: ID.eventAdmin,
    createdAt: '2026-10-03T01:00:00Z',
    claimedAt: '2026-10-03T01:05:00Z',
    attribution: { fbclid: 'IwAR-admin', landing_url: '/', captured_at: '2026-10-03T00:59:00Z' },
  });
  await request({ id: ID.reqOld, email: 'old@example.com', createdAt: '2026-08-01T00:00:00Z' });
  await request({
    id: ID.reqDave,
    email: 'dave@example.net',
    createdAt: '2026-10-03T06:00:00Z',
    attribution: {
      gclid: 123,
      utm_source: 'Google',
      utm_campaign: 'Brand Campaign',
      landing_url: '/',
      captured_at: 'x',
    },
  });
  await request({ id: ID.reqEve, email: 'eve@example.com', createdAt: '2026-10-04T05:00:00Z', attribution: ['odd'] });
}

/** The purchases (SNAPPOOL-TRACKING §2.1), from 2026-10-10 on, one host per path:
 *  - Frank: checkout from the dashboard, the click on the order (Meta); an add-on later (not a new customer); a
 *    refund on the first order (counted), a failed one (left out) and one on the add-on (not a first order).
 *  - Alice: one event chosen at /start onboarding (her claimed Google request), card saved, then charged: no click on
 *    the order, so it comes through the charge's request.
 *  - Grace: a subscription chosen at onboarding (Meta request), its first term and a renewal (left out).
 *  - Henry: a subscription started later from the dashboard: the click is his latest claimed /start request with one
 *    made before the purchase (not the older one, not the one after).
 *  - Ivy: her first paid order was in August, before the window: October's order is not a new customer.
 *  - Jack: what is left out: a test-mode charge and order, a comp (fulfilled, no payment, amount 0), an unpaid order,
 *    a charge whose card isn't saved yet, an abandoned onboarding subscription.
 *  - Carol (a test domain) and the superadmin: paid, as test traffic. */
export async function seedPurchases(db: FixtureDb): Promise<void> {
  const host = (id: string, email: string) => db.query('insert into hosts (id, email) values ($1, $2)', [id, email]);
  await host(ID.hostFrank, 'frank@example.com');
  await host(ID.hostGrace, 'grace@example.net');
  await host(ID.hostHenry, 'henry@example.org');
  await host(ID.hostIvy, 'ivy@example.com');
  await host(ID.hostJack, 'jack@example.net');

  const request = (id: string, email: string, createdAt: string, attribution: unknown, userAgent: string | null) =>
    db.query(
      `insert into pool_requests (id, email, title, event_type, status, created_at, claimed_at, attribution,
                                  user_agent, page_url)
       values ($1, $2, 'My event', 'wedding', 'claimed', $3, $3, $4, $5, $6)`,
      [
        id,
        email,
        createdAt,
        attribution === null ? null : JSON.stringify(attribution),
        userAgent,
        userAgent === null ? null : 'https://www.snappool.photos/start',
      ],
    );
  await request(ID.reqGrace, 'grace@example.net', '2026-10-11T01:00:00Z', META_ATTRIBUTION, 'Mozilla/5.0 (grace)');
  await request(ID.reqHenryOld, 'henry@example.org', '2026-09-01T01:00:00Z', GOOGLE_ATTRIBUTION, 'Mozilla/5.0 (old)');
  await request(ID.reqHenryNew, 'henry@example.org', '2026-10-05T01:00:00Z', META_ATTRIBUTION, 'Mozilla/5.0 (henry)');
  await request(
    ID.reqHenryAfter,
    'henry@example.org',
    '2026-10-20T01:00:00Z',
    GOOGLE_ATTRIBUTION,
    'Mozilla/5.0 (later)',
  );
  await request(ID.reqJack, 'jack@example.net', '2026-10-11T02:00:00Z', null, null);

  const charge = (c: { id: string; hostId: string; requestId: string; livemode: boolean; savedAt: string | null }) =>
    db.query(
      `insert into deferred_event_charges (id, host_id, pool_request_id, plan, livemode, status, card_ref, currency,
                                           amount_minor, charge_at, created_at, saved_at)
       values ($1, $2, $3, 'pro', $4, $5, 'card-secret', 'SGD', 9900, '2027-01-01T00:00:00Z', '2026-10-10T00:00:00Z', $6)`,
      [c.id, c.hostId, c.requestId, c.livemode, c.savedAt === null ? 'awaiting_card' : 'scheduled', c.savedAt],
    );
  await charge({
    id: ID.chargeAlice,
    hostId: ID.hostAlice,
    requestId: ID.reqAlice,
    livemode: true,
    savedAt: '2026-10-10T03:00:00Z',
  });
  await charge({
    id: ID.chargeJackTest,
    hostId: ID.hostJack,
    requestId: ID.reqJack,
    livemode: false,
    savedAt: '2026-10-11T03:00:00Z',
  });
  await charge({ id: ID.chargeJackOpen, hostId: ID.hostJack, requestId: ID.reqJack, livemode: true, savedAt: null });

  const subscription = (s: { id: string; hostId: string; requestId: string | null; status: string; at: string }) =>
    db.query(
      `insert into billing_subscriptions (id, host_id, tier, cadence, status, livemode, card_ref, created_at,
                                          pool_request_id)
       values ($1, $2, 'plus', 'monthly', $3, true, 'card-secret', $4, $5)`,
      [s.id, s.hostId, s.status, s.at, s.requestId],
    );
  await subscription({
    id: ID.subGrace,
    hostId: ID.hostGrace,
    requestId: ID.reqGrace,
    status: 'active',
    at: '2026-10-11T01:30:00Z',
  });
  await subscription({
    id: ID.subHenry,
    hostId: ID.hostHenry,
    requestId: null,
    status: 'active',
    at: '2026-10-12T00:00:00Z',
  });
  await subscription({
    id: ID.subJackAbandoned,
    hostId: ID.hostJack,
    requestId: ID.reqJack,
    status: 'abandoned',
    at: '2026-10-11T02:30:00Z',
  });

  const order = (o: {
    id: string;
    hostId: string;
    kind: string;
    amountMinor: number;
    paidAt: string | null;
    livemode?: boolean;
    status?: string;
    currency?: string;
    attribution?: unknown;
    subscriptionId?: string;
    deferredChargeId?: string;
  }) =>
    db.query(
      `insert into orders (id, host_id, kind, currency, amount_minor, status, buyer_country, attribution, livemode,
                           created_at, paid_at, fee_minor, net_minor, subscription_id, deferred_charge_id)
       values ($1, $2, $3, $4, $5, $6, 'SG', $7, $8, coalesce($9::timestamptz, '2026-10-10T00:00:00Z'), $9, 100, 2800,
               $10, $11)`,
      [
        o.id,
        o.hostId,
        o.kind,
        o.currency ?? 'SGD',
        o.amountMinor,
        o.status ?? (o.paidAt === null ? 'pending' : 'fulfilled'),
        o.attribution === undefined ? null : JSON.stringify(o.attribution),
        o.livemode ?? true,
        o.paidAt,
        o.subscriptionId ?? null,
        o.deferredChargeId ?? null,
      ],
    );
  await order({
    id: ID.orderFrank,
    hostId: ID.hostFrank,
    kind: 'event_plan',
    amountMinor: 2900,
    paidAt: '2026-10-10T08:00:00Z',
    attribution: { ...META_ATTRIBUTION, fbclid: 'IwAR-frank', fbc: 'fb.1.1760000000000.IwAR-frank' },
  });
  await order({
    id: ID.orderFrankAddOn,
    hostId: ID.hostFrank,
    kind: 'event_keepsake',
    amountMinor: 1500,
    paidAt: '2026-10-15T08:00:00Z',
  });
  await order({
    id: ID.orderAlice,
    hostId: ID.hostAlice,
    kind: 'event_plan',
    amountMinor: 9900,
    paidAt: '2026-10-13T00:00:00Z',
    deferredChargeId: ID.chargeAlice,
  });
  await order({
    id: ID.orderGrace,
    hostId: ID.hostGrace,
    kind: 'subscription_term',
    amountMinor: 4900,
    paidAt: '2026-10-12T00:00:00Z',
    subscriptionId: ID.subGrace,
  });
  await order({
    id: ID.orderGraceRenewal,
    hostId: ID.hostGrace,
    kind: 'subscription_renewal',
    amountMinor: 4900,
    paidAt: '2026-10-19T00:00:00Z',
    subscriptionId: ID.subGrace,
  });
  await order({
    id: ID.orderHenry,
    hostId: ID.hostHenry,
    kind: 'subscription_term',
    amountMinor: 4900,
    paidAt: '2026-10-12T00:05:00Z',
    subscriptionId: ID.subHenry,
  });
  await order({
    id: ID.orderIvyOld,
    hostId: ID.hostIvy,
    kind: 'event_plan',
    amountMinor: 2900,
    paidAt: '2026-08-15T00:00:00Z',
  });
  await order({
    id: ID.orderIvy,
    hostId: ID.hostIvy,
    kind: 'event_plan',
    amountMinor: 2900,
    paidAt: '2026-10-14T00:00:00Z',
  });
  await order({
    id: ID.orderJackSandbox,
    hostId: ID.hostJack,
    kind: 'event_plan',
    amountMinor: 2900,
    paidAt: '2026-10-11T04:00:00Z',
    livemode: false,
  });
  await order({
    id: ID.orderJackComp,
    hostId: ID.hostJack,
    kind: 'event_keepsake',
    amountMinor: 0,
    paidAt: null,
    status: 'fulfilled',
  });
  await order({ id: ID.orderJackPending, hostId: ID.hostJack, kind: 'event_plan', amountMinor: 2900, paidAt: null });
  await order({
    id: ID.orderCarol,
    hostId: ID.hostCarol,
    kind: 'event_plan',
    amountMinor: 2900,
    paidAt: '2026-10-16T00:00:00Z',
  });
  await order({
    id: ID.orderAdmin,
    hostId: ID.hostAdmin,
    kind: 'event_plan',
    amountMinor: 2900,
    paidAt: '2026-10-16T01:00:00Z',
  });

  const refund = (id: string, orderId: string, status: string, amountMinor: number, at: string) =>
    db.query(
      `insert into refunds (id, order_id, provider_ref, currency, amount_minor, status, created_at)
       values ($1, $2, $3, 'SGD', $4, $5, $6)`,
      [id, orderId, `ref-${id.slice(-2)}`, amountMinor, status, at],
    );
  await refund(ID.refundFrank, ID.orderFrank, 'succeeded', 2900, '2026-10-17T00:00:00Z');
  await refund(ID.refundFrankFailed, ID.orderFrank, 'failed', 2900, '2026-10-16T00:00:00Z');
  await refund(ID.refundFrankAddOn, ID.orderFrankAddOn, 'succeeded', 1500, '2026-10-18T00:00:00Z');
}

/** A login role on the fixture database with exactly what the agent's login has on SnapPool's: T6a's tables and the
 *  purchases grant (`grant.ts`). Returns its connection string; `drop` removes its grants and the role. */
export async function createReadRole(
  db: FixtureDb,
  grantSql: (role: string) => string,
): Promise<{ url: string; drop: () => Promise<void> }> {
  const role = `ads_agent_ro_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  await db.query(`create role ${role} login password '${password}'`);
  await db.query(`grant select on pool_requests, hosts, events to ${role}`);
  await db.query(grantSql(role));
  const url = new URL(db.url);
  url.username = role;
  url.password = password;
  return {
    url: url.toString(),
    async drop() {
      await db.query(`drop owned by ${role}`); // its grants on the fixture database, so the role can go
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`drop role if exists ${role}`);
      await admin.end();
    },
  };
}
