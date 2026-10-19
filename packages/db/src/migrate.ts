import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.ts';

/** Paths inside this package; the same from src/ and dist/. Built with path.join rather than `new URL('../…',
 *  import.meta.url)`, which the dashboard's bundler would try to resolve as an asset (it never migrates). */
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = join(PACKAGE_DIR, 'migrations');
export const ROLES_SQL = join(PACKAGE_DIR, 'sql', 'roles.sql');

/** Applies every pending migration, then roles.sql (idempotent: it re-grants on every table, old and new). */
export async function migrateDatabase(db: Db, options: { roles?: boolean } = {}): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  if (options.roles ?? true) await applyRoles(db);
}

export async function applyRoles(db: Db): Promise<void> {
  // No parameters, so node-postgres uses the simple protocol, which allows several statements.
  await db.execute(sql.raw(await readFile(ROLES_SQL, 'utf8')));
}
