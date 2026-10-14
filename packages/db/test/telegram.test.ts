import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONVERSATION_TTL_MS, clearConversation, getConversation, setConversation } from '../src/repos/telegram.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe('telegram conversations', () => {
  const now = new Date('2026-10-14T03:00:00Z');
  const later = (ms: number) => new Date(now.getTime() + ms);

  it('stores one state per chat, replaced by the next, and ends it on clear', async () => {
    expect(await getConversation(t.db, 101, now)).toBeNull();
    await setConversation(t.db, 101, { awaiting: 'reject_reason', shortId: 'abcdefgh', version: 1 }, { now });
    await setConversation(t.db, 202, { awaiting: 'edit' }, { now });
    expect(await getConversation(t.db, 101, now)).toEqual({
      awaiting: 'reject_reason',
      shortId: 'abcdefgh',
      version: 1,
    });
    await setConversation(t.db, 101, { awaiting: 'edit', shortId: 'abcdefgh', version: 2 }, { now });
    expect(await getConversation(t.db, 101, now)).toMatchObject({ awaiting: 'edit', version: 2 });
    expect(await clearConversation(t.db, 101, now)).toBe(true);
    expect(await getConversation(t.db, 101, now)).toBeNull();
    expect(await clearConversation(t.db, 101, now)).toBe(false);
    expect(await getConversation(t.db, 202, now)).toEqual({ awaiting: 'edit' }); // other chats untouched
  });

  it('expires a state after 10 minutes', async () => {
    await setConversation(t.db, 303, { awaiting: 'edit' }, { now });
    expect(await getConversation(t.db, 303, later(CONVERSATION_TTL_MS - 1))).not.toBeNull();
    expect(await getConversation(t.db, 303, later(CONVERSATION_TTL_MS))).toBeNull();
    expect(await clearConversation(t.db, 303, later(CONVERSATION_TTL_MS))).toBe(false); // gone, not live
  });

  it('keeps big Telegram ids exactly', async () => {
    const chatId = 7_123_456_789_012; // user ids go past 2^32
    await setConversation(t.db, chatId, { awaiting: 'edit' }, { now });
    expect(await getConversation(t.db, chatId, now)).toEqual({ awaiting: 'edit' });
  });
});
