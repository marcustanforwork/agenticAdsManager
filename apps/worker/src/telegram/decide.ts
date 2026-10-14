// Deciding proposals from Telegram (BLUEPRINT M09a): the card buttons and the replies they ask for. Approve is one
// press; Reject asks for the reason and Edit for the change, and the bot waits for that reply in a conversation
// state stored in the database (10 minutes, §5.15), so a restart or a leader change doesn't lose it. Every decision
// is an operator request through the one processor (invariant 9), which re-checks the version, the action hash and
// the expiry. After each one the card is re-rendered from the database, so it always shows what is now true.
import type { OperatorRequest } from '@ads/contracts';
import { submitRequest } from '@ads/core';
import { clearConversation, findProposalByShortId, getConversation, setConversation } from '@ads/db';
import { z } from 'zod';
import type { BotContext } from './bot.ts';
import { editHint, loadCard, parseCardData, renderCard } from './cards.ts';
import { EDIT_HELP, parseEdit } from '../editGrammar.ts';
import { escapeHtml } from './format.ts';

/** What the bot is waiting for in a chat. Read back through this schema: a row from an older build that doesn't
 *  match counts as no conversation. */
export const ConversationState = z.object({
  awaiting: z.enum(['reject_reason', 'edit']),
  proposalId: z.uuid(),
  shortId: z.string(),
  version: z.number().int().min(1),
  /** The card's message, re-rendered once the reply is decided. */
  cardMessageId: z.number().int().nullable(),
});
export type ConversationState = z.infer<typeof ConversationState>;

export const MIN_REASON_CHARS = 3; // OperatorRequest `reject.reason`

export interface ChatMessage {
  message_id: number;
  from?: { id: number };
  chat: { id: number; type: string };
  text?: string;
}

export type MessageOutcome = 'ignored' | 'no_conversation' | 'cancelled' | 'retry' | 'recorded' | 'refused';

const reasonOf = (result: Record<string, unknown>): string =>
  typeof result['reason'] === 'string' ? result['reason'] : 'refused';

async function decideRequest(ctx: BotContext, request: OperatorRequest, userId: number) {
  return submitRequest(ctx.db, { request, actor: `telegram:${userId}`, channel: 'telegram' }, ctx.requests);
}

/** Re-renders a card in place from the database. A failure (the message is too old, or unchanged) only logs. */
export async function refreshCard(ctx: BotContext, proposalId: string, messageId: number | null): Promise<void> {
  if (messageId === null) return;
  try {
    const { html, keyboard } = renderCard(await loadCard(ctx.db, proposalId, ctx.now?.() ?? new Date()));
    await ctx.api.editMessageText(ctx.ownerId, messageId, html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard ?? { inline_keyboard: [] },
    });
  } catch (error) {
    ctx.logger?.error({ err: error, proposalId }, 'updating the proposal card failed');
  }
}

/** A press on a card button. Approve submits at once; Reject and Edit ask for a reply. */
export async function handleCardPress(
  ctx: BotContext,
  query: { id: string; from: { id: number }; data?: string; message?: { message_id: number } },
): Promise<'unknown' | 'recorded' | 'refused' | 'asked'> {
  const parsed = parseCardData(query.data ?? '');
  const proposal = parsed === null ? null : await findProposalByShortId(ctx.db, parsed.shortId);
  if (parsed === null || proposal === null) {
    await ctx.api.answerCallbackQuery(query.id, { text: 'That proposal no longer exists.' });
    return 'unknown';
  }
  const messageId = query.message?.message_id ?? null;

  if (parsed.verb === 'approve') {
    const { outcome } = await decideRequest(
      ctx,
      {
        kind: 'approve',
        proposalId: proposal.id,
        version: parsed.version,
        // The hash of the version on the card: a newer version is never approved by a press on an older card.
        actionHash: proposal.version === parsed.version ? proposal.actionHash : '(changed since shown)',
      },
      query.from.id,
    );
    // A question still open about this proposal (Reject or Edit pressed first) is answered by the approval: the
    // next message must not be taken as its reply.
    const now = ctx.now?.() ?? new Date();
    const open = ConversationState.safeParse(await getConversation(ctx.db, ctx.ownerId, now));
    if (open.success && open.data.proposalId === proposal.id) await clearConversation(ctx.db, ctx.ownerId, now);
    await ctx.api.answerCallbackQuery(query.id, {
      text: outcome.status === 'done' ? `Approved v${parsed.version}` : `Not approved: ${reasonOf(outcome.result)}`,
    });
    await refreshCard(ctx, proposal.id, messageId);
    return outcome.status === 'done' ? 'recorded' : 'refused';
  }

  // Reject and Edit ask for a reply first; a card that can't be decided any more is refreshed instead.
  const now = ctx.now?.() ?? new Date();
  if (
    proposal.status !== 'pending' ||
    proposal.version !== parsed.version ||
    proposal.expiresAt.getTime() <= now.getTime()
  ) {
    await ctx.api.answerCallbackQuery(query.id, { text: 'This card is out of date; here is the current one.' });
    await refreshCard(ctx, proposal.id, messageId);
    return 'refused';
  }
  const hint = editHint(proposal.action);
  if (parsed.verb === 'edit' && hint === null) {
    await ctx.api.answerCallbackQuery(query.id, { text: 'This change has nothing to edit: approve or reject it.' });
    return 'refused';
  }
  const state: ConversationState = {
    awaiting: parsed.verb === 'reject' ? 'reject_reason' : 'edit',
    proposalId: proposal.id,
    shortId: proposal.shortId,
    version: proposal.version,
    cardMessageId: messageId,
  };
  await setConversation(ctx.db, ctx.ownerId, state, { now });
  await ctx.api.answerCallbackQuery(query.id);
  const prompt =
    parsed.verb === 'reject'
      ? `Why reject <b>${proposal.shortId}</b> v${proposal.version}? Reply with your reason (it teaches the analyst), or /cancel.`
      : `How should <b>${proposal.shortId}</b> v${proposal.version} change? Reply with: <code>${escapeHtml(hint ?? '')}</code>. The edited change is approved at once. Or /cancel.`;
  await ctx.api.sendMessage(ctx.ownerId, prompt, {
    parse_mode: 'HTML',
    reply_markup: {
      force_reply: true,
      input_field_placeholder: parsed.verb === 'reject' ? 'The reason' : 'e.g. budget 45',
    },
  });
  return 'asked';
}

/** A text message from Marcus: the reply a card asked for, `/cancel`, or anything else (a short help). */
export async function handleMessage(ctx: BotContext, message: ChatMessage): Promise<MessageOutcome> {
  if (message.from?.id !== ctx.ownerId || message.chat.type !== 'private') return 'ignored';
  const text = (message.text ?? '').trim();
  const now = ctx.now?.() ?? new Date();
  const reply = (html: string) => ctx.api.sendMessage(ctx.ownerId, html, { parse_mode: 'HTML' });

  if (/^\/cancel(@\w+)?$/i.test(text)) {
    const had = await clearConversation(ctx.db, ctx.ownerId, now);
    await reply(had ? 'Cancelled. The card is unchanged.' : 'Nothing to cancel.');
    return 'cancelled';
  }
  const stored = ConversationState.safeParse(await getConversation(ctx.db, ctx.ownerId, now));
  if (!stored.success) {
    await reply('Use the buttons on a proposal card to decide it. Commands arrive in a later update.');
    return 'no_conversation';
  }
  const state = stored.data;

  let request: OperatorRequest;
  if (state.awaiting === 'reject_reason') {
    if (text.length < MIN_REASON_CHARS || text.startsWith('/')) {
      await reply(`The reason needs at least ${MIN_REASON_CHARS} characters. Try again, or /cancel.`);
      return 'retry';
    }
    request = { kind: 'reject', proposalId: state.proposalId, version: state.version, reason: text.slice(0, 1000) };
  } else {
    const edit = parseEdit(text);
    if (!edit.ok) {
      await reply(`${escapeHtml(edit.reason)}\nOr /cancel.`);
      return 'retry';
    }
    request = { kind: 'edit_approve', proposalId: state.proposalId, version: state.version, edit: edit.edit };
  }

  const { outcome } = await decideRequest(ctx, request, message.from.id);
  await clearConversation(ctx.db, ctx.ownerId, now);
  const verb = request.kind === 'reject' ? 'Rejected' : 'Edited and approved';
  if (outcome.status === 'done') {
    const version = typeof outcome.result['version'] === 'number' ? outcome.result['version'] : state.version;
    await reply(`${verb}: <b>${state.shortId}</b> v${version}.`);
  } else {
    await reply(
      `Not saved: ${escapeHtml(reasonOf(outcome.result))}${request.kind === 'edit_approve' ? `\nEdits: ${escapeHtml(EDIT_HELP)}` : ''}`,
    );
  }
  await refreshCard(ctx, state.proposalId, state.cardMessageId);
  return outcome.status === 'done' ? 'recorded' : 'refused';
}
