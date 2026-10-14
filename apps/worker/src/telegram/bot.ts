// The worker's Telegram bot (BLUEPRINT §5.15): it sends the notifications outbox (digests, briefs, alerts, proposal
// cards) to Marcus's private chat, and handles the buttons and replies: the brief feedback (👍 useful / 💡 new to me,
// M07) and the proposal cards' Approve / Reject / Edit (M09a, decide.ts). Each is an operator request through the
// one processor. Updates are accepted only from Marcus's user id in a private chat; everything else is ignored.
// Only the leader polls and sends (§5.2).
import { PROPOSAL_NOTIFICATION, type RequestContext, submitRequest } from '@ads/core';
import {
  type Db,
  type Notification,
  getBrief,
  getStoredSettings,
  listUnsentNotifications,
  markBriefSent,
  markNotificationSent,
  setNotificationProgress,
} from '@ads/db';
import { loadCard, parseCardData, renderCard } from './cards.ts';
import { handleCardPress } from './decide.ts';
import { chunkHtml, escapeHtml, markdownLiteToHtml } from './format.ts';

export interface InlineButton {
  text: string;
  callback_data: string;
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}
/** Opens Telegram's reply box, so Marcus's next message answers the bot's question. */
export interface ForceReply {
  force_reply: true;
  input_field_placeholder?: string;
}
export interface SendOptions {
  parse_mode?: 'HTML';
  reply_markup?: InlineKeyboard | ForceReply;
  link_preview_options?: { is_disabled: boolean };
}
export interface EditOptions {
  parse_mode?: 'HTML';
  reply_markup?: InlineKeyboard;
  link_preview_options?: { is_disabled: boolean };
}

/** The part of the Bot API the worker uses (grammY's `bot.api` has it; tests pass a fake). */
export interface TelegramApi {
  sendMessage(chatId: number, text: string, other?: SendOptions): Promise<{ message_id: number }>;
  answerCallbackQuery(callbackQueryId: string, other?: { text?: string }): Promise<unknown>;
  editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    other?: { reply_markup?: InlineKeyboard },
  ): Promise<unknown>;
  editMessageText(chatId: number, messageId: number, text: string, other?: EditOptions): Promise<unknown>;
}

export interface BotLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

// ── Brief feedback buttons ────────────────────────────────────────────────────────────────────

/** Callback data `v1:<verb>:<briefId>:<version>` (§5.15): at most 49 bytes, under Telegram's 64. Stable: old cards
 *  must keep working. Briefs have no versions; it is always 0. */
export const FEEDBACK_VERBS = { useful: 'useful', newInfo: 'new' } as const;

export function feedbackData(verb: 'useful' | 'new', briefId: string): string {
  return `v1:${verb}:${briefId}:0`;
}

export function parseFeedbackData(data: string): { verb: 'useful' | 'new'; briefId: string } | null {
  const m = /^v1:(useful|new):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):0$/.exec(data);
  return m === null ? null : { verb: m[1] as 'useful' | 'new', briefId: m[2] as string };
}

export function feedbackKeyboard(
  briefId: string,
  state: { useful: boolean | null; newInfo: boolean | null } = { useful: null, newInfo: null },
): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: `${state.useful === true ? '✅' : '👍'} useful`, callback_data: feedbackData('useful', briefId) },
        { text: `${state.newInfo === true ? '✅' : '💡'} new to me`, callback_data: feedbackData('new', briefId) },
      ],
    ],
  };
}

export interface CallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number; type: string } };
}

export interface BotContext {
  db: Db;
  api: TelegramApi;
  /** Marcus's numeric Telegram user id (T7). His private chat with the bot has the same id. */
  ownerId: number;
  requests: RequestContext;
  logger?: BotLogger;
  /** Tests: the clock for expiries and conversation states. */
  now?: () => Date;
}

/** Handles a button press: a proposal card's (decide.ts) or a brief's feedback. Returns what happened, for logs and
 *  tests. */
export async function handleCallback(
  ctx: BotContext,
  query: CallbackQuery,
): Promise<'ignored' | 'unknown' | 'recorded' | 'refused' | 'asked'> {
  if (query.from.id !== ctx.ownerId || query.message?.chat.type !== 'private') return 'ignored';
  if (parseCardData(query.data ?? '') !== null) return handleCardPress(ctx, query);
  return handleFeedback(ctx, { ...query, message: query.message });
}

/** A brief's feedback button. Each press toggles that answer; the latest answer wins (`setBriefFeedback`). */
async function handleFeedback(
  ctx: BotContext,
  query: CallbackQuery & { message: NonNullable<CallbackQuery['message']> },
): Promise<'unknown' | 'recorded' | 'refused'> {
  const parsed = parseFeedbackData(query.data ?? '');
  if (parsed === null) {
    await ctx.api.answerCallbackQuery(query.id, { text: 'This button is not available any more.' });
    return 'unknown';
  }
  let brief;
  try {
    brief = await getBrief(ctx.db, parsed.briefId);
  } catch {
    await ctx.api.answerCallbackQuery(query.id, { text: 'That brief no longer exists.' });
    return 'unknown';
  }
  const useful = parsed.verb === 'useful' ? brief.feedbackUseful !== true : brief.feedbackUseful === true;
  const newInfo = parsed.verb === 'new' ? brief.feedbackNewInfo !== true : brief.feedbackNewInfo === true;
  const { outcome } = await submitRequest(
    ctx.db,
    {
      request: { kind: 'brief_feedback', briefId: brief.id, useful, newInfo },
      actor: `telegram:${query.from.id}`,
      channel: 'telegram',
    },
    ctx.requests,
  );
  if (outcome.status !== 'done') {
    await ctx.api.answerCallbackQuery(query.id, {
      text: `Not saved: ${typeof outcome.result['reason'] === 'string' ? outcome.result['reason'] : 'refused'}`,
    });
    return 'refused';
  }
  await ctx.api.answerCallbackQuery(query.id, {
    text: `Saved: useful ${useful ? 'yes' : 'no'}, new to me ${newInfo ? 'yes' : 'no'}`,
  });
  await ctx.api
    .editMessageReplyMarkup(query.message.chat.id, query.message.message_id, {
      reply_markup: feedbackKeyboard(brief.id, { useful, newInfo }),
    })
    .catch((err: unknown) => ctx.logger?.error({ err }, 'updating the feedback buttons failed'));
  return 'recorded';
}

// ── The outbox ────────────────────────────────────────────────────────────────────────────────

export interface RenderedNotification {
  /** HTML chunks, each one message. */
  chunks: string[];
  /** Buttons under the last chunk. */
  keyboard?: InlineKeyboard;
  briefId?: string;
}

/** One line per field of a payload we don't have a layout for: keys and values escaped, values cut short. */
function genericLines(payload: Record<string, unknown>): string[] {
  return Object.entries(payload).map(([k, v]) => {
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    return `${escapeHtml(k)}: ${escapeHtml(text.length > 300 ? `${text.slice(0, 299)}…` : text)}`;
  });
}

export async function renderNotification(db: Db, n: Notification): Promise<RenderedNotification> {
  const payload = (n.payload ?? {}) as Record<string, unknown>;
  if (n.kind === 'digest' && typeof payload['text'] === 'string') {
    return { chunks: chunkHtml(markdownLiteToHtml(payload['text'])) };
  }
  if (n.kind === PROPOSAL_NOTIFICATION && typeof payload['proposalId'] === 'string') {
    const { html, keyboard } = renderCard(await loadCard(db, payload['proposalId']));
    return { chunks: chunkHtml(html), ...(keyboard === null ? {} : { keyboard }) };
  }
  if (n.kind === 'brief' && typeof payload['briefId'] === 'string') {
    const brief = await getBrief(db, payload['briefId']);
    return {
      chunks: chunkHtml(markdownLiteToHtml(brief.markdown)),
      keyboard: feedbackKeyboard(brief.id, { useful: brief.feedbackUseful, newInfo: brief.feedbackNewInfo }),
      briefId: brief.id,
    };
  }
  const product = n.productId === null ? null : await getStoredSettings(db, n.productId);
  const title =
    n.kind === 'alert'
      ? `⚠️ Alert${product === null ? '' : ` (${product.slug})`}: ${typeof payload['alert'] === 'string' ? payload['alert'] : 'unknown'}`
      : n.kind === 'worker_recovered'
        ? 'The worker restarted and recovered its work'
        : `${n.kind}${product === null ? '' : ` (${product.slug})`}`;
  const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => !(n.kind === 'alert' && k === 'alert')));
  return { chunks: chunkHtml([`<b>${escapeHtml(title)}</b>`, ...genericLines(rest)].join('\n')) };
}

/** Telegram refused the message itself (bad markup, too long): retrying the same text won't help. */
const isBadRequest = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'error_code' in error && error.error_code === 400;

export interface OutboxPass {
  sent: number;
  /** A send failed for a reason retrying later may fix (network, rate limit, bot blocked): the pass stopped there,
   *  and the caller should back off before the next one. */
  stalled: boolean;
}

/** Sends what is queued, oldest first; each notification is marked sent once all its messages went out, and the
 *  messages already sent are counted (`sentChunks`), so a retry continues where it stopped. A message Telegram
 *  refuses as malformed (400) is sent again as plain text; if that fails too, it is skipped (logged). A notification
 *  that can't be rendered (its brief is gone) is dropped (logged). Any other send error stops the pass: the rest
 *  wait, and the caller backs off. */
export async function sendOutbox(ctx: BotContext, opts: { limit?: number } = {}): Promise<OutboxPass> {
  let sent = 0;
  for (const n of await listUnsentNotifications(ctx.db, opts.limit ?? 50)) {
    let out: RenderedNotification;
    try {
      out = await renderNotification(ctx.db, n);
    } catch (error) {
      ctx.logger?.error(
        { err: error, notificationId: n.id, kind: n.kind },
        'a notification could not be rendered; dropped',
      );
      await markNotificationSent(ctx.db, n.id);
      continue;
    }
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const done = typeof payload['sentChunks'] === 'number' ? payload['sentChunks'] : 0;
    try {
      for (const [i, chunk] of out.chunks.entries()) {
        if (i < done) continue;
        const last = i === out.chunks.length - 1;
        const options: SendOptions = {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(last && out.keyboard !== undefined ? { reply_markup: out.keyboard } : {}),
        };
        try {
          await ctx.api.sendMessage(ctx.ownerId, chunk, options);
        } catch (error) {
          if (!isBadRequest(error)) throw error;
          ctx.logger?.error(
            { err: error, notificationId: n.id },
            'Telegram refused the message; sending it as plain text',
          );
          const plain = chunk
            .replaceAll(/<\/?b>/g, '')
            .replaceAll('&lt;', '<')
            .replaceAll('&gt;', '>')
            .replaceAll('&amp;', '&');
          const { parse_mode: _html, ...rest } = options;
          await ctx.api.sendMessage(ctx.ownerId, plain, rest).catch((again: unknown) => {
            if (!isBadRequest(again)) throw again;
            ctx.logger?.error({ err: again, notificationId: n.id }, 'Telegram refused the plain text too; skipped');
          });
        }
        if (!last) await setNotificationProgress(ctx.db, n.id, i + 1);
      }
      await markNotificationSent(ctx.db, n.id);
      if (out.briefId !== undefined) await markBriefSent(ctx.db, out.briefId);
      sent += 1;
    } catch (error) {
      ctx.logger?.error({ err: error, notificationId: n.id, kind: n.kind }, 'sending stopped; the rest wait');
      return { sent, stalled: true };
    }
  }
  return { sent, stalled: false };
}
