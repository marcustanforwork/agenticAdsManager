// The dashboard's repository (M10a): it records requests under its own role, reads their verdicts, the settings
// history with who asked, and the latest manifest.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeOperatorRequest, recordOperatorRequest } from '../src/repos/plumbing.ts';
import { publishPackManifest, updateSettings } from '../src/repos/products.ts';
import {
  getLatestPackManifest,
  getRequestStatus,
  listSettingsChanges,
  recordWebRequest,
  webActor,
} from '../src/repos/web.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { SETTINGS, makeProduct } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

/** Runs `fn` as the dashboard's role, in a committed transaction. */
const asDashboard = <T>(fn: (tx: Parameters<Parameters<TestDatabase['db']['transaction']>[0]>[0]) => Promise<T>) =>
  t.db.transaction(async (tx) => {
    await tx.execute(sql`set local role agent_dashboard`);
    return fn(tx);
  });

describe('webActor', () => {
  it('is web: plus the email in lower case, and refuses anything that is not an email', () => {
    expect(webActor(' Marcus@Example.COM ')).toBe('web:marcus@example.com');
    for (const bad of ['', 'marcus', 'a@b', 'a b@c.de', 'a@b.c,d@e.f']) expect(() => webActor(bad)).toThrow();
  });
});

describe('recordWebRequest', () => {
  it('records a web request under the dashboard role, which inserted_by shows', async () => {
    const p = await makeProduct(t.db);
    const id = await asDashboard((tx) =>
      recordWebRequest(tx, { request: { kind: 'halt', productId: p.id }, email: 'Marcus@example.com' }),
    );
    const { rows } = await t.pool.query(
      'select actor, channel, kind, product_id, inserted_by, status from operator_requests where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      actor: 'web:marcus@example.com',
      channel: 'web',
      kind: 'halt',
      product_id: p.id,
      inserted_by: 'agent_dashboard',
      status: 'queued',
    });
  });

  it('refuses a request the contract rejects, before inserting', async () => {
    await expect(
      asDashboard((tx) =>
        recordWebRequest(tx, { request: { kind: 'halt', productId: 'nope' } as never, email: 'm@example.com' }),
      ),
    ).rejects.toThrow();
  });

  it('wakes the worker: every queued insert NOTIFYs request_queued with its id', async () => {
    const client = new pg.Client({ connectionString: t.url });
    await client.connect();
    try {
      const got = new Promise<string>((resolve) => client.on('notification', (m) => resolve(m.payload ?? '')));
      await client.query('listen request_queued');
      const id = await asDashboard((tx) =>
        recordWebRequest(tx, { request: { kind: 'resume_agent', productId: null }, email: 'm@example.com' }),
      );
      expect(await got).toBe(id);
    } finally {
      await client.end();
    }
  });
});

describe('getRequestStatus', () => {
  it('shows queued, then the verdict', async () => {
    const id = await asDashboard((tx) =>
      recordWebRequest(tx, { request: { kind: 'halt', productId: null }, email: 'm@example.com' }),
    );
    expect(await asDashboard((tx) => getRequestStatus(tx, id))).toMatchObject({ id, status: 'queued', result: null });
    await completeOperatorRequest(t.db, { id, status: 'refused', result: { reason: 'because' } });
    const status = await asDashboard((tx) => getRequestStatus(tx, id));
    expect(status).toMatchObject({ status: 'refused', result: { reason: 'because' } });
    expect(status.processedAt).toBeInstanceOf(Date);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(getRequestStatus(t.db, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/not found/i);
  });
});

describe('listSettingsChanges', () => {
  it('lists versions newest first, with the actor of the request behind each', async () => {
    const p = await makeProduct(t.db);
    const req = await recordOperatorRequest(t.db, {
      request: { kind: 'settings_patch', productId: p.id, baseVersion: 1, patch: {} },
      actor: 'web:m@example.com',
      channel: 'web',
    });
    await updateSettings(t.db, { productId: p.id, baseVersion: 1, settings: SETTINGS, requestId: req.id });
    const changes = await asDashboard((tx) => listSettingsChanges(tx, p.id));
    expect(changes.map((c) => [c.version, c.actor, c.channel])).toEqual([
      [2, 'web:m@example.com', 'web'],
      [1, null, null],
    ]);
  });
});

describe('getLatestPackManifest', () => {
  it('returns the most recently published version, or null', async () => {
    await publishPackManifest(t.db, { packId: 'pk-latest', version: '0.1.0', manifest: { v: 1 } });
    await publishPackManifest(t.db, { packId: 'pk-latest', version: '0.2.0', manifest: { v: 2 } });
    expect(await asDashboard((tx) => getLatestPackManifest(tx, 'pk-latest'))).toMatchObject({
      version: '0.2.0',
      manifest: { v: 2 },
    });
    expect(await getLatestPackManifest(t.db, 'pk-none')).toBeNull();
  });
});
