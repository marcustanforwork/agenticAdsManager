// Cassettes: recorded (or hand-written) HTTP exchanges that the replayer serves to a connector in tests.
// One cassette is one JSON file, e.g. packages/connector-meta/fixtures/meta/list-entities.json.
import { canonicalJson } from '@ads/contracts';
import { z } from 'zod';

/** Query parameters that carry secrets. They are stripped before an exchange is stored or matched, so a
 *  cassette never holds them and a replayed request matches whatever token the test client uses. */
export const SECRET_PARAMS = [
  'access_token',
  'appsecret_proof',
  'client_secret',
  'refresh_token',
  'private_key',
  'assertion',
  'id_token',
] as const;

/** Request headers that change the answer, so they're stored and matched (Google's manager-account header).
 *  Nothing else is kept: never `authorization`. */
export const MATCHED_HEADERS = ['login-customer-id'] as const;

export const Exchange = z.object({
  request: z.object({
    method: z.string(),
    /** The URL path without the API version prefix, e.g. `/act_123/campaigns` (so a version bump keeps fixtures). */
    path: z.string().startsWith('/'),
    /** Every query parameter except SECRET_PARAMS, as strings. */
    query: z.record(z.string(), z.string()),
    /** MATCHED_HEADERS that were sent, lower-case names. */
    headers: z.record(z.string(), z.string()).optional(),
    /** The request body, parsed when it is JSON (Google's `{ "query": "<GAQL>" }`). */
    body: z.unknown().optional(),
  }),
  response: z.object({
    status: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
  }),
});
export type Exchange = z.infer<typeof Exchange>;

export const Cassette = z.object({
  /** Where the exchanges came from: `hand-written from …` or `recorded YYYY-MM-DD`. */
  source: z.string(),
  notes: z.string().optional(),
  exchanges: z.array(Exchange),
});
export type Cassette = z.infer<typeof Cassette>;

const VERSION_PREFIX = /^\/v\d+(?:\.\d+)?(?=\/)/;

/** Splits a request URL into the cassette's path (version prefix removed) and its non-secret query. */
export function requestKey(url: string | URL): { path: string; query: Record<string, string> } {
  const u = new URL(url);
  const query: Record<string, string> = {};
  for (const [k, v] of u.searchParams) {
    if (!(SECRET_PARAMS as readonly string[]).includes(k)) query[k] = v;
  }
  return { path: u.pathname.replace(VERSION_PREFIX, ''), query };
}

/** A stable string for matching: method, path, the query with sorted keys, then any matched headers and body. */
export function matchKey(
  method: string,
  path: string,
  query: Record<string, string>,
  extra: { headers?: Record<string, string> | undefined; body?: unknown } = {},
): string {
  const sorted = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? '')}`)
    .join('&');
  const headers =
    extra.headers && Object.keys(extra.headers).length > 0 ? ` headers=${canonicalJson(extra.headers)}` : '';
  const body = extra.body === undefined ? '' : ` body=${canonicalJson(extra.body)}`;
  return `${method.toUpperCase()} ${path}${sorted ? `?${sorted}` : ''}${headers}${body}`;
}

/** The key of a stored exchange's request. */
export const exchangeKey = (r: Exchange['request']): string =>
  matchKey(r.method, r.path, r.query, { headers: r.headers, body: r.body });

/** What a `fetch` call asks for, in cassette terms: method, path, query, matched headers and the body. */
export function requestParts(input: Parameters<typeof fetch>[0], init?: RequestInit): Exchange['request'] {
  const url = input instanceof Request ? input.url : input;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const { path, query } = requestKey(url);
  const sent = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const headers: Record<string, string> = {};
  for (const h of MATCHED_HEADERS) {
    const v = sent.get(h);
    if (v !== null) headers[h] = v;
  }
  const out: Exchange['request'] = { method, path, query };
  if (Object.keys(headers).length > 0) out.headers = headers;
  const raw = init?.body;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'string') throw new Error('cassettes support string request bodies only');
    try {
      out.body = JSON.parse(raw);
    } catch {
      out.body = raw;
    }
  }
  return out;
}
