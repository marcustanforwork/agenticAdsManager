// The Airtable adapter against the hand-made fixture of the leads table (test/fixtures/README.md), served by a
// fake fetch that also records what the adapter asked for.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type ProductSettings, OutcomeEvent } from '@ads/contracts';
import { describe, expect, it } from 'vitest';
import {
  AIRTABLE_BASE_ENV,
  AIRTABLE_TABLE_ENV,
  AIRTABLE_TOKEN_ENV,
  AirtableSourceError,
  LEAD_FIELDS,
  airtableAdapter,
  idsFromFields,
  isTestEmail,
  manifest,
  pack,
  sinceFormula,
} from '../src/index.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PAGE_1 = fixture('leads-page-1.json');
const PAGE_2 = fixture('leads-page-2.json');
const PAGE_2_OFFSET = 'itrFIXTUREpage2/recLeadOrganic003';

const NOW = new Date('2026-10-07T04:00:00Z');
const SINCE = new Date('2026-09-20T00:00:00Z');
const TOKEN = 'patFIXTURE0000000.secret0000000000';
const ENV = { [AIRTABLE_TOKEN_ENV]: TOKEN, [AIRTABLE_BASE_ENV]: 'appFIXTUREbase001', [AIRTABLE_TABLE_ENV]: 'Leads' };
/** Every raw email in the fixture, normalised: none may appear in anything the adapter returns. */
const RAW_EMAILS = [
  'alice.tan@example.com',
  'bob@example.net',
  'carol@example.com',
  'tester@staff.example',
  'dave@example.com',
  'erin@example.com',
  'frank@example.com',
];

const settings = (testDomains: string[] = ['staff.example']): ProductSettings =>
  ({ outcomes: manifest.defaults.outcomes, testTraffic: { emailDomains: testDomains } }) as ProductSettings;

interface Call {
  url: URL;
  authorization: string | null;
}

/** A fake Airtable: page 1, then page 2 for its offset. `reply` overrides the answer. */
function fakeAirtable(reply?: (url: URL, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    if (reply) return reply(url, calls.length);
    const body = url.searchParams.get('offset') === PAGE_2_OFFSET ? PAGE_2 : PAGE_1;
    return Response.json(body);
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** Pauses between page requests, recorded instead of waited for. */
const pauses: number[] = [];
const adapterWith = (fetchFn: typeof fetch, env: Record<string, string> = ENV, domains?: string[]) =>
  airtableAdapter(env, settings(domains), {
    fetch: fetchFn,
    now: () => NOW,
    pause: (ms) => (pauses.push(ms), Promise.resolve()),
  });

describe('the Airtable adapter (fixture)', () => {
  it('emits one outcome per stage, oldest first, from the requested time', async () => {
    const { fetchFn } = fakeAirtable();
    const events = await adapterWith(fetchFn).fetchSince(SINCE);
    expect(events.map((e) => [e.stage, e.sourceId, e.occurredAt])).toEqual([
      ['form_fill', 'recLeadGoogle0001', '2026-09-21T02:15:00.000Z'],
      ['form_fill', 'recLeadMeta000002', '2026-09-22T11:40:00.000Z'],
      ['form_fill', 'recLeadOrganic003', '2026-09-25T09:00:00.000Z'],
      // A date field is the start of that day in Singapore (00:00 +08:00).
      ['qualified_viewing', 'recLeadGoogle0001', '2026-09-26T16:00:00.000Z'],
      ['form_fill', 'recLeadTest000004', '2026-09-28T01:00:00.000Z'],
      ['form_fill', 'recLeadBadDay0007', '2026-09-29T00:00:00.000Z'],
      // An older lead booked in the window: the booking counts, its form fill (before `since`) doesn't.
      ['booked', 'recLeadOlder00006', '2026-09-29T16:00:00.000Z'],
      // A date-and-time field is taken as is.
      ['qualified_viewing', 'recLeadMeta000002', '2026-10-02T07:30:00.000Z'],
      ['booked', 'recLeadGoogle0001', '2026-10-02T16:00:00.000Z'],
      // Its viewing is on 2026-10-20, after NOW: not an outcome yet. recLeadBadDay0007's 2026-02-31 isn't a day.
      ['form_fill', 'recLeadFuture0005', '2026-10-05T03:00:00.000Z'],
    ]);
    for (const e of events) expect(OutcomeEvent.parse(e)).toEqual(e);
  });

  it('asks Airtable for the mapped fields only, with the token as a bearer header, page by page', async () => {
    const { fetchFn, calls } = fakeAirtable();
    pauses.length = 0;
    await adapterWith(fetchFn).fetchSince(SINCE);
    expect(calls).toHaveLength(2);
    expect(pauses).toEqual([250]); // paced under Airtable's 5 requests a second per base
    const [first, second] = calls as [Call, Call];
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.airtable.com/v0/appFIXTUREbase001/Leads');
    expect(first.authorization).toBe(`Bearer ${TOKEN}`);
    expect(first.url.searchParams.getAll('fields[]')).toEqual(Object.values(LEAD_FIELDS));
    expect(first.url.searchParams.get('pageSize')).toBe('100');
    expect(first.url.searchParams.get('filterByFormula')).toBe(sinceFormula(SINCE));
    expect(first.url.searchParams.has('offset')).toBe(false);
    expect(second.url.searchParams.get('offset')).toBe(PAGE_2_OFFSET);
    for (const c of calls) expect(c.url.toString()).not.toContain(TOKEN);
  });

  it('filters on creation time a second early, and on any viewing or booking day', () => {
    expect(sinceFormula(SINCE)).toBe(
      "OR(IS_AFTER(CREATED_TIME(), DATETIME_PARSE('2026-09-19T23:59:59.000Z')), {Qualified viewing on}, {Booked on})",
    );
  });

  it('takes the ids from the hidden fields: Google, Meta (with its click cookie), a name, organic', async () => {
    const { fetchFn } = fakeAirtable();
    const events = await adapterWith(fetchFn).fetchSince(SINCE);
    const ids = (id: string) => events.find((e) => e.sourceId === id && e.stage === 'form_fill')?.ids;
    expect(ids('recLeadGoogle0001')).toEqual({
      gclid: 'Cj0KCQjwFIXTUREgclidAlice',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: '21987654321',
      googleCampaignId: '21987654321',
      googleAdGroupId: '16543210987',
    });
    expect(ids('recLeadMeta000002')).toEqual({
      fbclid: 'IwARFIXTUREfbclidBob',
      fbc: `fb.1.${Date.parse('2026-09-22T11:40:00.000Z')}.IwARFIXTUREfbclidBob`,
      utmSource: 'facebook',
      utmMedium: 'paid_social',
      utmCampaign: '120210000000000001',
      metaCampaignId: '120210000000000001',
      metaAdSetId: '120210000000000002',
      metaAdId: '120210000000000003',
    });
    // A campaign name isn't an id; a number field (not text) is ignored.
    expect(ids('recLeadTest000004')).toEqual({ utmSource: 'google', utmCampaign: 'Brand campaign' });
    expect(ids('recLeadBadDay0007')).toEqual({ utmSource: 'google' });
    expect(ids('recLeadOrganic003')).toEqual({});
    // Every stage of a lead carries the lead's ids.
    const booked = events.find((e) => e.sourceId === 'recLeadGoogle0001' && e.stage === 'booked');
    expect(booked?.ids).toEqual(ids('recLeadGoogle0001'));
  });

  it('drops a click id longer than 512 characters instead of cutting it, and ignores non-text values', () => {
    const at = new Date('2026-09-21T00:00:00Z');
    expect(idsFromFields({ gclid: 'x'.repeat(513), utm_source: 'google', utm_campaign: '1' }, at)).toEqual({
      utmSource: 'google',
      utmCampaign: '1',
      googleCampaignId: '1',
    });
    expect(idsFromFields({ gclid: 'x'.repeat(512) }, at)).toEqual({ gclid: 'x'.repeat(512) });
    expect(idsFromFields({ fbclid: ['a'], utm_source: { a: 1 }, utm_campaign: 5 }, at)).toEqual({});
  });

  it('hashes emails inside the adapter (both platforms’ rules) and never lets a raw email out', async () => {
    const { fetchFn } = fakeAirtable();
    const adapter = adapterWith(fetchFn);
    const events = await adapter.fetchSince(SINCE);
    const alice = events.find((e) => e.sourceId === 'recLeadGoogle0001');
    expect(alice?.hashedContact).toEqual({
      emailSha256: sha256('alice.tan@example.com'),
      emailSha256Google: sha256('alice.tan@example.com'),
    });
    const outputs = JSON.stringify([events, await adapter.healthcheck()]).toLowerCase();
    for (const email of RAW_EMAILS) expect(outputs).not.toContain(email);
    expect(outputs).not.toContain('alice.tan');
  });

  it('marks test traffic: listed domains and their subdomains', async () => {
    const { fetchFn } = fakeAirtable();
    const events = await adapterWith(fetchFn).fetchSince(SINCE);
    expect(events.filter((e) => e.isTest).map((e) => e.sourceId)).toEqual(['recLeadTest000004']);
    const none = await adapterWith(fakeAirtable().fetchFn, ENV, []).fetchSince(SINCE);
    expect(none.some((e) => e.isTest)).toBe(false);
    expect(isTestEmail('Someone@Sub.Staff.Example', ['staff.example'])).toBe(true);
    expect(isTestEmail('someone@notstaff.example', ['staff.example'])).toBe(false);
    expect(isTestEmail('no-at-sign', ['staff.example'])).toBe(false);
  });

  it('returns at most `limit` outcomes, the oldest', async () => {
    const { fetchFn } = fakeAirtable();
    const events = await adapterWith(fetchFn).fetchSince(SINCE, 3);
    expect(events.map((e) => e.sourceId)).toEqual(['recLeadGoogle0001', 'recLeadMeta000002', 'recLeadOrganic003']);
  });

  it('healthcheck: the latest form fill, read with a non-personal field only', async () => {
    const { fetchFn, calls } = fakeAirtable();
    expect(await adapterWith(fetchFn).healthcheck()).toEqual({
      ok: true,
      latestActivityAt: new Date('2026-10-05T03:00:00.000Z'),
    });
    expect(calls[0]?.url.searchParams.getAll('fields[]')).toEqual([LEAD_FIELDS.utmSource]);
    expect(calls[0]?.url.searchParams.get('filterByFormula')).toBe(
      "IS_AFTER(CREATED_TIME(), DATETIME_PARSE('2026-09-23T04:00:00.000Z'))",
    );
    const quiet = fakeAirtable(() => Response.json({ records: [] }));
    expect(await adapterWith(quiet.fetchFn).healthcheck()).toEqual({
      ok: true,
      detail: 'no form fills in the last 14 days',
    });
  });

  it('healthcheck and reads fail clearly without settings, and never echo the token', async () => {
    const { fetchFn, calls } = fakeAirtable();
    const unset = adapterWith(fetchFn, {});
    const health = await unset.healthcheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain(AIRTABLE_TOKEN_ENV);
    expect(health.detail).toContain(AIRTABLE_TABLE_ENV);
    await expect(unset.fetchSince(SINCE)).rejects.toThrow(AirtableSourceError);
    const badBase = await adapterWith(fetchFn, { ...ENV, [AIRTABLE_BASE_ENV]: 'not-a-base' }).healthcheck();
    expect(badBase).toEqual({ ok: false, detail: `${AIRTABLE_BASE_ENV} is not a base id (app…)` });
    expect(calls).toHaveLength(0);

    const refused = fakeAirtable(() =>
      Response.json(
        { error: { type: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } },
        { status: 401 },
      ),
    );
    const denied = await adapterWith(refused.fetchFn).healthcheck();
    expect(denied.ok).toBe(false);
    expect(denied.detail).toContain('HTTP 401 AUTHENTICATION_REQUIRED (the token was refused)');
    expect(JSON.stringify(denied)).not.toContain(TOKEN);
  });

  it('names a field the table does not have, a network failure, a bad answer, and endless paging', async () => {
    const unknownField = fakeAirtable(() =>
      Response.json(
        { error: { type: 'UNKNOWN_FIELD_NAME', message: 'Unknown field name: "Booked on"' } },
        { status: 422 },
      ),
    );
    await expect(adapterWith(unknownField.fetchFn).fetchSince(SINCE)).rejects.toThrow(
      'HTTP 422 UNKNOWN_FIELD_NAME (the request was refused; a field in LEAD_FIELDS may not match the table): ' +
        'Unknown field name: "Booked on"',
    );
    const down = fakeAirtable(() => Promise.reject(new TypeError('fetch failed')));
    await expect(adapterWith(down.fetchFn).fetchSince(SINCE)).rejects.toThrow(
      'Airtable did not answer (TypeError: fetch failed)',
    );
    const odd = fakeAirtable(() => Response.json({ rows: [] }));
    await expect(adapterWith(odd.fetchFn).fetchSince(SINCE)).rejects.toThrow('an unexpected shape');
    const endless = fakeAirtable(() => Response.json({ records: [], offset: 'itrAgain' }));
    await expect(adapterWith(endless.fetchFn).fetchSince(SINCE)).rejects.toThrow('paging stopped');
    expect(endless.calls).toHaveLength(100);
  });

  it('is the runtime of the pack, which reads its settings from the environment', async () => {
    const adapter = pack.runtime.outcomeAdapter({}, settings());
    expect((await adapter.healthcheck()).ok).toBe(false);
  });
});
