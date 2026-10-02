// Cassettes: recorded (or hand-written) HTTP exchanges that the replayer serves to a connector in tests.
// One cassette is one JSON file, e.g. packages/connector-meta/fixtures/meta/list-entities.json.
import { z } from 'zod';

/** Query parameters that carry secrets. They are stripped before an exchange is stored or matched, so a
 *  cassette never holds them and a replayed request matches whatever token the test client uses. */
export const SECRET_PARAMS = ['access_token', 'appsecret_proof', 'client_secret', 'refresh_token'] as const;

export const Exchange = z.object({
  request: z.object({
    method: z.string(),
    /** The URL path without the API version prefix, e.g. `/act_123/campaigns` (so a version bump keeps fixtures). */
    path: z.string().startsWith('/'),
    /** Every query parameter except SECRET_PARAMS, as strings. */
    query: z.record(z.string(), z.string()),
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

/** A stable string for matching: method, path and the query with sorted keys. */
export function matchKey(method: string, path: string, query: Record<string, string>): string {
  const sorted = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? '')}`)
    .join('&');
  return `${method.toUpperCase()} ${path}${sorted ? `?${sorted}` : ''}`;
}
