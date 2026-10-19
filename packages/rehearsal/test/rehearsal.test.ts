// The pre-live rehearsal (F3, D-092): the first live weekend, end to end, in the order of the live steps, on a fresh
// database. Each `it` is one stretch of Marcus's checklist and builds on the ones before it, so they run in order.
// Only the outside world is faked (support/): the ad platforms (cassettes), Google's sign-in, SnapPool's database,
// the AI, Telegram, the healthchecks pings and the clock. Everything else is the code that will run on the SER9:
// the migration script, the `ads` CLI, the worker service, the Telegram bot's handlers, the request processor, and
// the dashboard's loaders and pages under its own database role.
import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GOOGLE_TOKEN_URL } from '@ads/connector-google';
import { Overview } from '@ads/app-web/app/products/[slug]/overview/Overview.tsx';
import { Proposals } from '@ads/app-web/app/products/[slug]/proposals/Proposals.tsx';
import { fieldsOf } from '@ads/app-web/lib/forms.ts';
import { briefFeedbackRequest } from '@ads/app-web/lib/reviewForms.ts';
import { loadOverview, loadProposals } from '@ads/app-web/lib/reviewViews.ts';
import { getProductView } from '@ads/app-web/lib/views.ts';
import {
  type Database,
  type DbOrTx,
  connect,
  findProductBySlug,
  getFlag,
  getRequestStatus,
  listCycles,
  recordWebRequest,
  schema,
} from '@ads/db';
import { sql } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_TEST_DATABASE_URL } from '@ads/db/testing';
import { createFixtureDb, seedFixtures, type FixtureDb } from '@ads/pack-saas-snappool/testing';
import pg from 'pg';
import { missedToday } from '@ads/app-worker/schedule.ts';
import { type RunningWorker, enqueueScheduled, startWorker } from '@ads/app-worker/worker.ts';
import { minusDays } from '@ads/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CliContext, ads } from './support/cli.ts';
import { BRIEF_HEADLINE, fakeModel } from './support/model.ts';
import {
  GOOGLE_ACCOUNT,
  GOOGLE_MANAGER,
  META_ACCOUNT,
  META_DATASET,
  fakePlatforms,
  tokenFetch,
} from './support/platforms.ts';
import { type ChatMessage, OWNER_ID, fakeTelegram } from './support/telegram.ts';

const run = promisify(execFile);
const REPO = join(import.meta.dirname, '..', '..', '..');
const ADMIN_URL = process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;

/** Sunday 4 October 2026, 16:00 in Singapore: the setup weekend. The worker starts on Monday morning. */
let clock = new Date('2026-10-04T08:00:00Z');
const now = (): Date => clock;

const dbName = `ads_rehearsal_${randomBytes(6).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let snappool: FixtureDb;
let worker: RunningWorker | null = null;
let database: Database;
const platforms = fakePlatforms(now);
const model = fakeModel();
const telegram = fakeTelegram();
const env: Record<string, string> = {
  DATABASE_URL: dbUrl,
  VAULT_READ_KEY: `read-v1:${randomBytes(32).toString('base64')}`,
  OPERATOR_ACTORS: 'cli:marcus,web:marcus@example.com',
  ADS_OPERATOR: 'marcus',
  TELEGRAM_OWNER_ID: String(OWNER_ID),
  HEALTHCHECK_WORKER_URL: 'https://hc.invalid/worker-alive',
  HEALTHCHECK_DAILY_SYNC_URL: 'https://hc.invalid/daily-sync',
};
const cli: CliContext = { env, fetch: platforms.fetch, tokenFetch, now, model: model.model };

const logs: { msg: string; obj: Record<string, unknown> }[] = [];
const logger = {
  info: (obj: object, msg: string) => void logs.push({ msg, obj: obj as Record<string, unknown> }),
  warn: (obj: object, msg: string) => void logs.push({ msg, obj: obj as Record<string, unknown> }),
  error: (obj: object, msg: string) => void logs.push({ msg, obj: obj as Record<string, unknown> }),
};
const pings: string[] = [];

/** The platforms with a gate: while `hold` is set, every request waits for its release (a sync in flight). */
let hold: { arrived: () => void; released: Promise<void> } | null = null;
const gatedFetch: typeof fetch = async (input, init) => {
  const h = hold;
  if (h !== null) {
    h.arrived();
    await h.released;
  }
  return platforms.fetch(input, init);
};

const running = (): RunningWorker => {
  if (worker === null) throw new Error('the worker is not running');
  return worker;
};

async function snappoolProduct() {
  const product = await findProductBySlug(database.db, 'snappool');
  if (product === null) throw new Error('no snappool product');
  return product;
}

/** A morning at 08:30 in Singapore: the schedule's runs due by then are queued (as croner would), and done. */
async function morning(day: string): Promise<void> {
  await traffic(minusDays(day, 1));
  clock = new Date(`${day}T00:30:00Z`);
  for (const kind of missedToday(now())) await enqueueScheduled(database.db, kind, now());
  await settled();
}

/** Runs `fn` as the dashboard's database role (`agent_dashboard`), as every dashboard page does. */
const asDashboard = <T>(fn: (db: DbOrTx) => Promise<T>): Promise<T> =>
  database.db.transaction(async (tx) => {
    await tx.execute(sql`set local role agent_dashboard`);
    return fn(tx);
  });

/** A page's HTML as words: tags removed, entities decoded, spaces collapsed. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

/** A day of SnapPool traffic: a signup from a Meta click every day and from a Google click every other day, each
 *  with its click id (SnapPool's `sp_attr`, T6b). The Meta ones came through the paused Retargeting campaign and the
 *  Google ones carry a click id the account never reported, so both platforms are attributable but neither active
 *  campaign gets a signup: the spend-without-outcomes rule has something to find. The emails are made up. */
async function traffic(day: string): Promise<void> {
  const signup = (n: string, attribution: Record<string, string>) =>
    snappool.query(
      `insert into pool_requests (email, title, event_type, status, created_at, claimed_at, attribution)
       values ($1, 'My event', 'party', 'claimed', $2, $3, $4)`,
      [`guest-${day}-${n}@example.com`, `${day}T02:00:00Z`, `${day}T02:05:00Z`, JSON.stringify(attribution)],
    );
  await signup('m', {
    fbclid: `IwAR-rehearsal-${day}`,
    utm_source: 'meta',
    utm_campaign: '120200000000000002',
    landing_url: '/start',
  });
  if (Number(day.slice(8)) % 2 === 0) {
    await signup('g', { gclid: `Cj0-rehearsal-${day}`, utm_source: 'google', landing_url: '/start' });
  }
}

/** The worker as `docker compose up` starts it, with its schedule off: the catch-up queues the day's due runs. */
async function startTheWorker(fetchFn: typeof fetch = gatedFetch): Promise<RunningWorker> {
  const worker = await startWorker({
    env,
    logger,
    now,
    fetch: fetchFn,
    tokenFetch,
    model: model.model,
    pingFetch: (url) => {
      pings.push(url instanceof Request ? url.url : url.toString());
      return Promise.resolve(new Response('OK'));
    },
    telegram: { api: telegram.api, startPolling: telegram.startPolling },
    leaderRetryMs: 50,
    queuePollMs: 100,
    outboxMs: 100,
    requestPollMs: 200,
    schedule: false,
  });
  if (worker === null) throw new Error('the worker did not start (no DATABASE_URL or VAULT_READ_KEY?)');
  await vi.waitFor(() => expect(worker.isLeader()).toBe(true), { timeout: 5_000 });
  return worker;
}

/** Waits until the worker queue has no job left to run and the outbox is empty. */
async function settled(): Promise<void> {
  const w = running();
  await vi.waitFor(
    async () => {
      const jobs = await database.db.select().from(schema.jobs);
      expect(jobs.filter((j) => j.status !== 'done' && j.status !== 'failed')).toEqual([]);
      await w.sendOutboxNow();
      const unsent = await database.pool.query('select 1 from notifications where sent_at is null');
      expect(unsent.rowCount).toBe(0);
    },
    { timeout: 30_000, interval: 200 },
  );
}

/** The one message in Marcus's chat that contains `text`. */
function message(text: string): ChatMessage {
  const found = telegram.chat.filter((m) => m.text.includes(text));
  if (found.length !== 1) throw new Error(`${found.length} messages contain ${JSON.stringify(text)}`);
  return found[0] as ChatMessage;
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  // An empty database, as a new Neon branch is: the migration script builds everything (M01a step 3).
  await admin((c) => c.query(`create database "${dbName}"`));
  snappool = await createFixtureDb();
  await seedFixtures(snappool);
  env['SNAPPOOL_DATABASE_URL'] = snappool.url;
  database = connect(dbUrl, { max: 3 });
});

afterAll(async () => {
  await worker?.stop();
  await database?.close();
  await snappool?.drop();
  await admin((c) => c.query(`drop database if exists "${dbName}" with (force)`));
});

describe('the first live weekend, rehearsed', () => {
  it('M01a: the migration script runs twice on an empty database, then `ads seed` creates both products', async () => {
    for (let i = 0; i < 2; i++) {
      const { stdout } = await run('pnpm', ['--silent', '--filter', '@ads/db', 'db:migrate'], {
        cwd: REPO,
        env: { ...process.env, DATABASE_URL: dbUrl },
      });
      expect(stdout).toContain('migrations and roles.sql applied');
    }
    const seeded = (await ads(cli, ['seed'])).json();
    expect(seeded).toMatchObject({ productsCreated: ['snappool', 'property-sg'], docsCreated: 6 });
    expect((await ads(cli, ['seed'])).json()).toMatchObject({ productsCreated: [], docsCreated: 0 });
    // M01a step 6: what the Neon SQL editor shows.
    const products = await database.pool.query<{ slug: string; status: string; settings_version: number }>(
      'select slug, status, settings_version from products order by slug',
    );
    expect(products.rows).toEqual([
      { slug: 'property-sg', status: 'dormant', settings_version: 1 },
      { slug: 'snappool', status: 'active', settings_version: 1 },
    ]);
    expect(await getFlag(database.db, 'writes_enabled')).toBe(false);
    expect((await ads(cli, ['phase'])).json()).toEqual({ phase: 0 });
  });

  it('M02, M03: the accounts are linked, their read credentials stored, and the dry syncs read them', async () => {
    const link = await ads(cli, [
      'accounts',
      'link',
      '--product',
      'snappool',
      '--platform',
      'meta',
      '--account',
      META_ACCOUNT,
    ]);
    expect(link.exitCode).toBe(0);
    const metaKey = JSON.stringify({ accessToken: `EAA${'r'.repeat(40)}`, appSecret: 'a'.repeat(32) });
    const put = await ads(cli, ['credentials', 'put', '--account', `meta:${META_ACCOUNT}`, '--role', 'read'], metaKey);
    expect(put.printed.join('\n')).not.toContain('EAA');

    await ads(cli, [
      'accounts',
      'link',
      '--product',
      'snappool',
      '--platform',
      'google',
      '--account',
      GOOGLE_ACCOUNT,
      '--manager',
      GOOGLE_MANAGER,
    ]);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const googleKey = JSON.stringify({
      type: 'service_account',
      client_email: 'ads-agent-read@rehearsal.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: GOOGLE_TOKEN_URL,
    });
    await ads(cli, ['credentials', 'put', '--account', `google:${GOOGLE_ACCOUNT}`, '--role', 'read'], googleKey);

    const meta = await ads(cli, ['sync', '--product', 'snappool', '--platform', 'meta', '--dry']);
    expect(meta.exitCode).toBe(0);
    expect(meta.json()).toMatchObject({
      dryRun: true,
      accounts: [{ account: `meta:${META_ACCOUNT}`, outcome: 'read' }],
    });
    const google = await ads(cli, ['sync', '--product', 'snappool', '--platform', 'google', '--dry']);
    expect(google.exitCode).toBe(0);
    const report = google.json<{ accounts: { outcome: string; requests: number }[] }>();
    expect(report.accounts).toMatchObject([{ outcome: 'read' }]);
    expect(report.accounts[0]?.requests).toBeLessThan(200); // M03 step 5
  });

  it('M05a, M05b: outcomes are read from SnapPool, the starting settings set, and the KPI switched and back', async () => {
    const outcomes = await ads(cli, ['outcomes', '--product', 'snappool']);
    expect(outcomes.exitCode).toBe(0);
    expect(outcomes.json()).toMatchObject({ read: { outcome: 'read' } });

    const patch = {
      testTraffic: { emailDomains: ['staff.example'] },
      spend: { monthlyCeilingMicros: '500000000', dailyCeilingMicros: '25000000' },
    };
    const set = await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(patch)]);
    expect(set.json()).toMatchObject({ status: 'done', version: 2 });
    const paid = { outcomes: { primaryKpiStage: 'paid' } };
    expect(
      (await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(paid)])).json(),
    ).toMatchObject({
      status: 'done',
    });
    expect((await ads(cli, ['outcomes', '--product', 'snappool', '--no-read'])).json()).toMatchObject({
      kpiStage: 'paid',
    });
    const back = { outcomes: { primaryKpiStage: 'signup' } };
    expect(
      (await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(back)])).json(),
    ).toMatchObject({
      status: 'done',
    });

    const docs = (await ads(cli, ['docs', 'list', '--product', 'snappool'])).json<{ docs: { version: number }[] }>();
    expect(docs.docs).toHaveLength(3);
    const product = await findProductBySlug(database.db, 'snappool');
    expect(product?.timezone).toBe('Asia/Singapore');
    expect(await listCycles(database.db, product?.id ?? '')).toEqual([]);
    expect(await database.db.select().from(schema.notifications)).toEqual([]);
  });

  it('M07: on Monday morning the worker catches up: the digest, and at phase 0 the brief with no proposal', async () => {
    clock = new Date('2026-10-05T00:30:00Z');
    worker = await startTheWorker();
    await settled();
    expect(logs.map((l) => l.msg)).toEqual(
      expect.arrayContaining(['startup reconciliation done', 'daily cycles done', 'weekly cycles done']),
    );
    // The daily and the weekly jobs run independently, so the two messages come in either order.
    expect(telegram.chat).toHaveLength(2);
    const digest = message('<b>SnapPool · 2026-10-04</b>');
    const brief = message('<b>SnapPool: weekly brief, 2026-09-28 to 2026-10-04</b>');
    expect(digest.text).toContain('Open proposals: 0');
    expect(brief.text).toContain(BRIEF_HEADLINE);
    // Phase 0: the analyst ran on the weekly cycle, nothing was drafted.
    expect(model.calls.map((c) => c.stage)).toEqual(['analyst', 'brief']);
    expect(await database.db.select().from(schema.proposals)).toEqual([]);
    // The test-email domain set after the first read still marks that signup as a test (upsertOutcomes).
    const tests = await database.pool.query<{ n: number }>(
      `select count(*)::int as n from outcomes where is_test and stage = 'signup'`,
    );
    expect(tests.rows[0]?.n).toBeGreaterThan(0);
    // Heartbeats: alive, and the daily run reported in.
    expect(pings).toContain('https://hc.invalid/worker-alive');
    expect(pings).toContain('https://hc.invalid/daily-sync');

    // M07 step 5: 👍 and 💡 on the brief; `ads brief` shows them and who wrote the prose.
    expect(await telegram.press(brief, '👍')).toBe('recorded');
    expect(await telegram.press(brief, '💡')).toBe('recorded');
    expect(telegram.toasts.at(-1)).toBe('Saved: useful yes, new to me yes');
    const shown = (await ads(cli, ['brief', '--product', 'snappool'])).json();
    expect(shown).toMatchObject({
      kind: 'weekly',
      usedTemplateFallback: false,
      writer: { source: 'model', model: 'anthropic:claude-opus-5-5' },
      feedback: { useful: true, newInfo: true },
    });

    // M09b steps 2 and 3: /status, and a lower daily ceiling from Telegram.
    let mark = telegram.chat.length;
    expect(await telegram.say('/status')).toBe('command:shown');
    const status = telegram
      .since(mark)
      .map((m) => m.text)
      .join('\n');
    expect(status).toContain('phase 0 · writes off');
    expect(status).toContain('<b>snappool</b>: ▶️ active');
    expect(status).toContain('<b>property-sg</b>: 💤 dormant');
    mark = telegram.chat.length;
    expect(await telegram.say('/ceiling snappool daily 20')).toBe('command:recorded');
    expect(telegram.since(mark).map((m) => m.text)).toEqual([
      'snappool daily ceiling: S$25.00 → S$20.00 (settings v5).',
    ]);
  }, 60_000);

  it('M04, M07: on Tuesday the worker is restarted while its daily cycle syncs, and the next start resumes it', async () => {
    clock = new Date('2026-10-06T00:30:00Z');
    let arrived = (): void => undefined;
    let release = (): void => undefined;
    const arrival = new Promise<void>((resolve) => (arrived = resolve));
    hold = { arrived, released: new Promise<void>((resolve) => (release = resolve)) };
    await enqueueScheduled(database.db, 'daily', now());
    await arrival; // the sync has started
    // `docker compose restart worker`: SIGTERM, the cycle stops at the end of its stage, the job is released.
    const stopping = running().stop();
    worker = null;
    hold = null;
    release();
    await stopping;
    const product = await snappoolProduct();
    const tuesday = (await listCycles(database.db, product.id)).filter((c) => c.cycleDate === '2026-10-06');
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0]).toMatchObject({ kind: 'daily', finishedAt: null });
    const jobs = await database.db.select().from(schema.jobs);
    expect(jobs.filter((j) => j.status !== 'done').map((j) => [j.kind, j.status])).toEqual([['daily', 'queued']]);

    const mark = telegram.chat.length;
    logs.length = 0;
    worker = await startTheWorker();
    expect(logs.find((l) => l.msg === 'startup reconciliation done')?.obj).toMatchObject({ cyclesResumed: 1 });
    await settled();
    expect((await listCycles(database.db, product.id)).filter((c) => c.cycleDate === '2026-10-06')).toMatchObject([
      { stageReached: 'done' },
    ]);
    const texts = telegram.since(mark).map((m) => m.text);
    expect(texts).toHaveLength(2);
    expect(texts.join('\n')).toContain('<b>The worker restarted and recovered its work</b>');
    expect(texts.join('\n')).toContain('<b>SnapPool · 2026-10-05</b>');
  }, 60_000);

  it('M07 step 6: two weeks unattended: a digest each morning, the Monday brief, nothing for property-sg', async () => {
    const mark = telegram.chat.length;
    for (let day = '2026-10-07'; day <= '2026-10-18'; day = minusDays(day, -1)) await morning(day);
    const texts = telegram.since(mark).map((m) => m.text);
    const digests = texts.filter((t) => t.startsWith('<b>SnapPool · '));
    expect(digests).toHaveLength(12);
    const briefs = texts.filter((t) => t.startsWith('<b>SnapPool: weekly brief'));
    expect(briefs).toHaveLength(1);
    expect(texts.join('\n')).not.toMatch(/property/i);
    expect(await database.db.select().from(schema.proposals)).toEqual([]);
    expect(await telegram.press(message('<b>SnapPool: weekly brief, 2026-10-05 to 2026-10-11</b>'), '👍')).toBe(
      'recorded',
    );
  }, 120_000);

  it('M08, M09a: at phase 1 the Monday cycle drafts proposals, and Marcus decides them from Telegram', async () => {
    const phase = await ads(cli, [
      'phase',
      'set',
      '1',
      '--note',
      'Phase 0 gate passed: 2 of 2 briefs useful (rehearsal)',
    ]);
    expect(phase.json()).toMatchObject({ status: 'done', phase: 1, previous: 0 });
    // Standing in for T4 and T11 (the destinations of the feedback routes): with Google's conversion action set, the
    // fixture account's conversions count, `tracking_active` passes, and a search term without any can be judged.
    const routes = {
      outcomes: {
        feedback: [
          { stage: 'pool_request', platform: 'meta', destinationId: META_DATASET, eventName: 'Lead' },
          { stage: 'signup', platform: 'meta', destinationId: META_DATASET, eventName: 'CompleteRegistration' },
          { stage: 'signup', platform: 'google', destinationId: '555' },
        ],
      },
    };
    expect(
      (await ads(cli, ['settings', 'set', '--product', 'snappool', '--patch', JSON.stringify(routes)])).json(),
    ).toMatchObject({
      status: 'done',
    });

    const mark = telegram.chat.length;
    await morning('2026-10-19');
    const cards = telegram.since(mark).filter((m) => m.text.startsWith('<b>Proposal '));
    expect(cards).toHaveLength(3);
    const card = (text: string): ChatMessage => {
      const found = cards.find((m) => m.text.includes(text));
      if (found === undefined) throw new Error(`no card with ${JSON.stringify(text)}`);
      return found;
    };
    const metaPause = card('<b>Pause</b> campaign “Signups - Advantage+”');
    const googlePause = card('<b>Pause</b> campaign “Signups - Search”');
    const negative = card('<b>Add a negative keyword</b> to ad group “Photo sharing”');
    for (const c of cards) expect(c.text).toContain('0 signups'); // the fact each rests on (F3)
    expect(negative.text).toContain('+ “free event photo pool” (exact match) blocked');
    expect(model.calls.filter((c) => c.stage === 'drafter')).toHaveLength(1);
    expect(message('<b>SnapPool: weekly brief, 2026-10-12 to 2026-10-18</b>').text).toContain('Open proposals: 3');

    // M09a step 3: approve one, reject one with a reason, and edit the negative to phrase match.
    expect(await telegram.press(metaPause, 'Approve')).toBe('recorded');
    expect(metaPause.text).toContain('✅ approved');
    expect(await telegram.press(googlePause, 'Reject')).toBe('asked');
    expect(telegram.chat.at(-1)?.forceReply).toBe(true);
    expect(await telegram.say('Search is the steadiest channel; keep it.')).toBe('recorded');
    expect(googlePause.text).toContain('❌ rejected');
    expect(await telegram.press(negative, 'Edit')).toBe('asked');
    expect(await telegram.say('match phrase')).toBe('recorded');
    expect(telegram.chat.at(-1)?.text).toMatch(/^Edited and approved: <b>\w+<\/b> v2\.$/);
    expect(negative.text).toContain('(phrase match)');
    expect(negative.text).toContain('✅ approved');

    // M08 step 3: the CLI shows the same decisions.
    const listed = await ads(cli, ['proposals', 'list', '--product', 'snappool', '--all']);
    const decided = listed.json<{ proposals: { finding: string; status: string; version: number }[] }>().proposals;
    expect(decided.map((p) => [p.finding, p.status, p.version]).sort()).toEqual([
      ['wasteful_search_term', 'approved', 2],
      ['zero_outcome_spend', 'approved', 1],
      ['zero_outcome_spend', 'rejected', 1],
    ]);
  }, 60_000);

  it('M10b: the dashboard shows the same database, and what Marcus does there the worker processes', async () => {
    const product = await asDashboard((db) => getProductView('snappool', db));
    if (product === null) throw new Error('the dashboard does not see snappool');
    const overview = text(
      renderToStaticMarkup(
        createElement(Overview, { product, data: await asDashboard((db) => loadOverview(db, product, now())) }),
      ),
    );
    expect(overview).toContain('Yesterday (2026-10-18) S$28.00 of S$20.00 (140%) — over the ceiling');
    expect(overview).toContain('Month to date (2026-10) S$479.54 of S$500.00 (95%)');
    expect(overview).toMatch(/Signup \(email link clicked\) · KPI \d+ \d+/);
    expect(overview).toContain(
      `google ${GOOGLE_ACCOUNT} “Test Client Account” active 2026-10-19 08:30 (Asia/Singapore)`,
    );
    const page = await asDashboard((db) => loadProposals(db, product, now()));
    const proposals = text(renderToStaticMarkup(createElement(Proposals, { product, data: page })));
    expect(proposals).toContain('Waiting for you (0)');
    expect(proposals).toContain('Approved, to make by hand (2)');
    expect(proposals).toContain('+ “free event photo pool” (phrase match) blocked');
    expect(proposals).toContain('rejected · “Search is the steadiest channel; keep it.” telegram:424242 via telegram');
    // The agree rate counts proposals by when the database stamped them (the real time, as on the SER9), so it is
    // read at the database's own clock here: the rehearsal's is weeks away from it.
    const dbNow = (await database.pool.query<{ now: Date }>('select now()')).rows[0]?.now ?? new Date();
    expect((await asDashboard((db) => loadProposals(db, product, dbNow))).agree).toEqual({
      days: 21,
      total: 3,
      approved: 2,
      rejected: 1,
      expired: 0,
      pending: 0,
    });

    // M10b step 3: the Briefs page's yes / no choices, recorded as the dashboard's role and processed by the worker.
    const [latest] = await database.pool
      .query<{ id: string }>(`select id from briefs order by created_at desc limit 1`)
      .then((r) => r.rows);
    const request = briefFeedbackRequest(
      fieldsOf([
        ['briefId', latest?.id ?? ''],
        ['useful', 'yes'],
        ['usefulShown', ''],
        ['newInfo', 'no'],
        ['newInfoShown', ''],
      ]),
    );
    const id = await asDashboard((db) => recordWebRequest(db, { request, email: 'marcus@example.com' }));
    await vi.waitFor(async () => expect(await getRequestStatus(database.db, id)).toMatchObject({ status: 'done' }), {
      timeout: 10_000,
      interval: 100,
    });
    expect((await ads(cli, ['brief', '--product', 'snappool'])).json()).toMatchObject({
      feedback: { useful: true, newInfo: false },
    });
  }, 60_000);

  it('M08 step 5: `ads eval replay` scores the decisions', async () => {
    const replay = await ads(cli, ['eval', 'replay', '--product', 'snappool']);
    expect(replay.json()).toMatchObject({
      product: 'snappool',
      byType: [
        { type: 'wasteful_search_term', truePositives: 1, falsePositives: 0 },
        { type: 'zero_outcome_spend', truePositives: 1, falsePositives: 1 },
      ],
      overall: { truePositives: 2, falsePositives: 1, precisionPct: 66 },
    });
  });
});
