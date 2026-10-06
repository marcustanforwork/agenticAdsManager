// A throwaway Postgres database shaped like SnapPool's (the columns the adapter reads, with SnapPool's real names
// and types: lib/db/schema.ts at SnapPool commit 34d3473, 2026-10-06), filled with fixture rows. The fixture
// emails are made up. Needs the test Postgres (cloud: `pg_ctlcluster 16 main start`; CI: TEST_DATABASE_URL).
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
} as const;

/** Every email in the fixtures: none may ever appear in what the adapter returns. */
export const FIXTURE_EMAILS = [
  'alice@example.com',
  'b.ob@gmail.com',
  'carol@team.marcus-test.com',
  'admin@example.org',
  'old@example.com',
  'dave@example.net',
  'eve@example.com',
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
  await host(ID.hostCarol, 'carol@team.marcus-test.com');
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
    email: 'carol@team.marcus-test.com',
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
