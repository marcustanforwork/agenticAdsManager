import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A transaction handle; every repository function accepts either. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Opens a pool on `url`. The caller owns it and must `close()` it. */
export function connect(url: string, options: { max?: number; applicationName?: string } = {}): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 5,
    application_name: options.applicationName ?? 'ads-agent',
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
