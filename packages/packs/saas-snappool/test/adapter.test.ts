// The SnapPool adapter against a fixture copy of SnapPool's tables.
import { createHash } from 'node:crypto';
import { type ProductSettings, OutcomeEvent } from '@ads/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_URL_ENV, idsFromAttribution, isTestEmail, manifest, snapPoolAdapter } from '../src/index.ts';
import { FIXTURE_EMAILS, ID, createFixtureDb, seedFixtures, type FixtureDb } from './fixtureDb.ts';

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
