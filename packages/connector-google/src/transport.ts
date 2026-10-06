// The Google Ads REST transport (D-072): `googleAds:searchStream` for reads, on `fetch`, like M02's GraphClient.
// No developer token is sent (D-070). Every request first asks the quota meter (BLUEPRINT M03 build 4), carries
// the manager account in `login-customer-id` when one is set, and is retried only when Google says it's
// temporary: network failures, timeouts, 5xx, and short rate limits.
import type { z } from 'zod';
import {
  type GoogleErrorInfo,
  GoogleAdsApiError,
  GoogleQuotaError,
  GoogleRateLimitError,
  GoogleShapeError,
} from './errors.ts';
import type { GaqlQuery } from './gaql.ts';
import type { AccessTokenProvider } from './tokens.ts';
import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_BASE_URL } from './version.ts';

/** Counts operations against the daily quota before each request; throws (GoogleQuotaError) to stop. */
export interface QuotaMeter {
  consume(operations: number): Promise<void>;
}

export interface GoogleAdsClientOptions {
  tokens: AccessTokenProvider;
  /** The manager account to act through (`login-customer-id`); unset = direct access. */
  loginCustomerId?: string;
  quota?: QuotaMeter;
  fetch?: typeof fetch;
  baseUrl?: string;
  version?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Tries per request, including the first. */
  maxAttempts?: number;
  /** A required wait longer than this throws GoogleRateLimitError instead of sleeping. */
  maxWaitMs?: number;
  /** First back-off delay; doubles per attempt, capped at 30 s. */
  baseDelayMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

const CUSTOMER_ID = /^\d{10}$/;

/** `fetch` rejects with a TypeError on network failure, and with an AbortError or TimeoutError on timeout. */
const isNetworkError = (err: unknown): boolean =>
  err instanceof TypeError || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

/** "30s" / "1.5s" (a protobuf Duration in JSON) → ms. */
const durationMs = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
};

interface ParsedError extends GoogleErrorInfo {
  retryDelayMs?: number;
}

/** Reads Google's error body: `{ error: { code, message, status, details: [GoogleAdsFailure | RetryInfo] } }`. */
export function parseGoogleError(status: number, body: unknown): ParsedError {
  const err = (body as { error?: Record<string, unknown> } | undefined)?.error;
  const info: ParsedError = {
    status,
    message: typeof err?.['message'] === 'string' ? err['message'] : body === undefined ? 'non-JSON response' : 'error',
  };
  if (typeof err?.['status'] === 'string') info.grpcStatus = err['status'];
  const codes: string[] = [];
  for (const d of Array.isArray(err?.['details']) ? (err['details'] as Record<string, unknown>[]) : []) {
    const type = typeof d['@type'] === 'string' ? d['@type'] : '';
    if (type.endsWith('.RetryInfo')) {
      const ms = durationMs(d['retryDelay']);
      if (ms !== undefined) info.retryDelayMs = Math.max(info.retryDelayMs ?? 0, ms);
    }
    if (!type.endsWith('.GoogleAdsFailure')) continue;
    if (typeof d['requestId'] === 'string') info.requestId = d['requestId'];
    for (const e of Array.isArray(d['errors']) ? (d['errors'] as Record<string, unknown>[]) : []) {
      const code = e['errorCode'];
      if (code !== null && typeof code === 'object') {
        for (const [kind, name] of Object.entries(code)) codes.push(`${kind}:${String(name)}`);
      }
      const details = e['details'] as { quotaErrorDetails?: { retryDelay?: unknown } } | undefined;
      const ms = durationMs(details?.quotaErrorDetails?.retryDelay);
      if (ms !== undefined) info.retryDelayMs = Math.max(info.retryDelayMs ?? 0, ms);
    }
  }
  if (codes.length > 0) info.errorCodes = codes;
  return info;
}

export class GoogleAdsClient {
  readonly #tokens: AccessTokenProvider;
  readonly #login: string | undefined;
  readonly #quota: QuotaMeter | undefined;
  readonly #fetch: typeof fetch;
  readonly #base: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;
  readonly #maxWaitMs: number;
  readonly #baseDelayMs: number;
  readonly #timeoutMs: number;
  /** Requests sent, retries included. Each one counts as an operation (a search request is one; GOTCHAS). */
  requestCount = 0;

  constructor(opts: GoogleAdsClientOptions) {
    if (opts.loginCustomerId !== undefined && !CUSTOMER_ID.test(opts.loginCustomerId)) {
      throw new Error('login-customer-id is a 10-digit manager account id, without dashes');
    }
    this.#tokens = opts.tokens;
    this.#login = opts.loginCustomerId;
    this.#quota = opts.quota;
    this.#fetch = opts.fetch ?? fetch;
    this.#base = `${opts.baseUrl ?? GOOGLE_ADS_BASE_URL}/${opts.version ?? GOOGLE_ADS_API_VERSION}`;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#maxAttempts = opts.maxAttempts ?? 5;
    this.#maxWaitMs = opts.maxWaitMs ?? 60_000;
    this.#baseDelayMs = opts.baseDelayMs ?? 1_000;
    this.#timeoutMs = opts.timeoutMs ?? 60_000;
  }

  get loginCustomerId(): string | undefined {
    return this.#login;
  }

  #backoff(attempt: number): number {
    return Math.min(this.#baseDelayMs * 2 ** (attempt - 1), 30_000);
  }

  /** One HTTP exchange, body included: a timeout or reset while the body downloads counts as a failed send. */
  async #send(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: true; res: Response; text: string } | { ok: false; error: unknown }> {
    try {
      this.requestCount++;
      const res = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
      return { ok: true, res, text: await res.text() };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** One request with retries; returns the parsed JSON body. `what` names it in errors (never the token). */
  async #request(
    what: string,
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    login = this.#login,
  ): Promise<unknown> {
    const url = `${this.#base}/${path}`;
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      // Sign in first: a failed sign-in never reaches Google, so it isn't counted as an operation.
      const token = await this.#tokens.getAccessToken();
      await this.#quota?.consume(1);
      const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (login !== undefined && method === 'POST') headers['login-customer-id'] = login;
      const sent = await this.#send(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (sent.ok === false) {
        // Only network failures and timeouts are retried, and they're never rethrown (a network error may quote
        // the request). Anything else, e.g. the test replayer refusing an unexpected request, propagates as it is:
        // it names the query and the manager id, never the authorization header.
        if (!isNetworkError(sent.error)) throw sent.error;
        if (attempt >= this.#maxAttempts) {
          throw new Error(`Google Ads request for ${what} failed after ${attempt} attempts (network or timeout)`);
        }
        await this.#sleep(this.#backoff(attempt));
        continue;
      }
      const { res, text } = sent;
      let parsed: unknown;
      try {
        parsed = text === '' ? undefined : JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      // searchStream answers 200 with an array; an error reported inside the stream is an element with `error`
      // (UNVERIFIED, GOTCHAS), so it's treated like an error response.
      const streamError = Array.isArray(parsed)
        ? (parsed as unknown[]).find((x) => x !== null && typeof x === 'object' && 'error' in x)
        : undefined;
      if (res.ok && parsed !== undefined && streamError === undefined) return parsed;

      const info = parseGoogleError(res.ok ? 500 : res.status, streamError ?? parsed);
      if (res.status === 401 && !refreshed) {
        refreshed = true; // an expired or revoked token: get a fresh one, once
        this.#tokens.invalidate();
        continue;
      }
      const codes = info.errorCodes ?? [];
      if (codes.includes('quotaError:RESOURCE_EXHAUSTED')) {
        throw new GoogleQuotaError(
          `Google refused ${what}: the daily operations limit is reached (request ${info.requestId ?? '?'})`,
        );
      }
      const rateLimited =
        res.status === 429 ||
        codes.includes('quotaError:RESOURCE_TEMPORARILY_EXHAUSTED') ||
        info.grpcStatus === 'RESOURCE_EXHAUSTED';
      if (rateLimited) {
        const wait = Math.max(info.retryDelayMs ?? 0, this.#backoff(attempt));
        if (wait > this.#maxWaitMs || attempt >= this.#maxAttempts)
          throw new GoogleRateLimitError({ ...info, retryAfterMs: wait });
        await this.#sleep(wait);
        continue;
      }
      const transient =
        res.status >= 500 ||
        info.grpcStatus === 'UNAVAILABLE' ||
        info.grpcStatus === 'DEADLINE_EXCEEDED' ||
        codes.includes('internalError:TRANSIENT_ERROR');
      if (transient && attempt < this.#maxAttempts) {
        await this.#sleep(this.#backoff(attempt));
        continue;
      }
      throw new GoogleAdsApiError(info);
    }
  }

  /** Every row a query returns (all batches of the stream), validated one by one. One request = one operation. */
  async search<S extends z.ZodType>(
    customerId: string,
    query: GaqlQuery,
    row: S,
    opts: { loginCustomerId?: string } = {},
  ): Promise<z.infer<S>[]> {
    if (!CUSTOMER_ID.test(customerId)) throw new Error('a Google customer id is 10 digits, without dashes');
    const login = opts.loginCustomerId ?? this.#login;
    if (login !== undefined && !CUSTOMER_ID.test(login)) throw new Error('login-customer-id is a 10-digit account id');
    const what = `${query.resource} on ${customerId}`;
    const body = await this.#request(
      what,
      `customers/${customerId}/googleAds:searchStream`,
      'POST',
      { query: query.text },
      login,
    );
    if (!Array.isArray(body)) throw new GoogleShapeError(what, 'searchStream did not return an array');
    const out: z.infer<S>[] = [];
    for (const [b, batch] of (body as unknown[]).entries()) {
      const results = (batch as { results?: unknown } | null)?.results;
      if (results === undefined) continue; // a batch with no rows (e.g. an empty result)
      if (!Array.isArray(results)) throw new GoogleShapeError(what, `batch ${b}: results is not an array`);
      for (const [i, x] of results.entries()) out.push(parseOrThrow(row, x, `${what} batch ${b} row ${i}`));
    }
    return out;
  }

  /** The customer ids the signed-in identity can reach directly (no customer id, no login-customer-id). */
  async listAccessibleCustomers(): Promise<string[]> {
    const body = (await this.#request('listAccessibleCustomers', 'customers:listAccessibleCustomers', 'GET')) as {
      resourceNames?: unknown;
    };
    const names = body.resourceNames ?? [];
    if (!Array.isArray(names)) throw new GoogleShapeError('listAccessibleCustomers', 'resourceNames is not an array');
    return names.map((n, i) => {
      const m = typeof n === 'string' ? /^customers\/(\d{10})$/.exec(n) : null;
      if (!m?.[1]) throw new GoogleShapeError('listAccessibleCustomers', `resourceNames.${i} is not customers/<id>`);
      return m[1];
    });
  }
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    // Paths and messages only: never the values, which may be names or search terms.
    throw new GoogleShapeError(
      what,
      r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return r.data;
}
