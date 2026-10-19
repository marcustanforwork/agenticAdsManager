// The ad platforms, faked from the connectors' hand-written cassettes (the same fixture accounts core's cycle tests
// use). Unlike a test's one-shot replay, this one answers every cycle of a rehearsal, on whatever day the clock
// says: the queries' date windows are moved to the run's windows (core's helpers), and so are the dates inside the
// responses, so the fixture's three days of data are always the three days before "today". Google's click ids are
// read one day per query for up to 90 days on a first sync; a day the fixture doesn't cover answers no rows.
import { type Cassette, replayFetch, type ReplayFetch, UnmatchedRequestError } from '@ads/connector-testing';
import { daysFrom, localDate, minusDays } from '@ads/contracts';
import { googleCassettes, metaCassettes } from '@ads/core/testing';

export { GOOGLE_ACCOUNT, GOOGLE_MANAGER, META_ACCOUNT, META_DATASET, tokenFetch } from '@ads/core/testing';

/** The last day of data in the fixtures. */
const FIXTURE_LAST_DAY = '2026-09-30';
const TZ = 'Asia/Singapore';
const PURE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every "YYYY-MM-DD" string inside `value`, moved by `days`. */
function shiftDates(value: unknown, days: number): unknown {
  if (typeof value === 'string') return PURE_DATE.test(value) ? minusDays(value, -days) : value;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  }
  return value;
}

/** The fixtures as a run at `now` asks for them, with the data ending yesterday. */
export function cassettesAt(now: Date): Cassette[] {
  const yesterday = minusDays(localDate(now, TZ), 1);
  const shift = daysFrom(FIXTURE_LAST_DAY, yesterday);
  return [...metaCassettes(now), ...googleCassettes(now)].map((c) => ({
    ...c,
    exchanges: c.exchanges.map((x) => ({
      ...x,
      response: { ...x.response, body: shiftDates(x.response.body, shift) },
    })),
  }));
}

export interface FakePlatforms {
  fetch: typeof fetch;
  /** Every request served, as match keys. */
  calls: string[];
}

const isClickQuery = (init: RequestInit | undefined): boolean =>
  typeof init?.body === 'string' && init.body.includes('FROM click_view');

/** A fetch that answers from the fixtures for the day `now()` says, as often as asked. */
export function fakePlatforms(now: () => Date): FakePlatforms {
  let day = '';
  let replay: ReplayFetch = replayFetch([]);
  const calls: string[] = [];
  const fresh = (): ReplayFetch => {
    day = localDate(now(), TZ);
    replay = replayFetch(cassettesAt(now()));
    return replay;
  };
  const answer = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    if (localDate(now(), TZ) !== day) fresh();
    try {
      const res = await replay.fetch(input, init);
      calls.push(replay.calls.at(-1) ?? '');
      return res;
    } catch (error) {
      if (!(error instanceof UnmatchedRequestError)) throw error;
      if (isClickQuery(init)) return new Response('[]', { headers: { 'content-type': 'application/json' } });
      // Each recorded exchange is served once per replay: a later cycle the same day starts a fresh copy.
      const res = await fresh().fetch(input, init);
      calls.push(replay.calls.at(-1) ?? '');
      return res;
    }
  };
  return { fetch: answer as typeof fetch, calls };
}
