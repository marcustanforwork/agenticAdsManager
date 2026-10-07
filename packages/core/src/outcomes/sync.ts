// Reading a product's outcomes (BLUEPRINT M05a): its pack's adapter reads the product's own source, and the
// outcomes are kept in `outcomes`. Each read goes back OUTCOME_LOOKBACK_DAYS, longer than a source may keep
// unconfirmed records (30 days for the first product, D-064): a daily read sees every record at least once, and
// what was read stays stored, so a record the source later deletes is not a deleted outcome.
// Re-reading also refreshes the test flag, so a test domain added later excludes recent outcomes too.
// What the read found is stored on the product for the `outcome_source_fresh` trust check.
import { OutcomeEvent, type OutcomeSourceState } from '@ads/contracts';
import { outcomeSourceOf, setOutcomeSource, upsertOutcomes, type DbOrTx, type Product } from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';

/** How far back each read goes. */
export const OUTCOME_LOOKBACK_DAYS = 35;
/** Outcomes asked for per adapter call; a full page is followed by the next, from its last time. */
export const OUTCOME_PAGE_SIZE = 5000;

export interface OutcomeReadDeps {
  db: DbOrTx;
  packs: PackRegistry;
  /** The environment the pack's adapter reads its connection settings from (e.g. a read-only DB URL). */
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
}

export interface OutcomeReadSummary {
  outcome: 'read' | 'skipped' | 'error';
  detail?: string;
  since?: string;
  /** Outcomes the adapter returned, new ones stored, ones whose test flag changed, and ones left out (an unknown
   *  stage or an invalid event). */
  events?: number;
  new?: number;
  testFlagChanged?: number;
  skipped?: number;
  latestActivityAt?: string | null;
}

const short = (text: string): string => (text.length > 500 ? `${text.slice(0, 497)}...` : text);
const messageOf = (e: unknown): string => short(e instanceof Error ? e.message : String(e));

/** Reads the product's outcomes from its source into `outcomes` and records how the read went. Never throws for a
 *  source problem: it's recorded (`ok: false`) and the trust check fails on it. `readSince` (a resumed cycle's
 *  start) skips a read this cycle already made. */
export async function syncOutcomes(
  deps: OutcomeReadDeps,
  product: Product,
  opts: { readSince?: Date; pageSize?: number } = {},
): Promise<OutcomeReadSummary> {
  const pageSize = opts.pageSize ?? OUTCOME_PAGE_SIZE;
  const { db } = deps;
  const previous = outcomeSourceOf(product);
  if (opts.readSince && previous?.ok === true && Date.parse(previous.checkedAt) >= opts.readSince.getTime()) {
    return { outcome: 'skipped', detail: 'already read in this cycle' };
  }
  const now = deps.now();
  const checkedAt = now.toISOString();
  const failed = async (detail: string): Promise<OutcomeReadSummary> => {
    const state: OutcomeSourceState = { checkedAt, ok: false, latestActivityAt: null, detail: short(detail) };
    await setOutcomeSource(db, product.id, state);
    return { outcome: 'error', detail: state.detail ?? detail };
  };

  let adapter;
  try {
    adapter = deps.packs.get(product.packId).runtime.outcomeAdapter(deps.env, product.settings);
  } catch (e) {
    return failed(`the outcome adapter could not start: ${messageOf(e)}`);
  }
  let health: Awaited<ReturnType<typeof adapter.healthcheck>>;
  try {
    health = await adapter.healthcheck();
  } catch (e) {
    return failed(`the outcome source's health check failed: ${messageOf(e)}`);
  }
  if (health.ok !== true)
    return failed(health.detail === undefined ? 'the outcome source is not healthy' : String(health.detail));

  const since = new Date(now.getTime() - OUTCOME_LOOKBACK_DAYS * 86_400_000);
  const stages = new Set(product.settings.outcomes.stages.map((s) => s.id));
  const counts = { events: 0, new: 0, testFlagChanged: 0, skipped: 0 };
  try {
    for (let from = since; ;) {
      const page = await adapter.fetchSince(from, pageSize);
      counts.events += page.length;
      const valid: OutcomeEvent[] = [];
      for (const raw of page) {
        const parsed = OutcomeEvent.safeParse(raw);
        // An event for a stage the settings don't have (Marcus removed it) is left out, as is a malformed one.
        if (parsed.success && stages.has(parsed.data.stage)) valid.push(parsed.data);
        else counts.skipped++;
      }
      const stored = await upsertOutcomes(db, product.id, valid);
      counts.new += stored.inserted;
      counts.testFlagChanged += stored.testFlagChanged;
      if (page.length < pageSize) break;
      // A full page: the next one starts at the last time seen. If that's no later than this page's start (a whole
      // page at one instant, or no valid time), paging can't go on, and outcomes would be missed: fail the read.
      const next = Math.max(...valid.map((e) => Date.parse(e.occurredAt)));
      if (!(next > from.getTime())) {
        return failed(`a full page of ${pageSize} outcomes didn't move past ${from.toISOString()}: paging stopped`);
      }
      from = new Date(next);
    }
  } catch (e) {
    return failed(`reading outcomes failed: ${messageOf(e)}`);
  }

  // The adapter's values are checked, not trusted: a bad time is "no activity known", not a crash.
  const activity = health.latestActivityAt;
  const latestActivityAt =
    activity instanceof Date && Number.isFinite(activity.getTime()) ? activity.toISOString() : null;
  const state: OutcomeSourceState = {
    checkedAt,
    ok: true,
    latestActivityAt,
    ...(health.detail === undefined ? {} : { detail: short(String(health.detail)) }),
    read: { since: since.toISOString(), ...counts },
  };
  await setOutcomeSource(db, product.id, state);
  return { outcome: 'read', since: since.toISOString(), ...counts, latestActivityAt };
}
