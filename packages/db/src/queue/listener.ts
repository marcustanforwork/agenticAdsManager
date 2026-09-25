// LISTEN on a dedicated direct connection (BLUEPRINT §5.1: Neon's pooler can't carry LISTEN). If the connection
// drops, it reconnects after `retryMs`; callers keep polling in the meantime, so a lost wake-up only delays work.
import pg from 'pg';

export interface Listener {
  close(): Promise<void>;
}

export interface ListenOptions {
  url: string;
  channels: string[];
  onNotify: (channel: string, payload: string) => void;
  onError?: (error: unknown) => void;
  retryMs?: number;
  applicationName?: string;
}

export function listen(opts: ListenOptions): Listener {
  let closed = false;
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | null = null;

  const schedule = (): void => {
    if (closed || retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, opts.retryMs ?? 10_000);
  };

  const connect = async (): Promise<void> => {
    const c = new pg.Client({ connectionString: opts.url, application_name: opts.applicationName ?? 'ads-listen' });
    client = c;
    c.on('notification', (msg) => opts.onNotify(msg.channel, msg.payload ?? ''));
    c.on('error', (error) => {
      opts.onError?.(error);
      void c.end().catch(() => undefined);
      if (client === c) client = null;
      schedule();
    });
    try {
      await c.connect();
      for (const channel of opts.channels) await c.query(`listen ${pg.escapeIdentifier(channel)}`);
      if (closed) await c.end();
    } catch (error) {
      opts.onError?.(error);
      await c.end().catch(() => undefined);
      if (client === c) client = null;
      schedule();
    }
  };

  void connect();
  return {
    async close() {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      const c = client;
      client = null;
      await c?.end().catch(() => undefined);
    },
  };
}
