// roles.sql: each role can do what BLUEPRINT §4 says, and nothing it shouldn't. Checked with SET ROLE.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { makeCampaign } from './helpers.ts';

let t: TestDatabase;
let ids: { product: string; proposal: string };

beforeAll(async () => {
  t = await createTestDatabase();
  const { product } = await makeCampaign(t.db);
  const { rows } = await t.pool.query<{ id: string }>(
    `insert into proposals (short_id, product_id, origin, action, action_hash, rationale, expected_effect, expires_at)
     values ('rolestst', $1, 'agent', '{}', 'h', 'r', 'e', now() + interval '1 day') returning id`,
    [product.id],
  );
  ids = { product: product.id, proposal: rows[0]?.id ?? '' };
});
afterAll(async () => t.drop());

/** Runs `sql` as `role` inside a rolled-back transaction; resolves to 'ok' or 'denied'. */
async function as(role: string, sql: string, params: unknown[] = []): Promise<'ok' | 'denied'> {
  const client = await t.pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(sql, params);
    return 'ok';
  } catch (error) {
    if ((error as { code?: string }).code === '42501') return 'denied'; // insufficient_privilege
    throw error;
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const insertChange = `insert into change_log (revision_id, product_id, proposal_id, action, before, after, approved_by, verified)
  values ('rev_x', $1, $2, '{}', '{}', '{}', 'm', true)`;
const insertRequest = `insert into operator_requests (kind, payload, actor, channel) values ('halt', '{}', 'm', 'web')`;

describe('agent_worker', () => {
  it('reads and writes the agent’s tables', async () => {
    expect(await as('agent_worker', 'select * from credentials')).toBe('ok');
    expect(await as('agent_worker', `update products set name = 'x' where id = $1`, [ids.product])).toBe('ok');
    expect(await as('agent_worker', insertRequest)).toBe('ok');
    expect(await as('agent_worker', `update proposals set status = 'expired' where id = $1`, [ids.proposal])).toBe(
      'ok',
    );
  });

  it('cannot write the change log', async () => {
    expect(await as('agent_worker', insertChange, [ids.product, ids.proposal])).toBe('denied');
    expect(await as('agent_worker', `update change_log set verified = false`)).toBe('denied');
    expect(await as('agent_worker', `select * from change_log`)).toBe('ok');
  });
});

describe('agent_gateway', () => {
  it('reads everything, updates proposals, and inserts the change log', async () => {
    expect(await as('agent_gateway', 'select * from credentials')).toBe('ok');
    expect(await as('agent_gateway', `update proposals set status = 'applying' where id = $1`, [ids.proposal])).toBe(
      'ok',
    );
    expect(await as('agent_gateway', insertChange, [ids.product, ids.proposal])).toBe('ok');
    expect(await as('agent_gateway', `insert into notifications (kind, payload) values ('x', '{}')`)).toBe('ok');
    expect(await as('agent_gateway', `update products set status = 'halted' where id = $1`, [ids.product])).toBe('ok');
    expect(await as('agent_gateway', `update credentials set rotated_at = now()`)).toBe('ok'); // ads-gw credentials put
  });

  it('cannot change settings, requests or flags, or rewrite the change log', async () => {
    expect(await as('agent_gateway', `update products set settings = '{}' where id = $1`, [ids.product])).toBe(
      'denied',
    );
    expect(await as('agent_gateway', insertRequest)).toBe('denied');
    expect(await as('agent_gateway', `insert into system_flags (key, value) values ('writes_enabled', 'true')`)).toBe(
      'denied',
    );
    expect(await as('agent_gateway', `update change_log set after = '{}'`)).toBe('denied');
    expect(await as('agent_gateway', `delete from proposals`)).toBe('denied');
    expect(await as('agent_gateway', `delete from credentials`)).toBe('denied');
  });
});

describe('agent_dashboard', () => {
  it('reads the review tables and outcomes without contact hashes, and inserts requests', async () => {
    expect(await as('agent_dashboard', 'select * from proposals')).toBe('ok');
    expect(await as('agent_dashboard', 'select * from dashboard_outcomes')).toBe('ok');
    expect(await as('agent_dashboard', insertRequest)).toBe('ok');
  });

  it('cannot read credentials, their audit, or hashed contacts, and cannot change anything else', async () => {
    expect(await as('agent_dashboard', 'select * from credentials')).toBe('denied');
    expect(await as('agent_dashboard', 'select * from credential_access')).toBe('denied');
    expect(await as('agent_dashboard', 'select hashed_contact from outcomes')).toBe('denied');
    expect(await as('agent_dashboard', `update proposals set status = 'approved'`)).toBe('denied');
    expect(await as('agent_dashboard', `update operator_requests set status = 'done'`)).toBe('denied');
    expect(
      await as(
        'agent_dashboard',
        `insert into approvals (product_id, proposal_id, proposal_version, action_hash, decision, actor, channel)
         values ($1, $2, 1, 'h', 'approve', 'x', 'web')`,
        [ids.product, ids.proposal],
      ),
    ).toBe('denied');
  });

  it('the view has no hashed_contact column', async () => {
    const { rows } = await t.pool.query(
      `select column_name from information_schema.columns where table_name = 'dashboard_outcomes'`,
    );
    expect(rows.map((r: { column_name: string }) => r.column_name)).not.toContain('hashed_contact');
  });
});
