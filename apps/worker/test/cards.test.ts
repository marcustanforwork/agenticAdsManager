// Proposal cards and deciding from Telegram (M09a): callback data, the edit grammar, the card, and Approve /
// Reject / Edit through the one processor, with the version, expiry and user-id checks.
import { EditSpec, type EntityRef, WriteOp } from '@ads/contracts';
import { EditError, applyEdit } from '@ads/core';
import {
  createProduct,
  createProposal,
  enqueueNotification,
  getConversation,
  getCurrentApproval,
  getProposal,
  insertFinding,
  listEvalCases,
  listProposalVersions,
  newVersion,
  setConversation,
  startManual,
  upsertAccount,
  upsertAdEntity,
} from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import fc from 'fast-check';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BotContext,
  type CallbackQuery,
  type EditOptions,
  type SendOptions,
  type TelegramApi,
  feedbackData,
  handleCallback,
  sendOutbox,
} from '../src/telegram/bot.ts';
import { CARD_VERBS, cardData, localTime, parseCardData } from '../src/telegram/cards.ts';
import { type ChatMessage, handleMessage } from '../src/telegram/decide.ts';
import { parseEdit } from '../src/editGrammar.ts';

// ── Without a database ──────────────────────────────────────────────────────────────────────

describe('callback data', () => {
  it('is 64 bytes or less for every verb, at the longest short id and version, and parses back', () => {
    for (const verb of CARD_VERBS) {
      const data = cardData(verb, 'zzzzzzzz', 999_999);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseCardData(data)).toEqual({ verb, shortId: 'zzzzzzzz', version: 999_999 });
    }
    for (const verb of ['useful', 'new'] as const) {
      expect(Buffer.byteLength(feedbackData(verb, 'ffffffff-ffff-4fff-bfff-ffffffffffff'))).toBeLessThanOrEqual(64);
    }
  });

  it('refuses anything else, and never builds bad data', () => {
    for (const bad of [
      'v1:approve:abcdefgh:0',
      'v1:approve:abcdefgh:01',
      'v1:approve:abcdefgh:1000000',
      'v1:approve:abcdefg1:1', // "1" is not in the short-id alphabet
      'v1:apply:abcdefgh:1',
      'v2:approve:abcdefgh:1',
      'v1:approve:abcdefgh:1 ',
      '',
    ]) {
      expect(parseCardData(bad)).toBeNull();
    }
    expect(() => cardData('approve', 'short', 1)).toThrow(RangeError);
    expect(() => cardData('approve', 'abcdefgh', 0)).toThrow(RangeError);
  });

  it('round-trips every short id and version', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CARD_VERBS),
        fc.string({ unit: fc.constantFrom(...'abcdefghijkmnpqrstuvwxyz23456789'), minLength: 8, maxLength: 8 }),
        fc.integer({ min: 1, max: 999_999 }),
        (verb, shortId, version) => {
          const data = cardData(verb, shortId, version);
          return (
            Buffer.byteLength(data) <= 64 &&
            JSON.stringify(parseCardData(data)) === JSON.stringify({ verb, shortId, version })
          );
        },
      ),
    );
  });
});

describe('the edit grammar', () => {
  it('parses budget, keyword and match edits', () => {
    expect(parseEdit('budget 45')).toEqual({ ok: true, edit: { field: 'budget', newDailyBudgetMicros: '45000000' } });
    expect(parseEdit('Budget S$1,250.5')).toEqual({
      ok: true,
      edit: { field: 'budget', newDailyBudgetMicros: '1250500000' },
    });
    expect(parseEdit('keyword "free photos"')).toEqual({
      ok: true,
      edit: { field: 'negative_text', text: 'free photos' },
    });
    expect(parseEdit('keyword  free   wedding pics ')).toEqual({
      ok: true,
      edit: { field: 'negative_text', text: 'free wedding pics' },
    });
    expect(parseEdit('match exact')).toEqual({ ok: true, edit: { field: 'match_type', matchType: 'EXACT' } });
    expect(parseEdit('MATCH Phrase')).toEqual({ ok: true, edit: { field: 'match_type', matchType: 'PHRASE' } });
  });

  it('refuses everything else, with the grammar in the answer', () => {
    for (const bad of [
      'budget',
      'budget 0',
      'budget -5',
      'budget 4.555',
      'budget 1e3',
      'budget 99999999',
      'keyword ""',
      `keyword ${'x'.repeat(81)}`,
      'match broad',
      'pause it',
      '',
    ]) {
      const parsed = parseEdit(bad);
      expect(parsed.ok, bad).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toContain('budget 45');
    }
  });

  const target: EntityRef = { platform: 'google', accountId: '123', type: 'ad_group', externalId: '9' };
  const actionFor = (edit: EditSpec, previous: bigint): WriteOp =>
    edit.field === 'budget'
      ? { action: 'adjust_budget', target, newDailyBudgetMicros: (previous - 10_000n).toString(), netIncrease: false }
      : { action: 'add_negative_keyword', target, text: 'free photos', matchType: 'EXACT' };

  it('property: every parsed edit, applied to an action it fits, gives a valid WriteOp (or a stated refusal)', () => {
    const editText = fc.oneof(
      fc
        .tuple(fc.integer({ min: 0, max: 9_999_999 }), fc.option(fc.integer({ min: 0, max: 99 })))
        .map(([w, f]) => `budget ${w}${f === null ? '' : `.${String(f).padStart(2, '0')}`}`),
      fc.string({ maxLength: 100 }).map((s) => `keyword ${s}`),
      fc.string({ maxLength: 100 }).map((s) => `keyword "${s}"`),
      fc.constantFrom('match exact', 'match phrase', 'match EXACT', 'match broad'),
      fc.string({ maxLength: 40 }),
    );
    fc.assert(
      fc.property(editText, fc.bigInt({ min: 20_000n, max: 10_000_000_000n }), (text, prevRaw) => {
        const parsed = parseEdit(text);
        if (!parsed.ok) return true;
        expect(EditSpec.safeParse(parsed.edit).success).toBe(true);
        const previous = (prevRaw / 10_000n) * 10_000n;
        try {
          const out = applyEdit(actionFor(parsed.edit, previous), parsed.edit, {
            previousDailyBudgetMicros: previous,
            guards: { maxBudgetChangePct: 100 },
          });
          expect(WriteOp.safeParse(out).success).toBe(true);
          if (parsed.edit.field === 'budget')
            expect(out).toMatchObject({ newDailyBudgetMicros: parsed.edit.newDailyBudgetMicros });
        } catch (error) {
          expect(error).toBeInstanceOf(EditError);
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});

describe('localTime', () => {
  it('shows the product timezone', () => {
    expect(localTime(new Date('2026-10-21T02:00:00Z'), 'Asia/Singapore')).toBe('2026-10-21 10:00');
  });
});

// ── With a database ─────────────────────────────────────────────────────────────────────────

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const OWNER = 515151;
const STRANGER = 616161;
const NOW = new Date('2026-10-14T03:00:00Z');

function fakeApi() {
  const sent: { text: string; other?: SendOptions }[] = [];
  const answers: (string | undefined)[] = [];
  const edited: { messageId: number; text: string; other?: EditOptions }[] = [];
  const api: TelegramApi = {
    sendMessage(_chat, text, other) {
      sent.push({ text, ...(other === undefined ? {} : { other }) });
      return Promise.resolve({ message_id: 1000 + sent.length });
    },
    answerCallbackQuery(_id, other) {
      answers.push(other?.text);
      return Promise.resolve(true);
    },
    editMessageReplyMarkup: () => Promise.resolve(true),
    editMessageText(_chat, messageId, text, other) {
      edited.push({ messageId, text, ...(other === undefined ? {} : { other }) });
      return Promise.resolve(true);
    },
  };
  return { api, sent, answers, edited };
}

function botFor(api: TelegramApi, now = NOW): BotContext {
  return {
    db: t.db,
    api,
    ownerId: OWNER,
    requests: { actors: new Set([`telegram:${OWNER}`]), packs: createRegistry([]) },
    now: () => now,
  };
}

const press = (data: string, opts: { from?: number; chat?: string; messageId?: number } = {}): CallbackQuery => ({
  id: `q-${randomBytes(3).toString('hex')}`,
  from: { id: opts.from ?? OWNER },
  data,
  message: { message_id: opts.messageId ?? 77, chat: { id: opts.from ?? OWNER, type: opts.chat ?? 'private' } },
});

const say = (text: string, opts: { from?: number; chat?: string } = {}): ChatMessage => ({
  message_id: 5,
  from: { id: opts.from ?? OWNER },
  chat: { id: opts.from ?? OWNER, type: opts.chat ?? 'private' },
  text,
});

async function world() {
  const product = await createProduct(t.db, {
    slug: `cards-${randomBytes(3).toString('hex')}`,
    name: 'Cards',
    packId: 'test-pack',
    settings: TEST_SETTINGS,
  });
  const accountId = String(5_550_000_000 + Math.floor(Math.random() * 1_000_000));
  const account = await upsertAccount(t.db, { productId: product.id, platform: 'google', externalId: accountId });
  const entity = (type: 'campaign' | 'ad_group', externalId: string, name: string) =>
    upsertAdEntity(t.db, {
      productId: product.id,
      accountId: account.id,
      platform: 'google',
      type,
      externalId,
      name,
      status: 'active',
      rawStatus: 'ENABLED',
      dailyBudgetMicros: type === 'campaign' ? 100_000_000n : null,
    });
  const campaign = await entity('campaign', '8', 'Summer <promo> & co');
  await entity('ad_group', '9', 'Weddings');
  const cycle = await startManual(t.db, { productId: product.id, cycleDate: '2026-10-13' });
  const finding = await insertFinding(t.db, {
    productId: product.id,
    cycleId: cycle.id,
    type: 'zero_outcome_spend',
    source: 'detector',
    targetEntityId: campaign.id,
    analystVerdict: 'confirmed',
    summary: 's',
    evidence: {
      windowDays: 14,
      impressions: 1200,
      clicks: 40,
      spendMicros: '12300000',
      outcomesByStage: { signup: 0 },
      from: '2026-09-29',
      to: '2026-10-12',
      dataDays: 14,
    },
    passedThreshold: true,
  });
  const campaignRef: EntityRef = { platform: 'google', accountId, type: 'campaign', externalId: '8' };
  const adGroupRef: EntityRef = { ...campaignRef, type: 'ad_group', externalId: '9' };
  const base = {
    productId: product.id,
    cycleId: cycle.id,
    origin: 'agent' as const,
    preconditionHash: 'h',
    preconditionFields: ['status'],
    rationale: 'No signups in 14 days <despite> spend.',
    expectedEffect: 'The spend stops.',
    // The processor checks expiry on the real clock; the bot's own clock is NOW.
    expiresAt: new Date(Math.max(Date.now(), NOW.getTime()) + 7 * 86_400_000),
  };
  const pause = (findingId: string | null = finding.id, expiresAt = base.expiresAt) =>
    createProposal(t.db, {
      ...base,
      findingId,
      expiresAt,
      action: { action: 'pause_entity', target: campaignRef },
      undo: { action: 'resume_entity', target: campaignRef },
    });
  const negative = () =>
    createProposal(t.db, {
      ...base,
      findingId: null,
      action: { action: 'add_negative_keyword', target: adGroupRef, text: 'free photos', matchType: 'EXACT' },
      undo: { action: 'remove_negative_keyword', target: adGroupRef, criterionId: 'set-at-apply' },
    });
  const budget = () =>
    createProposal(t.db, {
      ...base,
      findingId: null,
      action: { action: 'adjust_budget', target: campaignRef, newDailyBudgetMicros: '80000000', netIncrease: false },
      undo: { action: 'adjust_budget', target: campaignRef, newDailyBudgetMicros: '100000000', netIncrease: true },
    });
  return { product, accountId, finding, pause, negative, budget };
}

describe('the card in the outbox', () => {
  it('shows the change, before → after, the evidence, the words, the expiry and the buttons; platform text escaped', async () => {
    const w = await world();
    const p = await w.pause();
    await enqueueNotification(t.db, { productId: w.product.id, kind: 'proposal', payload: { proposalId: p.id } });
    const { api, sent } = fakeApi();
    await sendOutbox(botFor(api));
    const card = sent.find((s) => s.text.includes(p.shortId));
    expect(card?.text).toContain(`<b>Proposal ${p.shortId}</b> · v1 · ${w.product.slug} · zero_outcome_spend`);
    expect(card?.text).toContain(
      `<b>Pause</b> campaign “Summer &lt;promo&gt; &amp; co” <code>google:${w.accountId}:campaign:8</code>`,
    );
    expect(card?.text).toContain('Before → after: status active → paused');
    expect(card?.text).toContain(
      'Evidence (2026-09-29 to 2026-10-12, 14 days): spend S$12.30 · 40 clicks · 1200 impressions · 0 signups',
    );
    expect(card?.text).toContain('<b>Why:</b> No signups in 14 days &lt;despite&gt; spend.');
    expect(card?.text).toContain('<b>Expected:</b> The spend stops.');
    expect(card?.text).toContain(`Expires ${localTime(p.expiresAt, 'Asia/Singapore')} (Asia/Singapore)`);
    // A pause has nothing to edit: no Edit button.
    expect(card?.other?.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `v1:approve:${p.shortId}:1` },
          { text: '❌ Reject', callback_data: `v1:reject:${p.shortId}:1` },
        ],
      ],
    });
  });

  it('shows a budget change and a negative keyword as before → after', async () => {
    const w = await world();
    const b = await w.budget();
    const n = await w.negative();
    for (const p of [b, n]) {
      await enqueueNotification(t.db, { productId: w.product.id, kind: 'proposal', payload: { proposalId: p.id } });
    }
    const { api, sent } = fakeApi();
    await sendOutbox(botFor(api));
    const text = sent.map((s) => s.text).join('\n');
    expect(text).toContain('<b>Cut the daily budget</b> of campaign');
    expect(text).toContain('Before → after: S$100.00 → S$80.00 a day');
    expect(text).toContain('<b>Add a negative keyword</b> to ad group “Weddings”');
    expect(text).toContain('Before → after: + “free photos” (exact match) blocked');
    for (const p of [b, n]) {
      const card = sent.find((s) => s.text.includes(`<b>Proposal ${p.shortId}</b>`));
      expect(JSON.stringify(card?.other?.reply_markup)).toContain(`v1:edit:${p.shortId}:1`);
    }
  });
});

describe('Approve', () => {
  it('approves the version on the card; a double tap makes one approval; the card loses its buttons', async () => {
    const w = await world();
    const p = await w.pause();
    const { api, answers, edited } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`))).toBe('recorded');
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`))).toBe('recorded'); // the duplicate
    expect(answers).toEqual(['Approved v1', 'Approved v1']);
    expect(await getCurrentApproval(t.db, p.id)).toMatchObject({
      proposalVersion: 1,
      channel: 'telegram',
      actor: `telegram:${OWNER}`,
    });
    expect((await listEvalCases(t.db, w.product.id)).length).toBe(1);
    expect(edited.at(-1)).toMatchObject({ messageId: 77, other: { reply_markup: { inline_keyboard: [] } } });
    expect(edited.at(-1)?.text).toContain('Status: ✅ approved');
  });

  it('refuses a stale version and an expired proposal, and re-renders the card', async () => {
    const w = await world();
    const p = await w.pause();
    await newVersion(t.db, { proposalId: p.id, baseVersion: 1, action: p.action, undo: p.undo, preconditionHash: 'h' });
    const { api, answers, edited } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`))).toBe('refused');
    expect(answers.at(-1)).toMatch(/^Not approved: /);
    expect(await getCurrentApproval(t.db, p.id)).toBeNull();
    expect(edited.at(-1)?.other?.reply_markup).toEqual(
      expect.objectContaining({
        inline_keyboard: [
          expect.arrayContaining([expect.objectContaining({ callback_data: `v1:approve:${p.shortId}:2` })]),
        ],
      }),
    );

    const old = await w.pause(null, new Date(Date.now() - 60_000));
    expect(await handleCallback(bot, press(`v1:approve:${old.shortId}:1`))).toBe('refused');
    expect(answers.at(-1)).toBe(`Not approved: proposal ${old.shortId} has expired`);
    expect((await getProposal(t.db, old.id)).status).toBe('pending');
  });

  it('ignores a stranger and a group chat, and answers a press on a proposal that does not exist', async () => {
    const w = await world();
    const p = await w.pause();
    const { api, answers } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`, { from: STRANGER }))).toBe('ignored');
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`, { chat: 'group' }))).toBe('ignored');
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`, { chat: 'supergroup' }))).toBe('ignored');
    expect(answers).toEqual([]);
    expect((await getProposal(t.db, p.id)).status).toBe('pending');
    expect(await handleCallback(bot, press('v1:approve:aaaaaaaa:1'))).toBe('unknown');
    expect(answers).toEqual(['That proposal no longer exists.']);
  });
});

describe('Reject, then Approve instead', () => {
  it('the approval ends the open question, so the next message is not taken as a reason', async () => {
    const w = await world();
    const p = await w.pause();
    const { api } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:reject:${p.shortId}:1`))).toBe('asked');
    expect(await handleCallback(bot, press(`v1:approve:${p.shortId}:1`))).toBe('recorded');
    expect(await getConversation(t.db, OWNER, NOW)).toBeNull();
    expect(await handleMessage(bot, say('thanks!'))).toBe('no_conversation');
    expect((await getProposal(t.db, p.id)).status).toBe('approved');
  });
});

describe('Reject', () => {
  it('asks for a reason, insists on one, and records it', async () => {
    const w = await world();
    const p = await w.pause();
    const { api, sent, edited } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:reject:${p.shortId}:1`))).toBe('asked');
    expect(sent.at(-1)?.text).toContain(`Why reject <b>${p.shortId}</b> v1?`);
    expect(sent.at(-1)?.other?.reply_markup).toMatchObject({ force_reply: true });
    expect(await getConversation(t.db, OWNER, NOW)).toMatchObject({
      awaiting: 'reject_reason',
      proposalId: p.id,
      cardMessageId: 77,
    });

    expect(await handleMessage(bot, say('no'))).toBe('retry');
    expect(sent.at(-1)?.text).toContain('at least 3 characters');
    expect(await handleMessage(bot, say('A seasonal dip, not waste'))).toBe('recorded');
    expect(sent.at(-1)?.text).toBe(`Rejected: <b>${p.shortId}</b> v1.`);
    expect(await getCurrentApproval(t.db, p.id)).toMatchObject({
      decision: 'reject',
      reason: 'A seasonal dip, not waste',
    });
    expect(await getConversation(t.db, OWNER, NOW)).toBeNull();
    expect(edited.at(-1)).toMatchObject({ messageId: 77 });
    expect(edited.at(-1)?.text).toContain('Status: ❌ rejected');
  });

  it('forgets the question after 10 minutes, and /cancel ends it', async () => {
    const w = await world();
    const p = await w.pause();
    const { api, sent } = fakeApi();
    expect(await handleCallback(botFor(api), press(`v1:reject:${p.shortId}:1`))).toBe('asked');
    const later = botFor(api, new Date(NOW.getTime() + 10 * 60_000));
    expect(await handleMessage(later, say('changed my mind about it'))).toBe('no_conversation');
    expect((await getProposal(t.db, p.id)).status).toBe('pending');

    expect(await handleCallback(botFor(api), press(`v1:reject:${p.shortId}:1`))).toBe('asked');
    expect(await handleMessage(botFor(api), say('/cancel'))).toBe('cancelled');
    expect(sent.at(-1)?.text).toBe('Cancelled. The card is unchanged.');
    expect(await handleMessage(botFor(api), say('too late now'))).toBe('no_conversation');
    expect((await getProposal(t.db, p.id)).status).toBe('pending');
  });

  it('a stale card asks nothing; a reply from a stranger or a group is ignored', async () => {
    const w = await world();
    const p = await w.pause();
    const { api, answers } = fakeApi();
    const bot = botFor(api);
    await newVersion(t.db, { proposalId: p.id, baseVersion: 1, action: p.action, undo: p.undo, preconditionHash: 'h' });
    expect(await handleCallback(bot, press(`v1:reject:${p.shortId}:1`))).toBe('refused');
    expect(answers.at(-1)).toBe('This card is out of date; here is the current one.');
    expect(await getConversation(t.db, OWNER, NOW)).toBeNull();

    await setConversation(
      t.db,
      OWNER,
      { awaiting: 'reject_reason', proposalId: p.id, shortId: p.shortId, version: 2, cardMessageId: null },
      { now: NOW },
    );
    expect(await handleMessage(bot, say('a stranger’s reason', { from: STRANGER }))).toBe('ignored');
    expect(await handleMessage(bot, say('a group’s reason', { chat: 'group' }))).toBe('ignored');
    expect((await getProposal(t.db, p.id)).status).toBe('pending');
  });
});

describe('Edit', () => {
  it('makes a new version from the reply, approves it, and re-renders the card at that version', async () => {
    const w = await world();
    const p = await w.budget();
    const { api, sent, edited } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:edit:${p.shortId}:1`, { messageId: 88 }))).toBe('asked');
    expect(sent.at(-1)?.text).toContain('budget 45');
    expect(await handleMessage(bot, say('budget lots'))).toBe('retry');
    expect(await handleMessage(bot, say('budget 90'))).toBe('recorded');
    expect(sent.at(-1)?.text).toBe(`Edited and approved: <b>${p.shortId}</b> v2.`);
    const after = await getProposal(t.db, p.id);
    expect(after).toMatchObject({ status: 'approved', version: 2 });
    expect(after.action).toMatchObject({ newDailyBudgetMicros: '90000000', netIncrease: false });
    expect(await getCurrentApproval(t.db, p.id)).toMatchObject({ proposalVersion: 2, actionHash: after.actionHash });
    expect((await listProposalVersions(t.db, p.id)).length).toBe(2);
    expect(edited.at(-1)).toMatchObject({ messageId: 88 });
    expect(edited.at(-1)?.text).toContain('· v2 ·');
    expect(edited.at(-1)?.text).toContain('S$100.00 → S$90.00 a day');
  });

  it('a refused edit says why and leaves the proposal pending; a pause has nothing to edit', async () => {
    const w = await world();
    const n = await w.negative();
    const { api, sent, answers } = fakeApi();
    const bot = botFor(api);
    expect(await handleCallback(bot, press(`v1:edit:${n.shortId}:1`))).toBe('asked');
    expect(await handleMessage(bot, say('budget 45'))).toBe('refused');
    expect(sent.at(-1)?.text).toContain('Not saved: a budget edit needs a budget change, not add_negative_keyword');
    expect((await getProposal(t.db, n.id)).status).toBe('pending');

    expect(await handleCallback(bot, press(`v1:edit:${n.shortId}:1`))).toBe('asked');
    expect(await handleMessage(bot, say('match phrase'))).toBe('recorded');
    expect((await getProposal(t.db, n.id)).action).toMatchObject({ matchType: 'PHRASE', text: 'free photos' });

    const p = await w.pause();
    expect(await handleCallback(bot, press(`v1:edit:${p.shortId}:1`))).toBe('refused');
    expect(answers.at(-1)).toBe('This change has nothing to edit: approve or reject it.');
  });
});

describe('messages without a conversation', () => {
  it('get a short help', async () => {
    const { api, sent } = fakeApi();
    expect(await handleMessage(botFor(api), say('hello'))).toBe('no_conversation');
    expect(sent.at(-1)?.text).toContain('Use the buttons on a proposal card');
    expect(await handleMessage(botFor(api), say('/cancel'))).toBe('cancelled');
    expect(sent.at(-1)?.text).toBe('Nothing to cancel.');
  });
});

describe('alerts in Telegram', () => {
  it('show the alert title and its details as plain lines', async () => {
    const w = await world();
    await enqueueNotification(t.db, {
      productId: w.product.id,
      kind: 'alert',
      payload: {
        alert: 'drift_on_open_proposal',
        key: 'drift_on_open_proposal:c1',
        cycleId: 'c1',
        entities: [{ target: 'google:1:campaign:<8>', fields: ['status'], proposals: ['abcdefgh'] }],
      },
    });
    await enqueueNotification(t.db, {
      productId: w.product.id,
      kind: 'alert',
      payload: {
        alert: 'trust_check_failed',
        key: 'k2',
        cycleId: 'c2',
        failed: [{ check: 'data_fresh', account: 'meta:act_1' }],
      },
    });
    await enqueueNotification(t.db, {
      productId: w.product.id,
      kind: 'alert',
      payload: {
        alert: 'request_failed',
        key: 'request_failed:r1',
        requestId: 'r1',
        kind: 'halt',
        attempts: 5,
        error: 'a <b>bad</b> day',
      },
    });
    const { api, sent } = fakeApi();
    await sendOutbox(botFor(api));
    const texts = sent.map((s) => s.text);
    expect(texts).toContainEqual(
      [
        `<b>⚠️ Alert (${w.product.slug}): Someone changed an ad entity that a pending proposal is about</b>`,
        '• <code>google:1:campaign:&lt;8&gt;</code>: status changed; pending: abcdefgh',
        'Check those proposals before deciding them; the next cycle drafts from the new state.',
        'cycleId: c1',
      ].join('\n'),
    );
    expect(texts).toContainEqual(
      [
        `<b>⚠️ Alert (${w.product.slug}): A trust check failed: this cycle stopped before the analysis</b>`,
        '• data_fresh (meta:act_1)',
        'cycleId: c2',
      ].join('\n'),
    );
    expect(texts).toContainEqual(
      [
        `<b>⚠️ Alert (${w.product.slug}): A request kept failing on our side and was stopped</b>`,
        'Nothing was changed. Ask again once the cause is fixed; the worker log has the details.',
        'kind: halt',
        'error: a &lt;b&gt;bad&lt;/b&gt; day',
        'attempts: 5',
        'requestId: r1', // jsonb keeps keys shortest first
      ].join('\n'),
    );
  });
});
