// The replayer: a `fetch` that answers from cassettes instead of the network. An unexpected request fails
// the test loudly, so a connector can't quietly start calling something the fixtures don't cover.
import { type Cassette, matchKey, requestKey } from './cassette.ts';

export interface ReplayFetch {
  fetch: typeof fetch;
  /** Every request served so far, as match keys, in order. */
  calls: string[];
  /** How many recorded exchanges have not been served yet. */
  remaining(): number;
}

export class UnmatchedRequestError extends Error {
  constructor(key: string, known: string[]) {
    super(`no fixture for ${key}${known.length ? `\nknown requests:\n  ${known.join('\n  ')}` : ''}`);
    this.name = 'UnmatchedRequestError';
  }
}

/** Serves each recorded exchange once, in recorded order among requests with the same key. Identical
 *  requests made more often than recorded fail. */
export function replayFetch(cassettes: Cassette | Cassette[]): ReplayFetch {
  const queues = new Map<string, Cassette['exchanges']>();
  for (const c of Array.isArray(cassettes) ? cassettes : [cassettes]) {
    for (const x of c.exchanges) {
      const key = matchKey(x.request.method, x.request.path, x.request.query);
      const q = queues.get(key) ?? [];
      q.push(x);
      queues.set(key, q);
    }
  }
  const calls: string[] = [];

  const replay = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const { path, query } = requestKey(url);
    const key = matchKey(method, path, query);
    const next = queues.get(key)?.shift();
    if (next === undefined) return Promise.reject(new UnmatchedRequestError(key, [...queues.keys()]));
    calls.push(key);
    const body = typeof next.response.body === 'string' ? next.response.body : JSON.stringify(next.response.body);
    return Promise.resolve(new Response(body, { status: next.response.status, headers: next.response.headers }));
  };

  return {
    fetch: replay as typeof fetch,
    calls,
    remaining: () => [...queues.values()].reduce((n, q) => n + q.length, 0),
  };
}
