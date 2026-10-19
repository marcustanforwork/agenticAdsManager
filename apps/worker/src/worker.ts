// The worker service (BLUEPRINT §5.1–5.5, §5.16, M07). At startup it reconciles (`recoverWorker`: reclaims job
// leases, processes requests left queued, resumes unfinished cycles), then runs the job queue and processes the
// requests the dashboard records (M10a). The leader (one
// replica, by advisory lock) also runs the schedule, polls Telegram for the brief buttons and sends the
// notifications outbox. On SIGTERM the running cycle stops between stages and its job's lease is released, so the
// next start picks it up where it stopped.
import {
  type CycleDeps,
  CycleInterruptedError,
  type CycleSummary,
  type RequestContext,
  actorsFromEnv,
  createModelTracing,
  recoverWorker,
  runCycle,
} from '@ads/core';
import {
  type Database,
  type Db,
  type Job,
  type QueueRunner,
  connect,
  contendForLeadership,
  enqueueJob,
  databaseNow,
  expireDue,
  hasPendingJob,
  listProducts,
  startQueueRunner,
} from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { masterKeyFromEnv } from '@ads/vault';
import { HEARTBEAT_MS, ping, startHeartbeat } from './heartbeat.ts';
import { INSTALLED_PACKS } from './packs.ts';
import { type RequestProcessing, startRequestProcessing } from './requests.ts';
import { type ScheduledJob, missedToday, startScheduler } from './schedule.ts';
import { type BotContext, type TelegramApi, sendOutbox } from './telegram/bot.ts';
import { grammyApi, startGrammyPolling } from './telegram/grammy.ts';

export interface WorkerLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface Polling {
  stop(): Promise<void>;
}

export interface WorkerOptions {
  env: Readonly<Record<string, string | undefined>>;
  logger: WorkerLogger;
  now?: () => Date;
  packs?: PackRegistry;
  /** Tests: the network for the platforms, the token endpoint, and the heartbeat pings. */
  fetch?: typeof fetch;
  tokenFetch?: typeof fetch;
  pingFetch?: typeof fetch;
  /** Tests: a fake Telegram API and polling (default: grammY, when TELEGRAM_BOT_TOKEN is set). */
  telegram?: { api: TelegramApi; startPolling: (ctx: BotContext) => Polling } | null;
  leaderRetryMs?: number;
  /** How often the leader expires proposals past their expiry (default 10 minutes). */
  expiryMs?: number;
  queuePollMs?: number;
  outboxMs?: number;
  /** How often every replica drains queued operator requests besides the NOTIFY wake-up (default 30 s). */
  requestPollMs?: number;
  heartbeatMs?: number;
  /** Tests: don't start the croner schedule (the catch-up still runs). */
  schedule?: boolean;
  /** Aborted at shutdown: a cycle the startup reconciliation is resuming stops between stages. */
  signal?: AbortSignal;
}

export interface RunningWorker {
  db: Db;
  isLeader(): boolean;
  /** Sends the outbox now (the leader also does it every `outboxMs`). */
  sendOutboxNow(): Promise<number>;
  /** Processes queued operator requests now (they're also processed on NOTIFY and every `requestPollMs`). */
  processRequestsNow(): Promise<number>;
  stop(): Promise<void>;
}

/** The env the worker needs to run cycles: without it (the M00 smoke test) only the health endpoint runs. */
export function workerConfigured(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env['DATABASE_URL'] ?? '') !== '' && (env['VAULT_READ_KEY'] ?? '') !== '';
}

/** Marcus's Telegram user id (T7), or null when Telegram isn't set up. */
export function telegramOwner(env: Readonly<Record<string, string | undefined>>): number | null {
  const text = env['TELEGRAM_OWNER_ID']?.trim() ?? '';
  if (text === '') return null;
  if (!/^\d{1,15}$/.test(text)) throw new Error('TELEGRAM_OWNER_ID must be a numeric Telegram user id');
  return Number(text);
}

export interface ScheduledRun {
  kind: ScheduledJob;
  cycles: Pick<CycleSummary, 'product' | 'cycleId' | 'outcome' | 'stageReached' | 'trustResult'>[];
  errors: { product: string; error: string }[];
}

/** One scheduled job: today's `kind` cycle for every active product, one after another. A product's failure doesn't
 *  stop the others. Shutdown (the signal) interrupts between stages and is rethrown, so the job is released. */
export async function runScheduledCycles(
  deps: Omit<CycleDeps, 'signal'>,
  kind: ScheduledJob,
  signal?: AbortSignal,
): Promise<ScheduledRun> {
  const out: ScheduledRun = { kind, cycles: [], errors: [] };
  for (const product of await listProducts(deps.db)) {
    if (product.status !== 'active') continue;
    if (signal?.aborted === true) throw new CycleInterruptedError('(not started)', 'started');
    try {
      const s = await runCycle(
        { ...deps, ...(signal === undefined ? {} : { signal }) },
        { productId: product.id, kind },
      );
      out.cycles.push({
        product: s.product,
        cycleId: s.cycleId,
        outcome: s.outcome,
        stageReached: s.stageReached,
        trustResult: s.trustResult,
      });
      if (s.outcome === 'blocked') out.errors.push({ product: product.slug, error: s.detail ?? 'blocked' });
    } catch (error) {
      if (error instanceof CycleInterruptedError) throw error;
      out.errors.push({ product: product.slug, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

/** Queues a scheduled job unless one of that kind is already waiting or running (a leader change or a restart
 *  would otherwise stack them; a duplicate would only find its cycles finished). */
export async function enqueueScheduled(db: Db, kind: ScheduledJob, now: Date): Promise<boolean> {
  if (await hasPendingJob(db, { queue: 'worker', kind })) return false;
  await enqueueJob(db, { queue: 'worker', kind, payload: { scheduledAt: now.toISOString() }, maxAttempts: 3 });
  return true;
}

export async function startWorker(opts: WorkerOptions): Promise<RunningWorker | null> {
  const { env, logger } = opts;
  if (!workerConfigured(env)) {
    logger.info({}, 'no DATABASE_URL or VAULT_READ_KEY: the worker runs its health endpoint only');
    return null;
  }
  const url = env['DATABASE_URL'] as string;
  const now = opts.now ?? (() => new Date());
  const packs = opts.packs ?? INSTALLED_PACKS;
  const masterKey = masterKeyFromEnv('VAULT_READ_KEY', 'read', env);
  const database: Database = connect(url, { max: 5, applicationName: 'ads-worker' });
  const { db } = database;
  const tracing = createModelTracing(env);
  const ownerId = telegramOwner(env);
  const token = env['TELEGRAM_BOT_TOKEN']?.trim() ?? '';
  const telegram =
    opts.telegram !== undefined
      ? opts.telegram
      : token !== '' && ownerId !== null
        ? { api: grammyApi(token), startPolling: (ctx: BotContext) => startGrammyPolling(token, ctx) }
        : null;
  if (telegram === null) logger.warn({}, 'no TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID: notifications stay queued');

  // Marcus's own Telegram id is an operator actor by definition (it is the one the bot accepts updates from).
  const requests: RequestContext = {
    actors: new Set([...actorsFromEnv(env['OPERATOR_ACTORS']), ...(ownerId === null ? [] : [`telegram:${ownerId}`])]),
    packs,
  };
  const cycleDeps: Omit<CycleDeps, 'signal'> = {
    db,
    lockUrl: url,
    masterKey,
    process: 'worker',
    now,
    packs,
    env,
    tracing,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    ...(opts.tokenFetch === undefined ? {} : { tokenFetch: opts.tokenFetch }),
  };
  const pingOpts = { ...(opts.pingFetch === undefined ? {} : { fetch: opts.pingFetch }), logger };

  // 1. Heartbeat (§5.16), first: the reconciliation below may resume a long cycle, and the check mustn't go silent
  // meanwhile. It pings only after a database round trip, so a worker that can't reach its database goes quiet.
  const heartbeat = startHeartbeat(async () => {
    try {
      await databaseNow(db);
    } catch (error) {
      logger.error({ err: error }, 'database unreachable: heartbeat reports a failure');
      await ping(env['HEALTHCHECK_WORKER_URL'], { ...pingOpts, fail: true });
      return;
    }
    await ping(env['HEALTHCHECK_WORKER_URL'], pingOpts);
  }, opts.heartbeatMs ?? HEARTBEAT_MS);

  // 2. Startup reconciliation (§5.5): before the queue runs, so a resumed cycle isn't also claimed as a job.
  try {
    const recovered = await recoverWorker(db, requests, {
      cycles: { ...cycleDeps, ...(opts.signal === undefined ? {} : { signal: opts.signal }) },
      onFault: (requestId, error) => logger.error({ requestId, err: error }, 'recovery fault'),
    });
    logger.info({ ...recovered }, 'startup reconciliation done');
  } catch (error) {
    logger.error({ err: error }, 'startup reconciliation failed');
  }
  if (opts.signal?.aborted === true) {
    // Shut down during the reconciliation: start nothing more.
    return {
      db,
      isLeader: () => false,
      sendOutboxNow: () => Promise.resolve(0),
      processRequestsNow: () => Promise.resolve(0),
      async stop() {
        await heartbeat.stop();
        await tracing?.shutdown();
        await database.close();
      },
    };
  }

  // 3. The job runner (every replica).
  let outboxWake: (() => void) | null = null;
  const scheduled = (kind: ScheduledJob) => async (job: Job, ctx: { signal: AbortSignal }) => {
    // A failed cycle alerts on the job's last attempt only (`attempts` counts this one).
    const run = await runScheduledCycles(
      { ...cycleDeps, alertOnFailure: job.attempts >= job.maxAttempts },
      kind,
      ctx.signal,
    );
    logger.info({ ...run }, `${kind} cycles done`);
    outboxWake?.();
    if (kind === 'daily') await ping(env['HEALTHCHECK_DAILY_SYNC_URL'], { ...pingOpts, fail: run.errors.length > 0 });
    if (run.errors.length > 0)
      throw new Error(`${run.errors.length} product(s) failed: ${run.errors.map((e) => e.product).join(', ')}`);
  };
  const runner: QueueRunner = startQueueRunner({
    db,
    listenUrl: url,
    queue: 'worker',
    handlers: { daily: scheduled('daily'), weekly: scheduled('weekly') },
    ...(opts.queuePollMs === undefined ? {} : { pollMs: opts.queuePollMs }),
    logger,
  });

  // 3b. Requests other surfaces only record (the dashboard, M10a), on every replica.
  const requestProcessing: RequestProcessing = startRequestProcessing({
    db,
    listenUrl: url,
    ctx: requests,
    logger,
    ...(opts.requestPollMs === undefined ? {} : { pollMs: opts.requestPollMs }),
  });

  // 4. Leader-only work: the schedule, Telegram polling and the outbox.
  const botContext: BotContext | null =
    telegram === null || ownerId === null ? null : { db, api: telegram.api, ownerId, requests, logger };
  let leaderWork: { stop(): Promise<void> } | null = null;
  // One outbox pass at a time (an overlapping pass would send its notifications twice). A request during a pass sets
  // `again`, so at most one more pass follows it. After a stalled pass (Telegram unreachable, rate limited, bot
  // blocked) the timer's passes back off: 15 s, 30 s, 1 min … up to 15 min.
  let inFlight: Promise<number> | null = null;
  let again = false;
  let stalls = 0;
  let nextPassAt = 0;
  const sendNow = (): Promise<number> => {
    if (botContext === null) return Promise.resolve(0);
    if (inFlight !== null) {
      again = true;
      return inFlight;
    }
    const ctx = botContext;
    inFlight = (async () => {
      let total = 0;
      do {
        again = false;
        const pass = await sendOutbox(ctx);
        total += pass.sent;
        stalls = pass.stalled ? stalls + 1 : 0;
        nextPassAt = stalls === 0 ? 0 : Date.now() + Math.min(15_000 * 2 ** (stalls - 1), 15 * 60_000);
        if (pass.stalled) break;
      } while (again);
      return total;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const startLeaderWork = (): { stop(): Promise<void> } => {
    logger.info({}, 'leader: starting the schedule, Telegram and the outbox');
    const fire = async (job: ScheduledJob): Promise<void> => {
      if (await enqueueScheduled(db, job, now())) runner.wake();
    };
    const scheduler =
      opts.schedule === false
        ? null
        : startScheduler(fire, (job, error) => logger.error({ job, err: error }, 'scheduling failed'));
    for (const job of missedToday(now())) {
      fire(job).catch((error: unknown) => logger.error({ job, err: error }, 'catch-up failed'));
    }
    const polling = botContext === null ? null : telegram?.startPolling(botContext);
    // Proposals past their expiry move to `expired` (BLUEPRINT §3.9), so they stop counting as open.
    const expire = (): void => {
      expireDue(db, now())
        .then((ids) => {
          if (ids.length > 0) logger.info({ expired: ids.length }, 'proposals expired');
        })
        .catch((error: unknown) => logger.error({ err: error }, 'expiring proposals failed'));
    };
    expire();
    const expiryTimer = setInterval(expire, opts.expiryMs ?? 600_000);
    let timer: NodeJS.Timeout | null = null;
    if (botContext !== null) {
      const pass = (): void => {
        sendNow().catch((error: unknown) => logger.error({ err: error }, 'outbox pass failed'));
      };
      outboxWake = pass;
      pass();
      timer = setInterval(() => {
        if (Date.now() >= nextPassAt) pass();
      }, opts.outboxMs ?? 15_000);
    }
    return {
      async stop() {
        scheduler?.stop();
        clearInterval(expiryTimer);
        if (timer !== null) clearInterval(timer);
        outboxWake = null;
        await polling?.stop().catch((error: unknown) => logger.error({ err: error }, 'stopping Telegram failed'));
        await inFlight?.catch(() => undefined);
      },
    };
  };

  const leadership = contendForLeadership({
    url,
    ...(opts.leaderRetryMs === undefined ? {} : { retryMs: opts.leaderRetryMs }),
    onAcquired: () => {
      leaderWork = startLeaderWork();
    },
    onLost: () => {
      logger.warn({}, 'leadership lost: stopping the schedule, Telegram and the outbox');
      const work = leaderWork;
      leaderWork = null;
      void work?.stop();
    },
    onError: (error) => logger.error({ err: error }, 'leader lock error'),
  });

  return {
    db,
    isLeader: () => leadership.isLeader(),
    sendOutboxNow: sendNow,
    processRequestsNow: () => requestProcessing.drainNow(),
    async stop() {
      // The running job's signal is aborted: its cycle stops between stages and the job is released, not failed.
      await runner.stop();
      await requestProcessing.stop();
      const work = leaderWork;
      leaderWork = null;
      await work?.stop();
      await leadership.stop();
      await heartbeat.stop();
      await tracing?.shutdown();
      await database.close();
    },
  };
}
