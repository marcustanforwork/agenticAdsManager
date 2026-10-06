import { replayFetch } from '@ads/connector-testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GoogleAdsApiError,
  GoogleAdsClient,
  GoogleQuotaError,
  GoogleRateLimitError,
  type QuotaMeter,
  StaticTokenProvider,
  gaql,
  parseGoogleError,
} from '../src/index.ts';
import { ACCOUNT, FAKE_TOKEN, MANAGER, streamExchange } from './helpers.ts';

const QUERY = gaql({ from: 'customer', select: ['customer.id'] });
const OK = [{ results: [{ customer: { id: ACCOUNT } }], fieldMask: 'customer.id', requestId: 'r1' }];
const Row = z.looseObject({ customer: z.looseObject({ id: z.string() }) });

const failure = (
  status: number,
  grpc: string,
  codes: Record<string, string>[],
  extra: Record<string, unknown>[] = [],
) => ({
  error: {
    code: status,
    message: `failed ${FAKE_TOKEN}`,
    status: grpc,
    details: [
      {
        '@type': 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure',
        errors: codes.map((errorCode) => ({ errorCode, message: 'm', ...(extra[0] ?? {}) })),
        requestId: 'req-123',
      },
    ],
  },
});

function setup(
  responses: { status: number; body: unknown }[],
  opts: { quota?: QuotaMeter; tokens?: StaticTokenProvider } = {},
) {
  const replay = replayFetch({
    source: 'inline',
    exchanges: responses.map((r) => streamExchange(QUERY.text, r.status, r.body)),
  });
  const sleeps: number[] = [];
  const api = new GoogleAdsClient({
    tokens: opts.tokens ?? new StaticTokenProvider(FAKE_TOKEN),
    loginCustomerId: MANAGER,
    fetch: replay.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...(opts.quota === undefined ? {} : { quota: opts.quota }),
  });
  return { api, replay, sleeps, search: () => api.search(ACCOUNT, QUERY, Row) };
}

describe('GoogleAdsClient.search', () => {
  it('concatenates the rows of every batch', async () => {
    const { search } = setup([
      { status: 200, body: [...OK, { results: [{ customer: { id: '2' } }] }, { fieldMask: 'x' }] },
    ]);
    expect((await search()).map((r) => r.customer.id)).toEqual([ACCOUNT, '2']);
  });

  it('retries 5xx and transient errors with exponential back-off', async () => {
    const { search, sleeps, api } = setup([
      { status: 503, body: { error: { code: 503, message: 'unavailable', status: 'UNAVAILABLE' } } },
      { status: 500, body: failure(500, 'INTERNAL', [{ internalError: 'TRANSIENT_ERROR' }]) },
      { status: 200, body: OK },
    ]);
    expect(await search()).toHaveLength(1);
    expect(sleeps).toEqual([1000, 2000]);
    expect(api.requestCount).toBe(3);
  });

  it("waits for Google's retry delay on a short rate limit, then succeeds", async () => {
    const limited = failure(
      429,
      'RESOURCE_EXHAUSTED',
      [{ quotaError: 'RESOURCE_TEMPORARILY_EXHAUSTED' }],
      [{ details: { quotaErrorDetails: { rateScope: 'CUSTOMER', retryDelay: '5s' } } }],
    );
    const { search, sleeps } = setup([
      { status: 429, body: limited },
      { status: 200, body: OK },
    ]);
    expect(await search()).toHaveLength(1);
    expect(sleeps).toEqual([5000]);
  });

  it('gives up on a long rate limit instead of sleeping', async () => {
    const limited = failure(
      429,
      'RESOURCE_EXHAUSTED',
      [{ quotaError: 'RESOURCE_TEMPORARILY_EXHAUSTED' }],
      [{ details: { quotaErrorDetails: { retryDelay: '120s' } } }],
    );
    const { search, sleeps } = setup([{ status: 429, body: limited }]);
    const err = await search().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleRateLimitError);
    expect((err as GoogleRateLimitError).retryAfterMs).toBe(120_000);
    expect(sleeps).toEqual([]);
  });

  it('never retries the daily operations quota', async () => {
    const { search, replay } = setup([
      { status: 429, body: failure(429, 'RESOURCE_EXHAUSTED', [{ quotaError: 'RESOURCE_EXHAUSTED' }]) },
      { status: 200, body: OK },
    ]);
    await expect(search()).rejects.toBeInstanceOf(GoogleQuotaError);
    expect(replay.remaining()).toBe(1);
  });

  it('surfaces other errors at once, with their codes and request id, and without the token', async () => {
    const { search, replay } = setup([
      { status: 400, body: failure(400, 'INVALID_ARGUMENT', [{ queryError: 'PROHIBITED_FIELD_IN_SELECT_CLAUSE' }]) },
    ]);
    const err = (await search().catch((e: unknown) => e)) as GoogleAdsApiError;
    expect(err).toBeInstanceOf(GoogleAdsApiError);
    expect(err.errorCodes).toEqual(['queryError:PROHIBITED_FIELD_IN_SELECT_CLAUSE']);
    expect(err.requestId).toBe('req-123');
    expect(err.message).toContain('INVALID_ARGUMENT');
    expect(err.message).not.toContain(FAKE_TOKEN);
    expect(replay.remaining()).toBe(0);
  });

  it('treats an error inside a 200 stream as a failure', async () => {
    const { search } = setup([
      { status: 200, body: [...OK, failure(500, 'INTERNAL', [{ internalError: 'INTERNAL_ERROR' }])] },
    ]);
    await expect(search()).rejects.toThrow(/INTERNAL_ERROR/);
  });

  it('gets a fresh token once after a 401', async () => {
    let invalidated = 0;
    const tokens = new StaticTokenProvider(FAKE_TOKEN);
    tokens.invalidate = () => {
      invalidated++;
    };
    const unauth = { error: { code: 401, message: 'expired', status: 'UNAUTHENTICATED' } };
    const ok = setup(
      [
        { status: 401, body: unauth },
        { status: 200, body: OK },
      ],
      { tokens },
    );
    expect(await ok.search()).toHaveLength(1);
    const twice = setup(
      [
        { status: 401, body: unauth },
        { status: 401, body: unauth },
      ],
      { tokens },
    );
    await expect(twice.search()).rejects.toThrow(/401 UNAUTHENTICATED/);
    expect(invalidated).toBe(2);
  });

  it('retries network failures, then fails without quoting the request', async () => {
    const sleeps: number[] = [];
    const api = new GoogleAdsClient({
      tokens: new StaticTokenProvider(FAKE_TOKEN),
      fetch: () => Promise.reject(new TypeError(`fetch failed for Bearer ${FAKE_TOKEN}`)),
      sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
      maxAttempts: 3,
    });
    const err = (await api.search(ACCOUNT, QUERY, Row).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/failed after 3 attempts/);
    expect(err.message).not.toContain(FAKE_TOKEN);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('asks the quota meter before every request, retries included, and stops when it refuses', async () => {
    let used = 0;
    const meter: QuotaMeter = {
      consume: (n) => {
        if (used + n > 2) return Promise.reject(new GoogleQuotaError('soft cap reached: 2 of 2'));
        used += n;
        return Promise.resolve();
      },
    };
    const { search, replay } = setup(
      [
        { status: 503, body: { error: { code: 503, message: 'x', status: 'UNAVAILABLE' } } },
        { status: 200, body: OK },
        { status: 200, body: OK },
      ],
      { quota: meter },
    );
    expect(await search()).toHaveLength(1);
    expect(used).toBe(2);
    await expect(search()).rejects.toThrow(/soft cap/);
    expect(replay.remaining()).toBe(1); // the refused request was never sent
  });

  it('refuses bad ids before calling Google', async () => {
    const { api } = setup([]);
    await expect(api.search('123-456-7890', QUERY, Row)).rejects.toThrow(/10 digits/);
    expect(
      () => new GoogleAdsClient({ tokens: new StaticTokenProvider('t'), loginCustomerId: '111-222-3333' }),
    ).toThrow(/10-digit/);
  });
});

describe('parseGoogleError', () => {
  it('reads RetryInfo and tolerates junk', () => {
    expect(parseGoogleError(503, undefined)).toEqual({ status: 503, message: 'non-JSON response' });
    const info = parseGoogleError(429, {
      error: {
        message: 'slow down',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.5s' }],
      },
    });
    expect(info).toMatchObject({ grpcStatus: 'RESOURCE_EXHAUSTED', retryDelayMs: 1500 });
  });
});
