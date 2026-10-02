// The Graph API transport: GET only (this is the read connector), `appsecret_proof` on every call, cursor
// pagination, and back-off driven by Meta's rate-limit headers (GOTCHAS "Meta rate-limit headers").
import { createHmac } from 'node:crypto';
import type { z } from 'zod';
import { MetaApiError, MetaRateLimitError, MetaShapeError } from './errors.ts';
import { GRAPH_API_VERSION, GRAPH_BASE_URL } from './version.ts';

export interface GraphClientOptions {
  accessToken: string;
  appSecret: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  version?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Tries per request, including the first. */
  maxAttempts?: number;
  /** A required wait longer than this throws MetaRateLimitError instead of sleeping. */
  maxWaitMs?: number;
  /** First back-off delay; doubles per attempt, capped at 30 s. */
  baseDelayMs?: number;
  /** When any usage figure reaches this percentage, pause before returning, to stay under the limit. */
  slowDownAtPct?: number;
  slowDownMs?: number;
  /** Safety stop for runaway pagination. */
  maxPages?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** What the rate-limit headers said on the last response. */
export interface Usage {
  /** The highest usage percentage across every header and business use case (0–100+). */
  maxPct: number;
  /** Meta's estimate of how long until access returns, in ms (0 = not blocked). */
  regainMs: number;
  /** `ads_api_access_tier`, when Meta reports it. */
  tier?: string;
}

/** Throttling error codes: 4 (app), 17 (user), 32 (page), 613 (custom), 80000–80014 (business use cases). */
export const isThrottleCode = (code: number | undefined): boolean =>
  code !== undefined && (code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80000 && code <= 80014));

/** `fetch` rejects with a TypeError on network failure, and with an AbortError or TimeoutError on timeout. */
const isNetworkError = (err: unknown): boolean =>
  err instanceof TypeError || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

/** Codes Meta documents as temporary (unknown / service). */
const isTransientCode = (code: number | undefined): boolean => code === 1 || code === 2;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseJsonHeader(value: string | null): unknown {
  if (value === null || value === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined; // a malformed header is ignored, never fatal
  }
}

/** Reads X-Business-Use-Case-Usage, X-FB-Ads-Insights-Throttle, X-App-Usage and X-Ad-Account-Usage. */
export function parseUsage(headers: Headers): Usage {
  let maxPct = 0;
  let regainMs = 0;
  let tier: string | undefined;
  const seeTier = (t: unknown) => {
    if (typeof t === 'string') tier = t;
  };

  const buc = parseJsonHeader(headers.get('x-business-use-case-usage'));
  if (buc !== null && typeof buc === 'object') {
    for (const entries of Object.values(buc)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries as Record<string, unknown>[]) {
        maxPct = Math.max(maxPct, num(e['call_count']), num(e['total_cputime']), num(e['total_time']));
        regainMs = Math.max(regainMs, num(e['estimated_time_to_regain_access']) * 60_000); // minutes
        seeTier(e['ads_api_access_tier']);
      }
    }
  }
  const insights = parseJsonHeader(headers.get('x-fb-ads-insights-throttle')) as Record<string, unknown> | undefined;
  if (insights && typeof insights === 'object') {
    maxPct = Math.max(maxPct, num(insights['app_id_util_pct']), num(insights['acc_id_util_pct']));
    seeTier(insights['ads_api_access_tier']);
  }
  const app = parseJsonHeader(headers.get('x-app-usage')) as Record<string, unknown> | undefined;
  if (app && typeof app === 'object') {
    maxPct = Math.max(maxPct, num(app['call_count']), num(app['total_cputime']), num(app['total_time']));
  }
  const acc = parseJsonHeader(headers.get('x-ad-account-usage')) as Record<string, unknown> | undefined;
  if (acc && typeof acc === 'object') {
    maxPct = Math.max(maxPct, num(acc['acc_id_util_pct']));
    seeTier(acc['ads_api_access_tier']);
    if (num(acc['acc_id_util_pct']) >= 100) regainMs = Math.max(regainMs, num(acc['reset_time_duration']) * 1000); // seconds
  }
  return tier === undefined ? { maxPct, regainMs } : { maxPct, regainMs, tier };
}

type Params = Record<string, string | number | boolean | object | undefined>;

interface ErrorBody {
  error?: { message?: unknown; code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown; is_transient?: unknown };
}

export class GraphClient {
  readonly #token: string;
  readonly #proof: string;
  readonly #fetch: typeof fetch;
  readonly #base: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;
  readonly #maxWaitMs: number;
  readonly #baseDelayMs: number;
  readonly #slowDownAtPct: number;
  readonly #slowDownMs: number;
  readonly #maxPages: number;
  readonly #timeoutMs: number;
  /** Usage from the most recent response (for logs and the access-tier check). */
  lastUsage: Usage = { maxPct: 0, regainMs: 0 };
  /** Requests sent, retries included. */
  requestCount = 0;

  constructor(opts: GraphClientOptions) {
    if (!opts.accessToken || !opts.appSecret) throw new Error('GraphClient needs an access token and an app secret');
    this.#token = opts.accessToken;
    this.#proof = createHmac('sha256', opts.appSecret).update(opts.accessToken).digest('hex');
    this.#fetch = opts.fetch ?? fetch;
    this.#base = `${opts.baseUrl ?? GRAPH_BASE_URL}/${opts.version ?? GRAPH_API_VERSION}`;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#maxAttempts = opts.maxAttempts ?? 5;
    this.#maxWaitMs = opts.maxWaitMs ?? 60_000;
    this.#baseDelayMs = opts.baseDelayMs ?? 1_000;
    this.#slowDownAtPct = opts.slowDownAtPct ?? 90;
    this.#slowDownMs = opts.slowDownMs ?? 10_000;
    this.#maxPages = opts.maxPages ?? 200;
    this.#timeoutMs = opts.timeoutMs ?? 60_000;
  }

  #url(path: string, params: Params): string {
    const u = new URL(`${this.#base}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    u.searchParams.set('access_token', this.#token);
    u.searchParams.set('appsecret_proof', this.#proof);
    return u.toString();
  }

  #backoff(attempt: number): number {
    return Math.min(this.#baseDelayMs * 2 ** (attempt - 1), 30_000);
  }

  /** One GET, with retries. Returns the parsed JSON body. */
  async getRaw(path: string, params: Params = {}): Promise<unknown> {
    const url = this.#url(path, params);
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        this.requestCount++;
        res = await this.#fetch(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (err) {
        // Only network failures and timeouts are retried. Anything else is a bug (or the test replayer
        // refusing an unexpected request) and propagates as it is.
        if (!isNetworkError(err)) throw err;
        // A network error may quote the URL (and so the token), so it's never rethrown or attached as a cause.
        if (attempt >= this.#maxAttempts) {
          // eslint-disable-next-line preserve-caught-error -- the cause may contain the access token
          throw new Error(`Meta request to ${path} failed after ${attempt} attempts (network or timeout)`);
        }
        await this.#sleep(this.#backoff(attempt));
        continue;
      }
      const usage = parseUsage(res.headers);
      this.lastUsage = usage;
      const text = await res.text();
      let body: unknown;
      try {
        body = text === '' ? {} : JSON.parse(text);
      } catch {
        body = undefined;
      }
      const err = (body as ErrorBody | undefined)?.error;

      if (res.ok && err === undefined && body !== undefined) {
        if (usage.maxPct >= this.#slowDownAtPct) await this.#sleep(this.#slowDownMs);
        return body;
      }

      const code = typeof err?.code === 'number' ? err.code : undefined;
      const info = {
        status: res.status,
        message: typeof err?.message === 'string' ? err.message : body === undefined ? 'non-JSON response' : 'error',
        ...(code === undefined ? {} : { code }),
        ...(typeof err?.error_subcode === 'number' ? { subcode: err.error_subcode } : {}),
        ...(typeof err?.fbtrace_id === 'string' ? { fbtraceId: err.fbtrace_id } : {}),
      };

      if (res.status === 429 || isThrottleCode(code)) {
        const wait = Math.max(usage.regainMs, this.#backoff(attempt));
        if (wait > this.#maxWaitMs || attempt >= this.#maxAttempts) {
          throw new MetaRateLimitError({ ...info, retryAfterMs: wait });
        }
        await this.#sleep(wait);
        continue;
      }
      const transient = res.status >= 500 || err?.is_transient === true || isTransientCode(code);
      if (transient && attempt < this.#maxAttempts) {
        await this.#sleep(this.#backoff(attempt));
        continue;
      }
      throw new MetaApiError(info);
    }
  }

  /** One GET, validated with a zod schema. */
  async get<S extends z.ZodType>(path: string, params: Params, schema: S): Promise<z.infer<S>> {
    return parseOrThrow(schema, await this.getRaw(path, params), path);
  }

  /** Every item of an edge, following `paging.cursors.after` while Meta reports a next page. */
  async getAll<S extends z.ZodType>(path: string, params: Params, item: S): Promise<z.infer<S>[]> {
    const out: z.infer<S>[] = [];
    let after: string | undefined;
    for (let page = 1; ; page++) {
      if (page > this.#maxPages) throw new Error(`Meta pagination for ${path} exceeded ${this.#maxPages} pages`);
      const body = (await this.getRaw(path, after === undefined ? params : { ...params, after })) as {
        data?: unknown;
        paging?: { next?: unknown; cursors?: { after?: unknown } };
      };
      if (!Array.isArray(body.data)) throw new MetaShapeError(path, 'no data array');
      for (const [i, x] of body.data.entries()) out.push(parseOrThrow(item, x, `${path} item ${i}`));
      const cursor = body.paging?.cursors?.after;
      if (typeof body.paging?.next !== 'string' || typeof cursor !== 'string' || cursor === '') return out;
      if (cursor === after) throw new MetaShapeError(path, 'the pagination cursor did not advance');
      after = cursor;
    }
  }
}

function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    // Paths and messages only: never the values, which may be names.
    throw new MetaShapeError(
      what,
      r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return r.data;
}
