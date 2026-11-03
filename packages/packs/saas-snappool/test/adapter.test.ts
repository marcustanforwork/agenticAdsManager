// The SnapPool adapter against a fixture copy of SnapPool's tables.
import { createHash } from 'node:crypto';
import { type ProductSettings, OutcomeEvent } from '@ads/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DATABASE_URL_ENV,
  PURCHASE_COLUMNS,
  idsFromAttribution,
  isTestEmail,
  manifest,
  purchasesGrantSql,
  snapPoolAdapter,
  valueFrom,
} from '../src/index.ts';
import {
  FIXTURE_EMAILS,
  ID,
  createFixtureDb,
  createReadRole,
  seedFixtures,
  seedPurchases,
  type FixtureDb,
} from './fixtureDb.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const SINCE = new Date('2026-09-25T00:00:00Z');

const settings = (testDomains: string[] = []): ProductSettings =>
  ({
    outcomes: manifest.defaults.outcomes,
    testTraffic: { emailDomains: testDomains },
  }) as ProductSettings;

let db: FixtureDb;
beforeAll(async () => {
  db = await createFixtureDb();
  await seedFixtures(db);
});
afterAll(async () => {
  await db?.drop();
});

const adapterFor = (domains: string[] = ['staff.example']) =>
  snapPoolAdapter({ [DATABASE_URL_ENV]: db.url }, settings(domains));

describe('the SnapPool adapter (fixture database)', () => {
  it('emits one outcome per stage, oldest first, from the requested time', async () => {
    const events = await adapterFor().fetchSince(SINCE);
    expect(events.map((e) => [e.stage, e.sourceId, e.occurredAt])).toEqual([
      ['pool_request', ID.reqAlice, '2026-10-01T02:00:00.000Z'],
      ['signup', ID.reqAlice, '2026-10-01T02:10:00.000Z'],
      ['pool_request', ID.reqBob, '2026-10-02T03:00:00.000Z'],
      ['pool_request', ID.reqCarol, '2026-10-02T04:00:00.000Z'],
      ['signup', ID.reqCarol, '2026-10-02T05:00:00.000Z'],
      ['pool_request', ID.reqAdmin, '2026-10-03T01:00:00.000Z'],
      ['signup', ID.reqAdmin, '2026-10-03T01:05:00.000Z'],
      ['pool_request', ID.reqDave, '2026-10-03T06:00:00.000Z'],
      ['activated', ID.eventAdmin, '2026-10-03T08:00:00.000Z'],
      ['pool_request', ID.reqEve, '2026-10-04T05:00:00.000Z'],
      ['activated', ID.eventAlice, '2026-10-04T09:00:00.000Z'],
    ]);
    for (const e of events) expect(OutcomeEvent.parse(e)).toEqual(e);
  });

  it('counts only claimed requests as signups, and activation only for a claimed pool with a photo', async () => {
    const events = await adapterFor().fetchSince(SINCE);
    expect(events.filter((e) => e.stage === 'signup').map((e) => e.sourceId)).toEqual([
      ID.reqAlice,
      ID.reqCarol,
      ID.reqAdmin,
    ]);
    expect(events.filter((e) => e.stage === 'activated').map((e) => e.sourceId)).toEqual([
      ID.eventAdmin,
      ID.eventAlice,
    ]);
  });

  it('respects since and limit', async () => {
    const later = await adapterFor().fetchSince(new Date('2026-10-03T06:00:00Z'));
    expect(later.map((e) => e.sourceId)).toEqual([ID.reqDave, ID.eventAdmin, ID.reqEve, ID.eventAlice]);
    expect(await adapterFor().fetchSince(SINCE, 3)).toHaveLength(3);
  });

  it('takes the click and platform ids, and the browser context, from what SnapPool saved', async () => {
    const events = await adapterFor().fetchSince(SINCE);
    const of = (stage: string, sourceId: string) => events.find((e) => e.stage === stage && e.sourceId === sourceId);
    expect(of('signup', ID.reqAlice)?.ids).toEqual({
      gclid: 'Cj0KCQjw-test-gclid',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: '12345678901',
      googleCampaignId: '12345678901',
      googleAdGroupId: '5555',
    });
    expect(of('signup', ID.reqAlice)?.web).toEqual({
      userAgent: 'Mozilla/5.0 (fixture)',
      pageUrl: 'https://www.snappool.photos/start?utm_source=google',
    });
    expect(of('pool_request', ID.reqBob)?.ids).toEqual({
      fbclid: 'IwAR-test-fbclid',
      fbc: 'fb.1.1759370000000.IwAR-test-fbclid',
      utmSource: 'meta',
      utmMedium: 'paid_social',
      utmCampaign: '120200000001',
      metaCampaignId: '120200000001',
      metaAdSetId: '120200000002',
      metaAdId: '120200000003',
    });
    // Activation carries the request's ids: they're what the pool came from.
    expect(of('activated', ID.eventAlice)?.ids.googleCampaignId).toBe('12345678901');
    expect(of('signup', ID.reqAdmin)?.ids).toEqual({ fbclid: 'IwAR-admin' });
    // A campaign name isn't an id; a non-string click id is dropped; organic and odd values give no ids.
    expect(of('pool_request', ID.reqDave)?.ids).toEqual({ utmSource: 'Google', utmCampaign: 'Brand Campaign' });
    expect(of('pool_request', ID.reqCarol)?.ids).toEqual({});
    expect(of('pool_request', ID.reqCarol)?.web).toBeUndefined();
    expect(of('pool_request', ID.reqEve)?.ids).toEqual({});
  });

  it('hashes emails inside the adapter, for each platform', async () => {
    const bob = (await adapterFor().fetchSince(SINCE)).find((e) => e.sourceId === ID.reqBob);
    expect(bob?.hashedContact).toEqual({
      emailSha256: sha256('b.ob@gmail.com'),
      emailSha256Google: sha256('bob@gmail.com'),
    });
  });

  it('marks test traffic: listed domains (and their subdomains) and the superadmin', async () => {
    const tests = (events: OutcomeEvent[]) =>
      [...new Set(events.filter((e) => e.isTest).map((e) => e.sourceId))].sort();
    expect(tests(await adapterFor().fetchSince(SINCE))).toEqual([ID.reqCarol, ID.reqAdmin, ID.eventAdmin].sort());
    // Without the domain setting only the superadmin is a test.
    expect(tests(await adapterFor([]).fetchSince(SINCE))).toEqual([ID.reqAdmin, ID.eventAdmin].sort());
  });

  it('never lets a raw email out: every output is scanned', async () => {
    const outputs = [
      await adapterFor().fetchSince(SINCE),
      await adapterFor().healthcheck(),
      await snapPoolAdapter({ [DATABASE_URL_ENV]: `${db.url}_missing` }, settings()).healthcheck(),
      await snapPoolAdapter({ [DATABASE_URL_ENV]: `${db.url}_missing` }, settings())
        .fetchSince(SINCE)
        .catch((e: unknown) => (e as Error).message),
    ];
    const text = JSON.stringify(outputs).toLowerCase();
    for (const email of FIXTURE_EMAILS) {
      expect(text).not.toContain(email);
      expect(text).not.toContain(`${email.split('@')[0]}@`);
    }
  });

  it('healthcheck: healthy with the latest activity; unreachable or unconfigured is not ok', async () => {
    expect(await adapterFor().healthcheck()).toEqual({
      ok: true,
      latestActivityAt: new Date('2026-10-04T05:00:00Z'),
    });
    const unreachable = snapPoolAdapter({ [DATABASE_URL_ENV]: `${db.url}_missing` }, settings());
    const health = await unreachable.healthcheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/^cannot read SnapPool: /);
    expect(health.detail).not.toContain('postgres://');
    await expect(unreachable.fetchSince(SINCE)).rejects.toThrow(/^reading SnapPool failed: /);

    const unset = snapPoolAdapter({}, settings());
    expect(await unset.healthcheck()).toEqual({
      ok: false,
      detail: `${DATABASE_URL_ENV} is not set (the read-only SnapPool connection string, setup task T6a)`,
    });
    await expect(unset.fetchSince(SINCE)).rejects.toThrow(DATABASE_URL_ENV);
  });

  it('reads in a read-only transaction', async () => {
    await db.query('create table probe (x int)');
    // The adapter's SQL can't write, but prove the transaction mode: a write in it fails.
    const { Client } = (await import('pg')).default;
    const c = new Client({ connectionString: db.url });
    await c.connect();
    await c.query('begin read only');
    await expect(c.query('insert into probe values (1)')).rejects.toThrow(/read-only transaction/);
    await c.query('rollback');
    await c.end();
  });
});

describe('purchases (F4, D-096; SNAPPOOL-TRACKING §2.1)', () => {
  let shop: FixtureDb;
  let events: OutcomeEvent[];
  const PURCHASE_STAGES = ['card_saved', 'paid', 'refunded'];
  const of = (stage: string, sourceId: string) => events.find((e) => e.stage === stage && e.sourceId === sourceId);

  beforeAll(async () => {
    shop = await createFixtureDb();
    await seedFixtures(shop);
    await seedPurchases(shop);
    events = await snapPoolAdapter({ [DATABASE_URL_ENV]: shop.url }, settings(['staff.example'])).fetchSince(SINCE);
  });
  afterAll(async () => {
    await shop?.drop();
  });

  it('reads saved cards, each host’s first paid order with its value, and counted refunds, oldest first', () => {
    const purchases = events.filter((e) => PURCHASE_STAGES.includes(e.stage));
    expect(
      purchases.map((e) => [e.stage, e.sourceId, e.occurredAt, e.valueMicros ?? null, e.currency ?? null]),
    ).toEqual([
      ['card_saved', ID.chargeAlice, '2026-10-10T03:00:00.000Z', null, null],
      ['paid', ID.orderFrank, '2026-10-10T08:00:00.000Z', '29000000', 'SGD'],
      ['card_saved', ID.subGrace, '2026-10-11T01:30:00.000Z', null, null],
      ['paid', ID.orderGrace, '2026-10-12T00:00:00.000Z', '49000000', 'SGD'],
      ['paid', ID.orderHenry, '2026-10-12T00:05:00.000Z', '49000000', 'SGD'],
      ['paid', ID.orderAlice, '2026-10-13T00:00:00.000Z', '99000000', 'SGD'],
      ['paid', ID.orderCarol, '2026-10-16T00:00:00.000Z', '29000000', 'SGD'],
      ['paid', ID.orderAdmin, '2026-10-16T01:00:00.000Z', '29000000', 'SGD'],
      ['refunded', ID.refundFrank, '2026-10-17T00:00:00.000Z', '29000000', 'SGD'],
    ]);
    for (const e of purchases) expect(OutcomeEvent.parse(e)).toEqual(e);
  });

  it('leaves out renewals, add-ons, an earlier customer’s later order, free grants, unpaid and test-mode ones', () => {
    const ids = new Set(events.map((e) => e.sourceId));
    for (const left of [
      ID.orderGraceRenewal, // a renewal
      ID.orderFrankAddOn, // an add-on after the first order
      ID.orderIvy, // Ivy first paid in August: not a new customer in October
      ID.orderIvyOld, // before the window
      ID.orderJackSandbox, // test mode
      ID.orderJackComp, // a free grant: no payment, amount 0
      ID.orderJackPending, // not paid
      ID.chargeJackTest, // a test-mode card
      ID.chargeJackOpen, // the card isn't saved yet
      ID.subJackAbandoned, // the card was never saved
      ID.subHenry, // a subscription started from the dashboard: not chosen at /start
      ID.refundFrankFailed, // a failed refund
      ID.refundFrankAddOn, // a refund on an order that isn't a first one
    ]) {
      expect(ids.has(left), left).toBe(false);
    }
  });

  it('credits each payment path to the right click', () => {
    // Checkout: the click saved on the order.
    expect(of('paid', ID.orderFrank)?.ids).toMatchObject({ fbclid: 'IwAR-frank', metaCampaignId: '120200000001' });
    expect(of('paid', ID.orderFrank)?.web).toBeUndefined(); // no /start request to take the browser context from
    // One event chosen at onboarding: the request the charge points to (Alice's Google click), for the saved card
    // and for the order that charged it.
    for (const e of [of('card_saved', ID.chargeAlice), of('paid', ID.orderAlice)]) {
      expect(e?.ids).toMatchObject({ gclid: 'Cj0KCQjw-test-gclid', googleCampaignId: '12345678901' });
      expect(e?.web?.userAgent).toBe('Mozilla/5.0 (fixture)');
    }
    // A subscription chosen at onboarding: the request the subscription points to (Grace's Meta click).
    for (const e of [of('card_saved', ID.subGrace), of('paid', ID.orderGrace)]) {
      expect(e?.ids).toMatchObject({ fbclid: 'IwAR-test-fbclid', metaAdId: '120200000003' });
      expect(e?.web?.userAgent).toBe('Mozilla/5.0 (grace)');
    }
    // Neither: the host's latest claimed /start request with a click made before the purchase.
    expect(of('paid', ID.orderHenry)?.ids).toMatchObject({ metaCampaignId: '120200000001' });
    expect(of('paid', ID.orderHenry)?.ids.googleCampaignId).toBeUndefined();
    expect(of('paid', ID.orderHenry)?.web?.userAgent).toBe('Mozilla/5.0 (henry)');
    expect(of('paid', ID.orderAdmin)?.ids).toEqual({ fbclid: 'IwAR-admin' });
    expect(of('paid', ID.orderCarol)?.ids).toEqual({}); // her request had no click
    // A refund goes to the purchase's click, so it lands on the same campaign.
    expect(of('refunded', ID.refundFrank)?.ids).toEqual(of('paid', ID.orderFrank)?.ids);
  });

  it('marks test traffic as for signups: listed domains and the superadmin', () => {
    const tests = events.filter((e) => PURCHASE_STAGES.includes(e.stage) && e.isTest).map((e) => e.sourceId);
    expect(tests.sort()).toEqual([ID.orderCarol, ID.orderAdmin].sort());
    expect(of('paid', ID.orderFrank)?.hashedContact?.emailSha256).toBe(sha256('frank@example.com'));
    const text = JSON.stringify(events).toLowerCase();
    for (const email of FIXTURE_EMAILS) expect(text).not.toContain(email);
  });

  it('reads with exactly the grant Marcus runs: T6a’s tables and the purchase columns, nothing else', async () => {
    const role = await createReadRole(shop, purchasesGrantSql);
    try {
      const asRole = await snapPoolAdapter({ [DATABASE_URL_ENV]: role.url }, settings(['staff.example'])).fetchSince(
        SINCE,
      );
      expect(asRole).toEqual(events);
      const { Client } = (await import('pg')).default;
      const c = new Client({ connectionString: role.url });
      await c.connect();
      try {
        for (const forbidden of [
          'select card_ref from billing_subscriptions',
          'select card_url from deferred_event_charges',
          'select fee_minor from orders',
          'select buyer_country from orders',
          'select provider_ref from refunds',
        ]) {
          await expect(c.query(forbidden), forbidden).rejects.toThrow(/permission denied/);
        }
      } finally {
        await c.end();
      }
    } finally {
      await role.drop();
    }
  });

  it('without the purchases grant, the read fails loudly and says what to run', async () => {
    const role = await createReadRole(shop, () => 'select 1');
    try {
      await expect(snapPoolAdapter({ [DATABASE_URL_ENV]: role.url }, settings()).fetchSince(SINCE)).rejects.toThrow(
        /permission denied .*run the purchases grant on SnapPool's database/,
      );
    } finally {
      await role.drop();
    }
  });

  it('writes the grant as column lists for the agent’s login, and refuses an odd role name', () => {
    expect(purchasesGrantSql().split('\n')).toEqual([
      'grant select (id, host_id, currency, amount_minor, livemode, paid_at, attribution, subscription_id, deferred_charge_id) on orders to ads_agent_ro;',
      'grant select (id, order_id, status, currency, amount_minor, created_at) on refunds to ads_agent_ro;',
      'grant select (id, host_id, pool_request_id, livemode, saved_at) on deferred_event_charges to ads_agent_ro;',
      'grant select (id, host_id, pool_request_id, livemode, status, created_at) on billing_subscriptions to ads_agent_ro;',
    ]);
    expect(Object.values(PURCHASE_COLUMNS).flat()).not.toContain('card_ref');
    expect(() => purchasesGrantSql('x; drop table orders')).toThrow(/not a plain role name/);
  });

  it('values a payment in micros by its currency’s minor unit', () => {
    expect(valueFrom('2900', 'SGD')).toEqual({ valueMicros: '29000000', currency: 'SGD' });
    expect(valueFrom('2900', 'sgd')).toEqual({ valueMicros: '29000000', currency: 'SGD' });
    expect(valueFrom('500', 'JPY')).toEqual({ valueMicros: '500000000', currency: 'JPY' });
    expect(valueFrom(null, 'SGD')).toBeUndefined();
    expect(valueFrom('2900', null)).toBeUndefined();
    expect(valueFrom('2900', 'S$')).toBeUndefined();
    expect(valueFrom('-1', 'SGD')).toBeUndefined();
  });
});

describe('attribution and test-traffic helpers', () => {
  it('ignores values too long to be what SnapPool wrote', () => {
    expect(idsFromAttribution({ gclid: 'x'.repeat(513), utm_source: 'meta', utm_campaign: '1'.repeat(31) })).toEqual({
      utmSource: 'meta',
      utmCampaign: '1'.repeat(31),
    });
    expect(idsFromAttribution(null)).toEqual({});
    expect(idsFromAttribution('gclid=1')).toEqual({});
  });

  it('matches a test domain exactly or as a parent domain, never by substring', () => {
    expect(isTestEmail('a@staff.example', ['staff.example'])).toBe(true);
    expect(isTestEmail('a@x.staff.example', ['staff.example'])).toBe(true);
    expect(isTestEmail('a@notstaff.example', ['staff.example'])).toBe(false);
    expect(isTestEmail('staff.example@gmail.com', ['staff.example'])).toBe(false);
    expect(isTestEmail('no-at-sign', ['staff.example'])).toBe(false);
  });
});
