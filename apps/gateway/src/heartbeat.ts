// Heartbeats to healthchecks.io (BLUEPRINT §5.16): `gateway-alive` every 10 minutes. (The worker has its own copy:
// apps don't depend on each other.) A ping is a GET to the check's URL (`https://hc-ping.com/<uuid>`); `/fail` reports a failure
// at once. The URLs come from the environment (Doppler): a check's UUID lets anyone ping it, so it is a secret. A
// failed ping is logged and never stops the gateway: silence is exactly what the check is there to notice.

export const HEARTBEAT_MS = 10 * 60_000;
const PING_TIMEOUT_MS = 10_000;

export interface PingLogger {
  error(obj: object, msg: string): void;
}

/** Pings a check; `fail` sends the failure signal. Returns whether the ping went through (never throws). */
export async function ping(
  url: string | undefined,
  opts: { fail?: boolean; fetch?: typeof fetch; logger?: PingLogger } = {},
): Promise<boolean> {
  if (url === undefined || url === '') return false;
  const target = opts.fail === true ? `${url.replace(/\/+$/, '')}/fail` : url;
  try {
    const res = await (opts.fetch ?? fetch)(target, { method: 'GET', signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    if (!res.ok) opts.logger?.error({ status: res.status }, 'heartbeat ping refused');
    return res.ok;
  } catch (err) {
    // The URL is never logged: its UUID is the check's secret.
    opts.logger?.error({ err: err instanceof Error ? err.message : String(err) }, 'heartbeat ping failed');
    return false;
  }
}

export interface Heartbeat {
  /** Stops the timer and waits for a beat in flight, so closing the database afterwards can't turn it into a false
   *  `/fail` ping. */
  stop(): Promise<void>;
}

/** Calls `beat` now and every `everyMs`. `beat` decides what to ping (e.g. only after a database round trip). */
export function startHeartbeat(beat: () => Promise<void>, everyMs = HEARTBEAT_MS): Heartbeat {
  let current: Promise<void> | null = null;
  let stopped = false;
  const tick = (): void => {
    if (current !== null || stopped) return;
    current = beat()
      .catch(() => undefined)
      .finally(() => {
        current = null;
      });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}
