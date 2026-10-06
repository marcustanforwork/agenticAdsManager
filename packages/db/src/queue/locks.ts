// Named session-level advisory locks, each on its own direct connection (like the leader lock, BLUEPRINT §5.2):
// held until `release()`, or until the process dies and Postgres drops its connection. A cycle takes one while it
// runs, so two processes never run the same cycle at once (M04).
import pg from 'pg';

export interface HeldLock {
  /** Unlocks and closes the lock's connection. Safe to call twice. */
  release(): Promise<void>;
}

/** Tries once to take the lock called `name`; null if another session holds it. The connection must be direct,
 *  not through Neon's pooler (transaction mode drops session locks). */
export async function tryAdvisoryLock(
  url: string,
  name: string,
  opts: { applicationName?: string; onError?: (error: unknown) => void } = {},
): Promise<HeldLock | null> {
  const client = new pg.Client({
    connectionString: url,
    application_name: opts.applicationName ?? 'ads-lock',
    keepAlive: true,
  });
  // A dropped connection loses the lock; the stages are idempotent, so the worst case is a second runner later.
  client.on('error', (error) => opts.onError?.(error));
  await client.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
      [name],
    );
    if (res.rows[0]?.locked !== true) {
      await client.end();
      return null;
    }
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      // Closing the session frees the lock as well; the explicit unlock just makes it immediate.
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [name]).catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}
