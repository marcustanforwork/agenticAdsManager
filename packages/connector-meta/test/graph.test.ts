import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GRAPH_API_VERSION,
  GraphClient,
  MetaApiError,
  MetaRateLimitError,
  MetaShapeError,
  parseUsage,
} from '../src/index.ts';
import { FAKE_TOKEN } from './helpers.ts';

const SECRET = 'test-app-secret-0123456789';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | 'network-error';

/** A fetch that answers from a script, one reply per call, and remembers the URLs. */
function scripted(replies: Reply[]) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const fetchFn = ((url: string) => {
    urls.push(url);
    const r = replies.shift();
    if (r === undefined) throw new Error('script exhausted');
    if (r === 'network-error')
      return Promise.reject(new TypeError('fetch failed', { cause: new Error(`connect ECONNRESET ${url}`) }));
    return Promise.resolve(
      new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers ?? {} }),
    );
  }) as unknown as typeof fetch;
  const client = (opts: Partial<ConstructorParameters<typeof GraphClient>[0]> = {}) =>
    new GraphClient({
      accessToken: FAKE_TOKEN,
      appSecret: SECRET,
      fetch: fetchFn,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      ...opts,
    });
  return { urls, sleeps, client };
}

const buc = (minutes: number, pct = 100) =>
  JSON.stringify({
    '1234567890': [
      {
        type: 'ads_management',
        call_count: pct,
        total_cputime: 10,
        total_time: 10,
        estimated_time_to_regain_access: minutes,
      },
    ],
  });
const throttled = (minutes: number): Reply => ({
  status: 400,
  body: {
    error: { message: 'User request limit reached', type: 'OAuthException', code: 80004, error_subcode: 2446079 },
  },
  headers: { 'x-business-use-case-usage': buc(minutes) },
});

describe('requests', () => {
  it('pins the API version and signs every call with appsecret_proof', async () => {
    const s = scripted([{ body: { id: '1' } }]);
    await s.client().getRaw('act_1', { fields: 'id', time_range: { since: '2026-09-01', until: '2026-09-02' } });
    const url = new URL(s.urls[0]!);
    expect(url.pathname).toBe(`/${GRAPH_API_VERSION}/act_1`);
    expect(GRAPH_API_VERSION).toBe('v26.0');
    expect(url.searchParams.get('appsecret_proof')).toBe(createHmac('sha256', SECRET).update(FAKE_TOKEN).digest('hex'));
    expect(url.searchParams.get('time_range')).toBe('{"since":"2026-09-01","until":"2026-09-02"}');
    expect(url.searchParams.has('date_format')).toBe(false); // errors on every version from 2026-10-27
  });

  it('needs a token and an app secret', () => {
    expect(() => new GraphClient({ accessToken: '', appSecret: SECRET })).toThrow(/access token and an app secret/);
  });
});

describe('pagination', () => {
  const item = z.object({ id: z.string() });

  it('follows the after cursor while Meta reports a next page', async () => {
    const s = scripted([
      { body: { data: [{ id: '1' }], paging: { next: 'https://…', cursors: { after: 'A' } } } },
      { body: { data: [{ id: '2' }], paging: { next: 'https://…', cursors: { after: 'B' } } } },
      { body: { data: [{ id: '3' }], paging: { cursors: { after: 'C' } } } },
    ]);
    expect(await s.client().getAll('act_1/ads', { limit: 2 }, item)).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(s.urls.map((u) => new URL(u).searchParams.get('after'))).toEqual([null, 'A', 'B']);
  });

  it('stops on a cursor that does not advance, and at the page limit', async () => {
    const loop = { body: { data: [], paging: { next: 'https://…', cursors: { after: 'A' } } } };
    await expect(scripted([loop, loop]).client().getAll('x', {}, item)).rejects.toBeInstanceOf(MetaShapeError);
    const pages = [1, 2, 3].map((n) => ({
      body: { data: [], paging: { next: 'https://…', cursors: { after: `c${n}` } } },
    }));
    await expect(scripted(pages).client({ maxPages: 2 }).getAll('x', {}, item)).rejects.toThrow(/exceeded 2 pages/);
  });

  it('rejects a page without a data array', async () => {
    await expect(
      scripted([{ body: { nope: 1 } }])
        .client()
        .getAll('x', {}, item),
    ).rejects.toThrow(/no data array/);
  });
});

describe('rate-limit back-off', () => {
  it('backs off exponentially on a throttling error, then succeeds', async () => {
    const s = scripted([throttled(0), throttled(0), { body: { ok: true } }]);
    expect(await s.client().getRaw('x')).toEqual({ ok: true });
    expect(s.sleeps).toEqual([1_000, 2_000]);
  });

  it("waits for Meta's estimated time to regain access when it is longer", async () => {
    const s = scripted([throttled(1), { body: { ok: true } }]);
    await s.client().getRaw('x');
    expect(s.sleeps).toEqual([60_000]);
  });

  it('gives up with MetaRateLimitError when the wait is longer than the client will wait', async () => {
    const s = scripted([throttled(30)]);
    const err = await s
      .client()
      .getRaw('x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaRateLimitError);
    expect((err as MetaRateLimitError).retryAfterMs).toBe(30 * 60_000);
    expect((err as MetaRateLimitError).code).toBe(80004);
    expect(s.sleeps).toEqual([]);
  });

  it('gives up after maxAttempts', async () => {
    const s = scripted([throttled(0), throttled(0), throttled(0)]);
    await expect(s.client({ maxAttempts: 3 }).getRaw('x')).rejects.toBeInstanceOf(MetaRateLimitError);
    expect(s.sleeps).toEqual([1_000, 2_000]);
  });

  it('treats HTTP 429 as throttling', async () => {
    const s = scripted([{ status: 429, body: {} }, { body: { ok: 1 } }]);
    await s.client().getRaw('x');
    expect(s.sleeps).toEqual([1_000]);
  });

  it('slows down when usage reaches the threshold, without failing', async () => {
    const s = scripted([{ body: { ok: 1 }, headers: { 'x-business-use-case-usage': buc(0, 95) } }]);
    const c = s.client();
    await c.getRaw('x');
    expect(s.sleeps).toEqual([10_000]);
    expect(c.lastUsage.maxPct).toBe(95);
  });
});

describe('errors', () => {
  it('retries transient server errors and network failures', async () => {
    const s = scripted([
      { status: 500, body: { error: { message: 'x', code: 2, is_transient: true } } },
      'network-error',
      { body: { ok: 1 } },
    ]);
    expect(await s.client().getRaw('x')).toEqual({ ok: 1 });
    expect(s.sleeps).toEqual([1_000, 2_000]);
  });

  it('does not retry a permanent error, and keeps the codes', async () => {
    const s = scripted([
      {
        status: 400,
        body: { error: { message: 'Invalid parameter', code: 100, error_subcode: 33, fbtrace_id: 'Atrace' } },
      },
    ]);
    const err = (await s
      .client()
      .getRaw('x')
      .catch((e: unknown) => e)) as MetaApiError;
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).not.toBeInstanceOf(MetaRateLimitError);
    expect([err.status, err.code, err.subcode, err.fbtraceId]).toEqual([400, 100, 33, 'Atrace']);
    expect(s.sleeps).toEqual([]);
  });

  it('does not retry an error that is not a network failure', async () => {
    let calls = 0;
    const c = new GraphClient({
      accessToken: FAKE_TOKEN,
      appSecret: SECRET,
      fetch: () => {
        calls++;
        return Promise.reject(new RangeError('a bug'));
      },
    });
    await expect(c.getRaw('x')).rejects.toThrow('a bug');
    expect(calls).toBe(1);
  });

  it('retries a timeout', async () => {
    let calls = 0;
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const c = new GraphClient({
      accessToken: FAKE_TOKEN,
      appSecret: SECRET,
      sleep: () => Promise.resolve(),
      fetch: () => (++calls === 1 ? Promise.reject(timeout) : Promise.resolve(new Response('{"ok":1}'))),
    });
    expect(await c.getRaw('x')).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });

  it('never puts the token in an error message', async () => {
    const net = scripted(['network-error', 'network-error']);
    const e1 = await net
      .client({ maxAttempts: 2 })
      .getRaw('x')
      .catch((e: unknown) => e);
    expect(String(e1)).toMatch(/network/);
    expect(String(e1)).not.toContain(FAKE_TOKEN);

    const echo = scripted([{ status: 400, body: { error: { message: `Bad token ${FAKE_TOKEN}`, code: 190 } } }]);
    const e2 = await echo
      .client()
      .getRaw('x')
      .catch((e: unknown) => e);
    expect(String(e2)).not.toContain(FAKE_TOKEN);
  });
});

describe('parseUsage', () => {
  it('takes the highest figure across every header, and ignores malformed ones', () => {
    const h = new Headers({
      'x-business-use-case-usage': buc(2, 40),
      'x-fb-ads-insights-throttle':
        '{"app_id_util_pct":75,"acc_id_util_pct":3,"ads_api_access_tier":"standard_access"}',
      'x-app-usage': 'not json',
    });
    expect(parseUsage(h)).toEqual({ maxPct: 75, regainMs: 120_000, tier: 'standard_access' });
    expect(parseUsage(new Headers())).toEqual({ maxPct: 0, regainMs: 0 });
  });

  it('reads the ad-account reset time when the account is at its limit', () => {
    const h = new Headers({ 'x-ad-account-usage': '{"acc_id_util_pct":100,"reset_time_duration":90}' });
    expect(parseUsage(h)).toEqual({ maxPct: 100, regainMs: 90_000 });
  });
});
