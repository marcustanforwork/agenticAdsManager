import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Cassette,
  Redactor,
  UnmatchedRequestError,
  findSecrets,
  loadCassette,
  recordingFetch,
  replayFetch,
  requestKey,
  saveCassette,
} from '../src/index.ts';

const TOKEN = `EAA${'b'.repeat(40)}`;

const cassette: Cassette = {
  source: 'hand-written for tests',
  exchanges: [
    {
      request: { method: 'GET', path: '/act_1/campaigns', query: { fields: 'id', limit: '2' } },
      response: { status: 200, headers: { 'content-type': 'application/json' }, body: { data: [{ id: '1' }] } },
    },
    {
      request: { method: 'GET', path: '/act_1/campaigns', query: { fields: 'id', limit: '2' } },
      response: { status: 200, headers: {}, body: { data: [{ id: '2' }] } },
    },
  ],
};

describe('requestKey', () => {
  it('drops the version prefix and the secret parameters', () => {
    const k = requestKey(
      `https://graph.facebook.com/v26.0/act_1/insights?access_token=${TOKEN}&appsecret_proof=ab&level=ad`,
    );
    expect(k).toEqual({ path: '/act_1/insights', query: { level: 'ad' } });
  });
});

describe('replayFetch', () => {
  it('serves matching requests in recorded order, whatever the token or parameter order', async () => {
    const r = replayFetch(cassette);
    const a = await r.fetch(`https://graph.facebook.com/v26.0/act_1/campaigns?limit=2&fields=id&access_token=${TOKEN}`);
    const b = await r.fetch('https://graph.facebook.com/v25.0/act_1/campaigns?fields=id&limit=2');
    expect(await a.json()).toEqual({ data: [{ id: '1' }] });
    expect(await b.json()).toEqual({ data: [{ id: '2' }] });
    expect(r.remaining()).toBe(0);
    expect(r.calls).toHaveLength(2);
  });

  it('fails loudly on a request the fixtures do not cover, or one made too often', async () => {
    const r = replayFetch(cassette);
    await expect(r.fetch('https://graph.facebook.com/v26.0/act_1/adsets')).rejects.toBeInstanceOf(
      UnmatchedRequestError,
    );
    await r.fetch('https://x/v26.0/act_1/campaigns?fields=id&limit=2');
    await r.fetch('https://x/v26.0/act_1/campaigns?fields=id&limit=2');
    await expect(r.fetch('https://x/v26.0/act_1/campaigns?fields=id&limit=2')).rejects.toThrow(/no fixture/);
  });
});

describe('redaction', () => {
  it('removes tokens, secret parameters, emails, names and unneeded headers', () => {
    const red = new Redactor().exchange({
      request: { method: 'GET', path: '/me', query: { access_token: TOKEN, fields: 'name' } },
      response: {
        status: 200,
        headers: { 'Set-Cookie': 'x', 'X-Business-Use-Case-Usage': '{"1":[]}', 'x-fb-trace-id': 'abc' },
        body: {
          name: 'Marcus Tan',
          owner: { name: 'Marcus Tan', email: 'marcus@example.com' },
          note: 'contact someone@company.sg',
          paging: { next: `https://graph.facebook.com/v26.0/act_1/ads?access_token=${TOKEN}&after=xyz` },
          access_token: TOKEN,
        },
      },
    });
    const text = JSON.stringify(red);
    expect(findSecrets(text)).toEqual([]);
    expect(text).not.toContain('Marcus');
    expect(red.response.headers).toEqual({ 'x-business-use-case-usage': '{"1":[]}' });
    const body = red.response.body as { name: string; owner: { name: string }; paging: { next: string } };
    expect(body.name).toBe(body.owner.name); // the same name maps to the same placeholder
    expect(body.paging.next).toContain('after=xyz');
    expect(red.request.query).toEqual({ fields: 'name' });
  });

  it('the scanner finds every kind of secret', () => {
    expect(findSecrets(`{"t":"${TOKEN}"}`)).toHaveLength(1);
    expect(findSecrets('https://x/?access_token=abc')).toEqual(['url parameter: access_token']);
    expect(findSecrets('{"appsecret_proof": "x"}')).toEqual(['json key: appsecret_proof']);
    expect(findSecrets('mail me@site.com')).toEqual(['email: …@site.com']);
    expect(findSecrets('ya29.abcdefghijklmnop')).toHaveLength(1);
    expect(findSecrets('https://x/?access_token=REDACTED redacted@example.invalid')).toEqual([]);
  });
});

describe('recording', () => {
  it('records redacted exchanges that replay identically', async () => {
    const inner = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: '9', name: 'Spring sale' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-app-usage': '{"call_count":5}' },
        }),
      )) as unknown as typeof fetch;
    const rec = recordingFetch(inner);
    const live = await rec.fetch(`https://graph.facebook.com/v26.0/act_1/ads?fields=id,name&access_token=${TOKEN}`);
    expect(await live.json()).toEqual({ data: [{ id: '9', name: 'Spring sale' }] }); // the caller sees the real body

    const dir = mkdtempSync(join(tmpdir(), 'cassette-'));
    const file = join(dir, 'meta', 'ads.json');
    saveCassette(file, { source: 'recorded 2026-10-02', exchanges: rec.exchanges });
    expect(findSecrets(readFileSync(file, 'utf8'))).toEqual([]);

    const replayed = await replayFetch(loadCassette(file)).fetch(
      'https://graph.facebook.com/v26.0/act_1/ads?fields=id,name',
    );
    expect(await replayed.json()).toEqual({ data: [{ id: '9', name: 'redacted name 1' }] });
  });

  it('refuses to write a cassette that still holds a secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cassette-'));
    const bad: Cassette = {
      source: 'x',
      exchanges: [
        {
          request: { method: 'GET', path: '/x', query: {} },
          response: { status: 200, headers: {}, body: { t: TOKEN } },
        },
      ],
    };
    expect(() => saveCassette(join(dir, 'bad.json'), bad)).toThrow(/refusing to write/);
  });
});

describe('POST bodies and matched headers (Google searchStream)', () => {
  const url = 'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream';
  const post = (query: string, manager?: string): RequestInit => ({
    method: 'POST',
    headers: {
      authorization: 'Bearer ya29.not-a-real-token-0123456789',
      'content-type': 'application/json',
      ...(manager === undefined ? {} : { 'login-customer-id': manager }),
    },
    body: JSON.stringify({ query }),
  });
  const google: Cassette = {
    source: 'hand-written for tests',
    exchanges: [
      {
        request: {
          method: 'POST',
          path: '/customers/1234567890/googleAds:searchStream',
          query: {},
          headers: { 'login-customer-id': '1112223333' },
          body: { query: 'SELECT campaign.id FROM campaign' },
        },
        response: { status: 200, headers: {}, body: [{ results: [] }] },
      },
    ],
  };

  it('match on the body and the login-customer-id header, never on the token', async () => {
    const r = replayFetch(google);
    await expect(r.fetch(url, post('SELECT ad_group.id FROM ad_group', '1112223333'))).rejects.toThrow(/no fixture/);
    await expect(r.fetch(url, post('SELECT campaign.id FROM campaign'))).rejects.toThrow(/no fixture/);
    const res = await r.fetch(url, post('SELECT campaign.id FROM campaign', '1112223333'));
    expect(await res.json()).toEqual([{ results: [] }]);
  });

  it('are recorded without the authorization header', async () => {
    const inner = replayFetch(google);
    const rec = recordingFetch(inner.fetch);
    await rec.fetch(url, post('SELECT campaign.id FROM campaign', '1112223333'));
    const [x] = rec.exchanges;
    expect(x?.request.headers).toEqual({ 'login-customer-id': '1112223333' });
    expect(x?.request.body).toEqual({ query: 'SELECT campaign.id FROM campaign' });
    expect(JSON.stringify(x)).not.toContain('ya29');
  });
});

describe('service-account secrets', () => {
  // Built at run time: a PEM literal in the repo would trip the secret scanner (gitleaks) on purpose.
  const pem = ['-----BEGIN', 'PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END', 'PRIVATE KEY-----\n'].join(
    ' ',
  );
  const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;

  it('the scanner finds PEM keys (raw or JSON-escaped), private_key fields and JWTs', () => {
    expect(findSecrets(pem)).toHaveLength(1);
    expect(findSecrets(JSON.stringify({ k: pem }))).not.toEqual([]);
    expect(findSecrets(JSON.stringify({ private_key: 'x' }))).toContain('json key: private_key');
    expect(findSecrets(`assertion=${jwt}`)).not.toEqual([]);
  });

  it('the redactor drops private_key fields, replaces keys and search terms', () => {
    const r = new Redactor();
    const out = r.value({ private_key: pem, note: pem, searchTerm: 'jane tan photos', descriptiveName: 'Acme' });
    expect(out).toEqual({
      note: 'REDACTED\n',
      searchTerm: 'redacted searchTerm 1',
      descriptiveName: 'redacted descriptiveName 2',
    });
    expect(findSecrets(JSON.stringify(out))).toEqual([]);
  });
});
