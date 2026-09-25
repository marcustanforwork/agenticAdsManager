import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.ts';

/** Paths inside this package; the same from src/ and dist/. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
export const ROLES_SQL = fileURLToPath(new URL('../sql/roles.sql', import.meta.url));

/** Applies every pending migration, then roles.sql (idempotent: it re-grants on every table, old and new). */
export async function migrateDatabase(db: Db, options: { roles?: boolean } = {}): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  if (options.roles ?? true) await applyRoles(db);
}

export async function applyRoles(db: Db): Promise<void> {
  // No parameters, so node-postgres uses the simple protocol, which allows several statements.
  await db.execute(sql.raw(await readFile(ROLES_SQL, 'utf8')));
}
