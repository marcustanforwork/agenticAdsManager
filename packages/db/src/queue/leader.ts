// Leader election (BLUEPRINT §5.2): the leader holds a session-level pg_try_advisory_lock on a dedicated direct
// connection for the life of the process. If that connection drops, Postgres releases the lock and another
// replica takes it within one retry interval (10 s). The leader pings every interval and steps down if a ping
// fails, so it never believes it leads after its connection is gone. Only the leader runs cron and polls Telegram.
import pg from 'pg';

/** The advisory-lock key for the worker leader. Any constant works; this one spells "ads" + 0x10. */
export const WORKER_LEADER_LOCK = 0x61_64_73_10;

export interface Leadership {
  isLeader(): boolean;
  /** Releases the lock (by closing its connection) and stops contending. */
  stop(): Promise<void>;
}

export interface LeadershipOptions {
  url: string;
  lockKey?: number;
  retryMs?: number;
  onAcquired?: () => void;
  onLost?: () => void;
  onError?: (error: unknown) => void;
}

export function contendForLeadership(opts: LeadershipOptions): Leadership {
  const lockKey = opts.lockKey ?? WORKER_LEADER_LOCK;
  const retryMs = opts.retryMs ?? 10_000;
  let stopped = false;
  let leader = false;
  let client: pg.Client | null = null;
  let timer: NodeJS.Timeout | null = null;

  let ping: NodeJS.Timeout | null = null;

  const lose = (): void => {
    if (ping !== null) clearInterval(ping);
    ping = null;
    if (!leader) return;
    leader = false;
    opts.onLost?.();
  };
  const schedule = (): void => {
    if (!stopped) timer = setTimeout(() => void attempt(), retryMs);
  };

  const attempt = async (): Promise<void> => {
    timer = null;
    if (stopped) return;
    // Keepalive and a query timeout, so a silently dead network (no FIN, no RST) is noticed within about one
    // retry interval instead of the OS default of ~2 hours.
    const c = new pg.Client({
      connectionString: opts.url,
      application_name: 'ads-leader',
      keepAlive: true,
      keepAliveInitialDelayMillis: retryMs,
      query_timeout: retryMs,
    });
    c.on('error', (error) => {
      opts.onError?.(error);
      void c.end().catch(() => undefined);
    });
    // The lock lives exactly as long as this connection: however it ends, leadership ends with it.
    c.on('end', () => {
      if (client !== c) return;
      client = null;
      lose();
      schedule();
    });
    try {
      await c.connect();
      const res = await c.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [lockKey]);
      if (stopped) {
        await c.end();
        return;
      }
      if (res.rows[0]?.locked === true) {
        // Server side too: if this process vanishes, Postgres drops the session (and frees the lock) in ~30 s.
        // Best effort: a proxy in between may ignore these.
        await c
          .query('set tcp_keepalives_idle = 10; set tcp_keepalives_interval = 5; set tcp_keepalives_count = 4')
          .catch(() => undefined);
        client = c;
        leader = true;
        ping = setInterval(() => {
          // A ping that fails or times out means the lock can't be proven held: drop it and step down.
          c.query('select 1').catch(() => void c.end().catch(() => undefined));
        }, retryMs);
        opts.onAcquired?.();
        return;
      }
      await c.end();
    } catch (error) {
      opts.onError?.(error);
      await c.end().catch(() => undefined);
    }
    schedule();
  };

  void attempt();
  return {
    isLeader: () => leader,
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      const c = client;
      client = null;
      lose();
      await c?.end().catch(() => undefined);
    },
  };
}
