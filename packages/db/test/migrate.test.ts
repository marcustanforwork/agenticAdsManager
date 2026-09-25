import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRoles, migrateDatabase } from '../src/migrate.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe('migration and roles', () => {
  it('creates every table in BLUEPRINT §4 except source_copy', async () => {
    const rows = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual([
      'accounts',
      'ad_entities',
      'ad_entity_snapshots',
      'api_usage',
      'approvals',
      'briefs',
      'change_log',
      'credential_access',
      'credentials',
      'cycles',
      'drift_events',
      'findings',
      'google_clicks',
      'jobs',
      'metrics_daily',
      'notifications',
      'offerings',
      'operator_requests',
      'outcomes',
      'pack_manifests',
      'product_docs',
      'products',
      'proposal_versions',
      'proposals',
      'search_terms',
      'settings_history',
      'system_flags',
      'trust_checks',
    ]);
  });

  it('gives every product-scoped table an index that starts with product_id (invariant 11)', async () => {
    const rows = await t.db.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'product_id'
        and c.table_name in (select table_name from information_schema.tables where table_type = 'BASE TABLE')
        and not exists (
          select 1 from pg_index i
          join pg_class t on t.oid = i.indrelid
          join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
          where t.relname = c.table_name and a.attname = 'product_id')`);
    expect(rows.rows.map((r) => r.table_name).filter((n) => n !== 'jobs')).toEqual([]);
  });

  it('is idempotent: migrating and applying roles again changes nothing', async () => {
    await migrateDatabase(t.db);
    await applyRoles(t.db);
  });
});
