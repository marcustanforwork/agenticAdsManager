// Telegram (M07): HTML escaping, the reports' markdown-lite → HTML, chunking at 4,000 characters, the brief feedback
// buttons (only Marcus, only his private chat, recorded through the one processor), and the outbox sender.
import { randomUUID } from 'node:crypto';
import { createProduct, enqueueNotification, getBrief, insertBrief, listUnsentNotifications, schema } from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type BotContext,
  type EditOptions,
  type SendOptions,
  type TelegramApi,
  feedbackData,
  handleCallback,
  parseFeedbackData,
  sendOutbox,
} from '../src/telegram/bot.ts';
import { TELEGRAM_CHUNK, chunkHtml, escapeHtml, markdownLiteToHtml } from '../src/telegram/format.ts';

describe('formatting', () => {
  it('escapes <, > and & and turns only our own markup into tags', () => {
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
    expect(markdownLiteToHtml('# Title <x>\n**Bold** & plain\n- item <script>\n**unbalanced')).toBe(
      '<b>Title &lt;x&gt;</b>\n<b>Bold</b> &amp; plain\n• item &lt;script&gt;\n**unbalanced',
    );
  });

  it('chunks at line boundaries, every chunk within the limit, nothing lost', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `<b>line ${i}</b> ${'x'.repeat(40)} &amp; more`);
    const html = lines.join('\n');
    const chunks = chunkHtml(html);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(TELEGRAM_CHUNK);
    expect(chunks.join('\n')).toBe(html);
    expect(chunkHtml('short')).toEqual(['short']);
    expect(chunkHtml('')).toEqual([]);
  });

  it('splits a single over-long line without breaking an entity, dropping its bold', () => {
    const line = `<b>${'a&amp;'.repeat(1500)}</b>`;
    const chunks = chunkHtml(line, 1000);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1000);
      expect(c).not.toMatch(/&(?!amp;)|&a(?!mp;)/); // no entity cut in two
      expect(c).not.toContain('<b>');
    }
    expect(chunks.join('')).toBe('a&amp;'.repeat(1500));
  });
});

describe('feedback buttons', () => {
  it('callback data stays under 64 bytes and parses back; anything else is refused', () => {
    const id = randomUUID();
    for (const verb of ['useful', 'new'] as const) {
      const data = feedbackData(verb, id);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseFeedbackData(data)).toEqual({ verb, briefId: id });
    }
    for (const bad of ['v1:useful:x:0', `v2:useful:${id}:0`, `v1:approve:${id}:0`, `v1:new:${id}:1`, '']) {
      expect(parseFeedbackData(bad)).toBeNull();
    }
  });
});

// ── With a database ─────────────────────────────────────────────────────────────────────────

let t: TestDatabase;
let productId: string;
beforeAll(async () => {
  t = await createTestDatabase();
  productId = (await createProduct(t.db, { slug: 'tg', name: 'TG', packId: 'test-pack', settings: TEST_SETTINGS })).id;
});
afterAll(async () => t.drop());

const OWNER = 424242;

interface Sent {
  chatId: number;
  text: string;
  other?: SendOptions;
}

function fakeApi(fail?: (text: string, other?: SendOptions) => Error | undefined) {
  const sent: Sent[] = [];
  const answers: (string | undefined)[] = [];
  const edits: unknown[] = [];
  const texts: { messageId: number; text: string; other?: EditOptions }[] = [];
  const api: TelegramApi = {
    sendMessage(chatId, text, other) {
      const error = fail?.(text, other);
      if (error !== undefined) return Promise.reject(error);
      sent.push({ chatId, text, ...(other === undefined ? {} : { other }) });
      return Promise.resolve({ message_id: sent.length });
    },
    answerCallbackQuery(_id, other) {
      answers.push(other?.text);
      return Promise.resolve(true);
    },
    editMessageReplyMarkup(_chat, _message, other) {
      edits.push(other?.reply_markup);
      return Promise.resolve(true);
    },
    editMessageText(_chat, messageId, text, other) {
      texts.push({ messageId, text, ...(other === undefined ? {} : { other }) });
      return Promise.resolve(true);
    },
  };
  return { api, sent, answers, edits, texts };
}

const context = (api: TelegramApi): BotContext => ({
  db: t.db,
  api,
  ownerId: OWNER,
  requests: { actors: new Set([`telegram:${OWNER}`]), packs: createRegistry([]) },
});

async function brief(markdown = '# Brief\nBody') {
  return insertBrief(t.db, { productId, kind: 'weekly', numbers: {}, markdown });
}

const press = (data: string, from = OWNER, chatType = 'private') => ({
  id: randomUUID(),
  from: { id: from },
  data,
  message: { message_id: 7, chat: { id: from, type: chatType } },
});

describe('the feedback callback', () => {
  it('ignores anyone but Marcus, and any chat but his private one', async () => {
    const { api, answers } = fakeApi();
    const b = await brief();
    expect(await handleCallback(context(api), press(feedbackData('useful', b.id), 999))).toBe('ignored');
    expect(await handleCallback(context(api), press(feedbackData('useful', b.id), OWNER, 'group'))).toBe('ignored');
    expect(answers).toEqual([]);
    expect(await getBrief(t.db, b.id)).toMatchObject({ feedbackUseful: null, feedbackNewInfo: null });
  });

  it('records each press as a brief_feedback request; a press toggles that answer and keeps the other', async () => {
    const { api, answers, edits } = fakeApi();
    const b = await brief();
    expect(await handleCallback(context(api), press(feedbackData('useful', b.id)))).toBe('recorded');
    expect(await getBrief(t.db, b.id)).toMatchObject({ feedbackUseful: true, feedbackNewInfo: false });
    expect(await handleCallback(context(api), press(feedbackData('new', b.id)))).toBe('recorded');
    expect(await getBrief(t.db, b.id)).toMatchObject({ feedbackUseful: true, feedbackNewInfo: true });
    expect(await handleCallback(context(api), press(feedbackData('useful', b.id)))).toBe('recorded');
    expect(await getBrief(t.db, b.id)).toMatchObject({ feedbackUseful: false, feedbackNewInfo: true });
    expect(answers.at(-1)).toBe('Saved: useful no, new to me yes');
    expect(JSON.stringify(edits.at(-1))).toContain('✅ new to me');
    const requests = (await t.db.select().from(schema.operatorRequests)).filter((r) => r.kind === 'brief_feedback');
    expect(requests.filter((r) => r.status === 'done' && r.channel === 'telegram')).toHaveLength(3);
    expect(requests.every((r) => r.actor === `telegram:${OWNER}`)).toBe(true);
  });

  it('answers an unknown button or a missing brief without recording anything', async () => {
    const { api, answers } = fakeApi();
    expect(await handleCallback(context(api), press('v1:approve:x:0'))).toBe('unknown');
    expect(await handleCallback(context(api), press(feedbackData('useful', randomUUID())))).toBe('unknown');
    expect(answers).toHaveLength(2);
  });
});

describe('the outbox sender', () => {
  beforeEach(async () => {
    await t.db.update(schema.notifications).set({ sentAt: new Date() });
  });

  it('sends digests and briefs as HTML to Marcus; the brief carries the buttons on its last message', async () => {
    const { api, sent } = fakeApi();
    const long = ['# Weekly', ...Array.from({ length: 200 }, (_, i) => `- campaign <${i}> & ${'y'.repeat(30)}`)];
    const b = await brief(long.join('\n'));
    await enqueueNotification(t.db, {
      productId,
      kind: 'digest',
      payload: { cycleId: 'c', text: '**TG · day**\nA & B' },
    });
    await enqueueNotification(t.db, { productId, kind: 'brief', payload: { cycleId: 'c', briefId: b.id } });
    await enqueueNotification(t.db, {
      productId,
      kind: 'alert',
      payload: { alert: 'invalid_settings', issues: ['x<y'] },
    });
    expect(await sendOutbox(context(api))).toEqual({ sent: 3, stalled: false });
    expect(sent[0]).toMatchObject({ chatId: OWNER, text: '<b>TG · day</b>\nA &amp; B', other: { parse_mode: 'HTML' } });
    const briefMessages = sent.slice(1, -1);
    expect(briefMessages.length).toBeGreaterThan(1);
    expect(briefMessages.slice(0, -1).every((m) => m.other?.reply_markup === undefined)).toBe(true);
    expect(JSON.stringify(briefMessages.at(-1)?.other?.reply_markup)).toContain(feedbackData('useful', b.id));
    expect(briefMessages[0]?.text).toContain('• campaign &lt;0&gt; &amp;');
    expect(sent.at(-1)?.text).toBe('<b>⚠️ Alert (tg): invalid_settings</b>\nissues: ["x&lt;y"]');
    expect(await listUnsentNotifications(t.db)).toHaveLength(0);
    expect((await getBrief(t.db, b.id)).sentAt).not.toBeNull();
    // Nothing is sent twice.
    expect(await sendOutbox(context(api))).toEqual({ sent: 0, stalled: false });
  });

  it('a network error leaves the notification queued; a refused message goes out as plain text', async () => {
    let down = true;
    const { api, sent } = fakeApi((text, other) => {
      if (down) return new TypeError('fetch failed');
      if (other?.parse_mode === 'HTML' && text.includes('&amp;'))
        return Object.assign(new Error("Bad Request: can't parse entities"), { error_code: 400 });
      return undefined;
    });
    await enqueueNotification(t.db, { productId, kind: 'digest', payload: { cycleId: 'd', text: 'A & B' } });
    expect(await sendOutbox(context(api))).toEqual({ sent: 0, stalled: true });
    expect(await listUnsentNotifications(t.db)).toHaveLength(1);
    down = false;
    expect(await sendOutbox(context(api))).toEqual({ sent: 1, stalled: false });
    expect(sent).toEqual([{ chatId: OWNER, text: 'A & B', other: { link_preview_options: { is_disabled: true } } }]);
    expect(await listUnsentNotifications(t.db)).toHaveLength(0);
  });
});

describe('the outbox sender, when a send fails part-way', () => {
  beforeEach(async () => {
    await t.db.update(schema.notifications).set({ sentAt: new Date() });
  });

  it('continues a long brief where it stopped, without sending its first messages again', async () => {
    const b = await brief(
      ['# Long', ...Array.from({ length: 300 }, (_, i) => `- line ${i} ${'z'.repeat(40)}`)].join('\n'),
    );
    await enqueueNotification(t.db, { productId, kind: 'brief', payload: { cycleId: 'p', briefId: b.id } });
    let calls = 0;
    const { api, sent } = fakeApi(() => (++calls === 2 ? new TypeError('fetch failed') : undefined));
    expect(await sendOutbox(context(api))).toEqual({ sent: 0, stalled: true });
    expect(sent).toHaveLength(1);
    expect(await sendOutbox(context(api))).toEqual({ sent: 1, stalled: false });
    const texts = sent.map((m) => m.text);
    expect(new Set(texts).size).toBe(texts.length); // no message twice
    expect(texts[0]).toContain('<b>Long</b>');
    expect(sent.filter((m) => m.other?.reply_markup !== undefined)).toHaveLength(1);
  });

  it('drops a notification that can’t be rendered (its brief is gone) instead of retrying it forever', async () => {
    const { api, sent } = fakeApi();
    await enqueueNotification(t.db, { productId, kind: 'brief', payload: { cycleId: 'q', briefId: randomUUID() } });
    await enqueueNotification(t.db, { productId, kind: 'digest', payload: { cycleId: 'q', text: 'after' } });
    expect(await sendOutbox(context(api))).toEqual({ sent: 1, stalled: false });
    expect(sent.map((m) => m.text)).toEqual(['after']);
    expect(await listUnsentNotifications(t.db)).toHaveLength(0);
  });
});
