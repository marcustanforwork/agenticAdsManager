import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RefusedError } from '../src/errors.ts';
import {
  acknowledgeDrift,
  addApiUsage,
  completeOperatorRequest,
  enqueueNotification,
  getApiUsage,
  getBrief,
  getFlag,
  getOperatorRequest,
  insertBrief,
  listBriefs,
  listQueuedRequests,
  listUnacknowledgedDrift,
  listUnsentNotifications,
  markBriefSent,
  markNotificationSent,
  recordDrift,
  recordOperatorRequest,
  setBriefFeedback,
  setFlag,
  writesEnabled,
} from '../src/repos/plumbing.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { makeCampaign, makeProduct } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe('briefs', () => {
  it('stores a brief with its numbers, marks it sent, and records feedback', async () => {
    const p = await makeProduct(t.db);
    const b = await insertBrief(t.db, {
      productId: p.id,
      kind: 'weekly',
      numbers: { spendMicros: '120000000' },
      markdown: '# Week',
    });
    expect(b.usedTemplateFallback).toBe(false);
    await markBriefSent(t.db, b.id);
    await setBriefFeedback(t.db, { briefId: b.id, useful: true, newInfo: false });
    const stored = await getBrief(t.db, b.id);
    expect(stored.sentAt).toBeInstanceOf(Date);
    expect([stored.feedbackUseful, stored.feedbackNewInfo]).toEqual([true, false]);
    expect((await listBriefs(t.db, p.id)).map((x) => x.id)).toEqual([b.id]);
  });
});

describe('operator requests', () => {
  it('records a validated request with its kind and product, and completes it once', async () => {
    const p = await makeProduct(t.db);
    const r = await recordOperatorRequest(t.db, {
      request: { kind: 'pause_all', productId: p.id },
      actor: 'marcus',
      channel: 'telegram',
    });
    expect([r.kind, r.productId, r.status]).toEqual(['pause_all', p.id, 'queued']);
    expect((await listQueuedRequests(t.db)).map((x) => x.id)).toContain(r.id);
    await completeOperatorRequest(t.db, { id: r.id, status: 'done', result: { paused: 2 } });
    const done = await getOperatorRequest(t.db, r.id);
    expect(done.status).toBe('done');
    expect(done.processedAt).toBeInstanceOf(Date);
    await expect(completeOperatorRequest(t.db, { id: r.id, status: 'refused', result: {} })).rejects.toBeInstanceOf(
      RefusedError,
    );
  });

  it('a global request has no product; an invalid one is refused before it is stored', async () => {
    const r = await recordOperatorRequest(t.db, {
      request: { kind: 'halt', productId: null },
      actor: 'marcus',
      channel: 'cli',
    });
    expect(r.productId).toBeNull();
    await expect(
      recordOperatorRequest(t.db, {
        request: { kind: 'reject', proposalId: r.id, version: 1, reason: '' } as never,
        actor: 'marcus',
        channel: 'web',
      }),
    ).rejects.toThrow();
  });
});

describe('notifications', () => {
  it('is an outbox: unsent until marked sent', async () => {
    const n = await enqueueNotification(t.db, { kind: 'alert', payload: { text: 'hello' } });
    expect((await listUnsentNotifications(t.db)).map((x) => x.id)).toContain(n.id);
    await markNotificationSent(t.db, n.id);
    expect((await listUnsentNotifications(t.db)).map((x) => x.id)).not.toContain(n.id);
  });
});

describe('drift', () => {
  it('records drift and acknowledges it', async () => {
    const { product, campaign } = await makeCampaign(t.db);
    const d = await recordDrift(t.db, {
      productId: product.id,
      adEntityId: campaign.id,
      field: 'dailyBudgetMicros',
      expected: '20000000',
      observed: '40000000',
    });
    expect((await listUnacknowledgedDrift(t.db, product.id)).map((x) => x.id)).toEqual([d.id]);
    await acknowledgeDrift(t.db, d.id);
    expect(await listUnacknowledgedDrift(t.db, product.id)).toEqual([]);
  });
});

describe('system flags', () => {
  it('writes are off unless the flag is exactly true', async () => {
    expect(await writesEnabled(t.db)).toBe(false); // missing
    await setFlag(t.db, 'writes_enabled', 'true'); // a string is not true
    expect(await writesEnabled(t.db)).toBe(false);
    await setFlag(t.db, 'writes_enabled', true);
    expect(await writesEnabled(t.db)).toBe(true);
    await setFlag(t.db, 'writes_enabled', false);
    expect(await getFlag(t.db, 'writes_enabled')).toBe(false);
  });
});

describe('API usage', () => {
  it('adds operations per platform, account and day', async () => {
    const key = { platform: 'google' as const, accountExternalId: '123', date: '2026-09-25' };
    expect(await getApiUsage(t.db, key)).toBe(0);
    expect(await addApiUsage(t.db, { ...key, operations: 3 })).toBe(3);
    expect(await addApiUsage(t.db, { ...key, operations: 4 })).toBe(7);
    expect(await getApiUsage(t.db, { ...key, date: '2026-09-26' })).toBe(0);
  });
});
