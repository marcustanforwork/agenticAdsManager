// Telegram operator commands (M09b): the grammar, entity resolution (never a guess), the confirm cards for /pause and
// /pause_all, halt and resume, the quick settings, /undo and /changes, and the read-only views. Every change goes
// through the one processor as Marcus.
import {
  createProduct,
  getProduct,
  getProposal,
  getSettingsHistory,
  insertBrief,
  insertChange,
  listProposals,
  recordDrift,
  setConversation,
  setProductStatus,
  upsertAccount,
  upsertAdEntity,
  type AdEntity,
  type Product,
} from '@ads/db';
import { TEST_SETTINGS, createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { createRegistry } from '@ads/pack-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BotContext,
  type EditOptions,
  type InlineKeyboard,
  type SendOptions,
  type TelegramApi,
  handleCallback,
} from '../src/telegram/bot.ts';
import { COMMANDS, MENU, findCommand, parseAmount, parseCommand } from '../src/telegram/commands.ts';
import { handleMessage } from '../src/telegram/decide.ts';
import { pauseData, parsePauseData } from '../src/telegram/pause.ts';

// ── Without a database ──────────────────────────────────────────────────────────────────────

describe('the command grammar', () => {
  it('parses a command, its bot suffix and its arguments; anything else is not a command', () => {
    expect(parseCommand('/pause Summer sale')).toEqual({ name: 'pause', args: 'Summer sale' });
    expect(parseCommand('  /Pause@AdsAgentBot   x  ')).toEqual({ name: 'pause', args: 'x' });
    expect(parseCommand('/pause-all snappool')).toEqual({ name: 'pause-all', args: 'snappool' });
    expect(parseCommand('/status')).toEqual({ name: 'status', args: '' });
    for (const bad of ['pause x', '/', '/ x', 'budget 45', '/9lives']) expect(parseCommand(bad)).toBeNull();
  });

  it('accepts the plan’s hyphen spellings; the menu uses only names Telegram allows', () => {
    expect(findCommand('pause-all')?.name).toBe('pause_all');
    expect(findCommand('resume-agent')?.name).toBe('resume_agent');
    expect(findCommand('start')?.name).toBe('help');
    expect(findCommand('apply')).toBeNull();
    for (const { command, description } of MENU) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    }
    const names = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('reads amounts like 20, 20.50 and S$1,000; refuses the rest', () => {
    expect(parseAmount('20')).toBe(20_000_000n);
    expect(parseAmount('S$1,000.5')).toBe(1_000_500_000n);
    for (const bad of ['0', '-5', '20.555', 'abc', '1e3', '']) expect(parseAmount(bad)).toBeNull();
  });

  it('pause buttons fit in 64 bytes and parse back', () => {
    const id = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    for (const verb of ['pick', 'allok', 'allno'] as const) {
      const data = pauseData(verb, id);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parsePauseData(data)).toEqual({ verb, id });
    }
    for (const bad of ['v1:pick:x:0', `v1:approve:${id}:0`, `v1:pick:${id}:1`, ''])
      expect(parsePauseData(bad)).toBeNull();
  });
});

// ── With a database ─────────────────────────────────────────────────────────────────────────

const OWNER = 616161;
let t: TestDatabase;
let main: Product; // active: the default product
let spare: Product; // dormant until the last test
const entities: Record<string, AdEntity> = {};

async function entity(product: Product, accountId: string, key: string, o: Partial<AdEntity> & { externalId: string }) {
  const e = await upsertAdEntity(t.db, {
    productId: product.id,
    accountId,
    platform: o.platform ?? 'google',
    type: o.type ?? 'campaign',
    externalId: o.externalId,
    parentId: o.parentId ?? null,
    name: o.name ?? key,
    status: o.status ?? 'active',
    rawStatus: 'X',
  });
  entities[key] = e;
  return e;
}

beforeAll(async () => {
  t = await createTestDatabase();
  main = await createProduct(t.db, { slug: 'main', name: 'Main', packId: 'test-pack', settings: TEST_SETTINGS });
  spare = await createProduct(t.db, {
    slug: 'spare',
    name: 'Spare',
    packId: 'test-pack',
    status: 'dormant',
    settings: TEST_SETTINGS,
  });
  const g = await upsertAccount(t.db, { productId: main.id, platform: 'google', externalId: '5550001' });
  const m = await upsertAccount(t.db, { productId: main.id, platform: 'meta', externalId: 'act_5550002' });
  const s = await upsertAccount(t.db, { productId: spare.id, platform: 'google', externalId: '5550003' });
  const summer = await entity(main, g.id, 'summer', { externalId: '101', name: 'Summer Sale <b>' });
  await entity(main, m.id, 'summerBrand', { platform: 'meta', externalId: '102', name: 'summer   brand' });
  await entity(main, g.id, 'winter', { externalId: '103', name: 'Winter', status: 'paused' });
  await entity(main, g.id, 'kw', { externalId: '104', name: 'Winter keyword', type: 'keyword' });
  await entity(main, g.id, 'autumnGroup', {
    externalId: '105',
    name: 'Autumn group',
    type: 'ad_group',
    parentId: summer.id,
  });
  await entity(main, g.id, 'idClash', { externalId: '106', name: '101 lookalike' });
  await entity(spare, s.id, 'spareA', { externalId: '201', name: 'Spare one' });
  await entity(spare, s.id, 'spareB', { externalId: '202', name: 'Spare two' });
});
afterAll(async () => t.drop());

function fakeApi() {
  const sent: { text: string; other?: SendOptions }[] = [];
  const answers: (string | undefined)[] = [];
  const edits: { messageId: number; text: string; other?: EditOptions }[] = [];
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
      edits.push({ messageId, text, ...(other === undefined ? {} : { other }) });
      return Promise.resolve(true);
    },
  };
  const last = () => sent.at(-1)?.text ?? '';
  const keyboardOf = (i = -1) => sent.at(i)?.other?.reply_markup as InlineKeyboard | undefined;
  return { api, sent, answers, edits, last, keyboardOf };
}

function bot() {
  const fake = fakeApi();
  const ctx: BotContext = {
    db: t.db,
    api: fake.api,
    ownerId: OWNER,
    requests: { actors: new Set([`telegram:${OWNER}`]), packs: createRegistry([]) },
  };
  const say = (text: string, from = OWNER) =>
    handleMessage(ctx, { message_id: 1, from: { id: from }, chat: { id: from, type: 'private' }, text });
  const press = (data: string, messageId = 77) =>
    handleCallback(ctx, {
      id: 'q',
      from: { id: OWNER },
      data,
      message: { message_id: messageId, chat: { id: OWNER, type: 'private' } },
    });
  return { ...fake, ctx, say, press };
}

const requestCount = async (): Promise<number> =>
  (await t.pool.query<{ n: number }>('select count(*)::int as n from operator_requests')).rows[0]?.n ?? -1;

const buttonsOf = (k: InlineKeyboard | undefined) => (k?.inline_keyboard ?? []).flat();

describe('/pause', () => {
  it('one match: a confirm card for an operator proposal; Confirm approves it, as Marcus', async () => {
    const b = bot();
    expect(await b.say('/pause sale')).toBe('command:recorded');
    const [p] = await listProposals(t.db, main.id, ['pending']);
    expect(p).toMatchObject({ origin: 'operator', action: { action: 'pause_entity', target: { externalId: '101' } } });
    const card = b.last();
    expect(card).toContain(`<b>Proposal ${p?.shortId}</b>`);
    expect(card).toContain('“Summer Sale &lt;b&gt;”'); // the platform's name, escaped
    expect(card).toContain('waiting for your confirmation');
    expect(card).toContain('Phase 1 applies nothing');
    const buttons = buttonsOf(b.keyboardOf());
    expect(buttons.map((x) => x.text)).toEqual(['✅ Confirm', '✖ Cancel']);

    expect(await b.press(buttons[0]?.callback_data ?? '')).toBe('recorded');
    expect((await getProposal(t.db, p?.id ?? '')).status).toBe('approved');
    expect(b.edits.at(-1)?.text).toContain('make the change by hand');

    // Asking again returns the same proposal: no second one.
    await b.say('/pause sale');
    expect(b.sent.at(-2)?.text).toContain('already open');
    expect(await listProposals(t.db, main.id)).toHaveLength(1);
  });

  it('several matches: buttons listing them, and nothing created until Marcus picks one', async () => {
    const b = bot();
    const before = (await listProposals(t.db, main.id)).length;
    expect(await b.say('/pause summer')).toBe('command:shown');
    expect(b.last()).toContain('2 active things match “summer”. Which one?');
    const buttons = buttonsOf(b.keyboardOf());
    expect(buttons.map((x) => x.text).sort()).toEqual([
      'campaign “Summer Sale <b>” (main)',
      'campaign “summer brand” (main)',
    ]);
    expect(await listProposals(t.db, main.id)).toHaveLength(before);

    const brand = buttons.find((x) => x.text.includes('brand'));
    expect(await b.press(brand?.callback_data ?? '')).toBe('recorded');
    const created = (await listProposals(t.db, main.id, ['pending']))[0];
    expect(created?.action).toMatchObject({ target: { platform: 'meta', externalId: '102' } });
    expect(b.last()).toContain(`Proposal ${created?.shortId}`);
  });

  it('an exact id wins over names; a paused match is explained; no match says so; usage without arguments', async () => {
    const b = bot();
    // "101" is campaign 101's id and also part of the name "101 lookalike": the id wins, so no "Which one?".
    const summer = (await listProposals(t.db, main.id, ['approved']))[0];
    expect(await b.say('/pause 101')).toBe('command:recorded');
    expect(b.sent.map((m) => m.text).join('\n')).not.toContain('Which one?');
    expect(b.last()).toContain(`Proposal ${summer?.shortId}`); // its open pause, already confirmed
    await b.say('/pause 105'); // an ad group, by its id
    expect(
      (await listProposals(t.db, main.id, ['pending'])).some(
        (p) => p.action.action === 'pause_entity' && p.action.target.externalId === '105',
      ),
    ).toBe(true);

    const count0 = await requestCount();
    expect(await b.say('/pause winter')).toBe('command:refused');
    expect(b.last()).toContain("these match but aren't active");
    expect(b.last()).toContain('“Winter”');
    expect(b.last()).not.toContain('keyword'); // keywords can't be paused here, so they never match
    expect(await b.say('/pause nothing-like-it')).toBe('command:refused');
    expect(b.last()).toContain('Nothing matches “nothing-like-it”');
    expect(await b.say('/pause')).toBe('command:usage');
    expect(await requestCount()).toBe(count0); // none of these recorded a request
  });

  it('Cancel on Marcus’s own card rejects it at once, without asking for a reason', async () => {
    const b = bot();
    await b.say('/pause 106');
    const p = (await listProposals(t.db, main.id, ['pending'])).find(
      (x) => x.action.action === 'pause_entity' && x.action.target.externalId === '106',
    );
    const cancel = buttonsOf(b.keyboardOf()).find((x) => x.text === '✖ Cancel');
    expect(await b.press(cancel?.callback_data ?? '')).toBe('recorded');
    expect(b.answers.at(-1)).toBe('Cancelled');
    expect((await getProposal(t.db, p?.id ?? '')).status).toBe('rejected');
    expect(b.edits.at(-1)?.text).toContain('✖ cancelled');
  });
});

describe('/pause_all', () => {
  it('one card for every active campaign of a product (dormant too); Cancel rejects them all', async () => {
    const b = bot();
    expect(await b.say('/pause_all spare')).toBe('command:recorded');
    expect(b.last()).toContain('<b>Pause everything in spare?</b> 2 active campaigns');
    const [ok, no] = buttonsOf(b.keyboardOf());
    expect(ok?.text).toBe('✅ Pause all 2');
    expect(await b.press(no?.callback_data ?? '')).toBe('recorded');
    expect(b.answers.at(-1)).toBe('Cancelled 2');
    expect((await listProposals(t.db, spare.id)).map((p) => p.status)).toEqual(['rejected', 'rejected']);
    expect(b.edits.at(-1)?.text).toContain('✖ cancelled');
    expect(b.edits.at(-1)?.other?.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it('Confirm approves each one; a second press finds nothing waiting', async () => {
    const b = bot();
    await b.say('/pause-all spare'); // the hyphen spelling
    const [ok] = buttonsOf(b.keyboardOf());
    expect(await b.press(ok?.callback_data ?? '')).toBe('recorded');
    expect(b.answers.at(-1)).toBe('Confirmed 2');
    expect((await listProposals(t.db, spare.id, ['approved'])).length).toBe(2);
    expect(await b.press(ok?.callback_data ?? '')).toBe('refused');
    expect(b.answers.at(-1)).toBe('Nothing was waiting.');
  });

  it('refuses a product with nothing active, and an unknown one', async () => {
    const b = bot();
    const empty = await createProduct(t.db, {
      slug: 'empty',
      name: 'E',
      packId: 'test-pack',
      status: 'dormant',
      settings: TEST_SETTINGS,
    });
    expect(await b.say(`/pause_all ${empty.slug}`)).toBe('command:refused');
    expect(b.last()).toContain('has no active campaign to pause');
    expect(await b.say('/pause_all nope')).toBe('command:usage');
    expect(b.last()).toContain('No product called “nope”');
  });
});

describe('/halt and /resume_agent', () => {
  it('halt stops the agent, and Marcus can still pause; resume starts it again', async () => {
    const b = bot();
    expect(await b.say('/halt')).toBe('command:usage');
    expect(await b.say('/halt main')).toBe('command:recorded');
    expect(b.last()).toContain('⏸ Halted: main');
    expect((await getProduct(t.db, main.id)).status).toBe('halted');

    // A pause while halted still works.
    const g = entities['summer'];
    await upsertAdEntity(t.db, {
      productId: main.id,
      accountId: g?.accountId ?? '',
      platform: 'google',
      type: 'campaign',
      externalId: '107',
      name: 'Halt-time campaign',
      status: 'active',
      rawStatus: 'X',
    });
    expect(await b.say('/pause halt-time')).toBe('command:recorded');

    expect(await b.say('/halt all')).toBe('command:recorded');
    expect(b.last()).toContain('Nothing to halt');
    expect(await b.say('/resume-agent')).toBe('command:recorded');
    expect(b.last()).toContain('▶️ Resumed: main');
    expect((await getProduct(t.db, main.id)).status).toBe('active');
  });
});

describe('quick settings', () => {
  it('/ceiling sets a ceiling through settings_patch: validated, a new version, kept in the history', async () => {
    const b = bot();
    const before = (await getProduct(t.db, main.id)).settingsVersion;
    expect(await b.say('/ceiling main daily 25')).toBe('command:recorded');
    expect(b.last()).toBe(`main daily ceiling: unset → S$25.00 (settings v${before + 1}).`);
    expect(await b.say('/ceiling daily S$20.50')).toBe('command:recorded'); // the only live product
    const product = await getProduct(t.db, main.id);
    expect(product.settings.spend.dailyCeilingMicros).toBe('20500000');
    expect(b.last()).toContain('S$25.00 → S$20.50');
    const history = await getSettingsHistory(t.db, main.id);
    expect(history.at(-1)).toMatchObject({ version: before + 2 });
    expect(history.at(-1)?.requestId).toEqual(expect.any(String));

    for (const bad of ['/ceiling main weekly 20', '/ceiling main daily 0', '/ceiling main daily lots', '/ceiling']) {
      expect(await b.say(bad)).toBe('command:usage');
    }
    expect((await getProduct(t.db, main.id)).settingsVersion).toBe(before + 2);
  });

  it('/digest sets when the digest comes; anything else is refused', async () => {
    const b = bot();
    expect(await b.say('/digest main always')).toBe('command:recorded');
    expect((await getProduct(t.db, main.id)).settings.notifications.digest).toBe('always');
    expect(b.last()).toContain('daily digest: always (every day)');
    expect(await b.say('/digest main weekly')).toBe('command:usage');
  });

  it('/budget says Phase 3 and records nothing', async () => {
    const b = bot();
    const n = await requestCount();
    expect(await b.say('/budget summer 45')).toBe('command:shown');
    expect(b.last()).toBe('Budget changes are available in Phase 3.');
    expect(await requestCount()).toBe(n);
  });
});

describe('/changes and /undo', () => {
  it('lists approved proposals to make by hand, and shows the undo of one', async () => {
    const b = bot();
    const approved = (await listProposals(t.db, main.id, ['approved']))[0];
    expect(await b.say('/changes main')).toBe('command:shown');
    expect(b.last()).toContain('Approved, for you to make by hand (Phase 1):');
    expect(b.last()).toContain(`<code>${approved?.shortId}</code>: pause campaign`);

    expect(await b.say(`/undo ${approved?.shortId}`)).toBe('command:shown');
    expect(b.last()).toContain('turn campaign “Summer Sale &lt;b&gt;”');
    expect(b.last()).toContain('back on');

    const pending = (await listProposals(t.db, main.id, ['pending']))[0];
    expect(await b.say(`/undo ${pending?.shortId}`)).toBe('command:refused');
    expect(b.last()).toContain('still waiting for a decision');
    expect(await b.say('/undo something')).toBe('command:usage');
  });

  it('/undo <rev> records an undo request and shows the stored undo (Phase 1)', async () => {
    const b = bot();
    const p = (await listProposals(t.db, main.id, ['approved']))[0];
    if (p === undefined || p.action.action !== 'pause_entity') throw new Error('expected an approved pause');
    const rev = await insertChange(t.db, {
      productId: main.id,
      proposalId: p.id,
      action: p.action,
      undo: { action: 'resume_entity', target: p.action.target },
      before: { status: 'active' },
      after: { status: 'paused' },
      approvedBy: `telegram:${OWNER}`,
      verified: true,
    });
    const n = await requestCount();
    expect(await b.say(`/undo ${rev}`)).toBe('command:recorded');
    expect(await requestCount()).toBe(n + 1);
    expect(b.last()).toContain(`To undo <code>${rev}</code>`);
    expect(b.last()).toContain('back on');
    await b.say('/changes main');
    expect(b.last()).toContain(`<code>${rev}</code>`);
    expect(await b.say('/undo rev_00000000000000000000000000')).toBe('command:refused');
  });
});

describe('read-only commands', () => {
  it('/status shows the phase and each product, without recording anything', async () => {
    const b = bot();
    const n = await requestCount();
    expect(await b.say('/status')).toBe('command:shown');
    expect(b.last()).toMatch(/<b>Status<\/b> · phase \d · writes off/);
    expect(b.last()).toContain('<b>main</b>: ▶️ active');
    expect(b.last()).toContain('waiting for you');
    expect(b.last()).toContain('<b>spare</b>: 💤 dormant');
    expect(await requestCount()).toBe(n);
  });

  it('/proposals sends the waiting cards', async () => {
    const b = bot();
    const waiting = await listProposals(t.db, main.id, ['pending']);
    expect(await b.say('/proposals main')).toBe('command:shown');
    expect(b.sent[0]?.text).toBe(`${waiting.length} waiting for you:`);
    expect(b.sent).toHaveLength(waiting.length + 1);
  });

  it('/brief resends the latest brief with its buttons', async () => {
    const b = bot();
    expect(await b.say('/brief main')).toBe('command:shown');
    expect(b.last()).toBe('No brief yet for main.');
    const brief = await insertBrief(t.db, {
      productId: main.id,
      kind: 'weekly',
      numbers: {},
      markdown: '# Week\n**Up** <3',
    });
    await b.say('/brief');
    expect(b.last()).toBe('<b>Week</b>\n<b>Up</b> &lt;3');
    expect(buttonsOf(b.keyboardOf()).map((x) => x.callback_data)).toEqual([
      `v1:useful:${brief.id}:0`,
      `v1:new:${brief.id}:0`,
    ]);
  });

  it('/drift lists unacknowledged drift', async () => {
    const b = bot();
    await b.say('/drift');
    expect(b.last()).toBe('No drift to check.');
    await recordDrift(t.db, {
      productId: main.id,
      adEntityId: entities['winter']?.id ?? '',
      field: 'status',
      expected: 'paused',
      observed: 'active',
    });
    await b.say('/drift main');
    expect(b.last()).toContain('<b>main</b>: 1 change made outside the agent');
    expect(b.last()).toContain('“Winter”');
    expect(b.last()).toContain('status paused → active');
  });
});

describe('messages', () => {
  it('an unknown command gets the help pointer; someone else is ignored; /help lists every command', async () => {
    const b = bot();
    expect(await b.say('/apply everything')).toBe('command:unknown');
    expect(b.last()).toContain("I don't know /apply");
    expect(await b.say('/status', 999)).toBe('ignored');
    await b.say('/help');
    for (const c of COMMANDS) expect(b.last()).toContain(`/${c.name}`);
  });

  it('a command doesn’t end a question the bot asked: its reply still counts afterwards', async () => {
    const b = bot();
    const p = (await listProposals(t.db, main.id, ['pending']))[0];
    await setConversation(t.db, OWNER, {
      awaiting: 'reject_reason',
      proposalId: p?.id,
      shortId: p?.shortId,
      version: 1,
      cardMessageId: null,
    });
    expect(await b.say('/status')).toBe('command:shown');
    expect(await b.say('not wanted after all')).toBe('recorded');
    expect((await getProposal(t.db, p?.id ?? '')).status).toBe('rejected');
  });

  it('with two live products, a command that needs one asks which; it never guesses', async () => {
    const b = bot();
    await setProductStatus(t.db, spare.id, 'active');
    expect(await b.say('/brief')).toBe('command:usage');
    expect(b.last()).toContain('Name the product:');
    expect(await b.say('/ceiling daily 30')).toBe('command:usage');
    await setProductStatus(t.db, spare.id, 'dormant');
  });
});
