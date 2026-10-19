// Small helpers the Telegram commands share (M09b): replying, submitting an operator request as Marcus, and naming a
// product. Kept apart from commands.ts so the command modules can use them without importing the command table.
import type { OperatorRequest } from '@ads/contracts';
import { type RequestOutcome, submitRequest } from '@ads/core';
import {
  type Db,
  type Product,
  type ProposalRecord,
  findProductBySlug,
  getCurrentApproval,
  listProducts,
} from '@ads/db';
import type { BotContext, InlineKeyboard } from './bot.ts';
import { chunkHtml, escapeHtml, htmlToPlain, isBadRequest } from './format.ts';

/** What a command did, for logs and tests. */
export type CommandOutcome = 'shown' | 'recorded' | 'refused' | 'usage' | 'unknown';

/** The reason recorded when Marcus cancels his own confirm card. */
export const CANCEL_REASON = 'cancelled from Telegram';

export const nowOf = (ctx: BotContext): Date => ctx.now?.() ?? new Date();

/** Sends HTML to Marcus, chunked at 4,000 characters; the buttons go under the last chunk. */
export async function reply(ctx: BotContext, html: string, keyboard?: InlineKeyboard): Promise<void> {
  await sendChunks(ctx, chunkHtml(html), keyboard);
}

/** Sends HTML chunks; one Telegram refuses as malformed (400) is sent again as plain text, as the outbox does. */
export async function sendChunks(ctx: BotContext, chunks: string[], keyboard?: InlineKeyboard): Promise<void> {
  for (const [i, chunk] of chunks.entries()) {
    const markup = i === chunks.length - 1 && keyboard !== undefined ? { reply_markup: keyboard } : {};
    const options = { link_preview_options: { is_disabled: true }, ...markup };
    try {
      await ctx.api.sendMessage(ctx.ownerId, chunk, { parse_mode: 'HTML', ...options });
    } catch (error) {
      if (!isBadRequest(error)) throw error;
      ctx.logger?.error({ err: error }, 'Telegram refused a reply; sending it as plain text');
      await ctx.api.sendMessage(ctx.ownerId, htmlToPlain(chunk), options);
    }
  }
}

/** Whether Marcus approved the proposal's current version. In Phase 1 nothing is applied, so an approved proposal
 *  later expires (BLUEPRINT §3.9; a confirmed pause after 30 minutes): it still counts as one he made by hand. */
export async function approvedByMarcus(db: Db, proposal: ProposalRecord): Promise<boolean> {
  if (proposal.status === 'approved') return true;
  if (proposal.status !== 'expired') return false;
  return (await getCurrentApproval(db, proposal.id))?.decision === 'approve';
}

/** Records and processes a request as Marcus, through the one processor (invariant 9). */
export async function submitAsOwner(
  ctx: BotContext,
  request: OperatorRequest,
): Promise<{ id: string; outcome: RequestOutcome }> {
  return submitRequest(ctx.db, { request, actor: `telegram:${ctx.ownerId}`, channel: 'telegram' }, ctx.requests);
}

export const reasonOf = (outcome: RequestOutcome): string =>
  typeof outcome.result['reason'] === 'string' ? outcome.result['reason'] : 'refused';

/** The products a command acts on when Marcus doesn't name one: those not dormant. */
export async function liveProducts(ctx: BotContext): Promise<Product[]> {
  return (await listProducts(ctx.db)).filter((p) => p.status !== 'dormant');
}

export type ProductPick = { ok: true; product: Product } | { ok: false; html: string };

/** The product a slug names; with no slug, the only product that isn't dormant. Never a guess between several. */
export async function pickProduct(ctx: BotContext, slug: string | undefined): Promise<ProductPick> {
  if (slug !== undefined) {
    const product = await findProductBySlug(ctx.db, slug.toLowerCase());
    if (product !== null) return { ok: true, product };
    const known = (await listProducts(ctx.db)).map((p) => p.slug).join(', ');
    return { ok: false, html: `No product called “${escapeHtml(slug)}”. Products: ${escapeHtml(known)}.` };
  }
  const live = await liveProducts(ctx);
  if (live.length === 1 && live[0] !== undefined) return { ok: true, product: live[0] };
  const known = (await listProducts(ctx.db)).map((p) => p.slug).join(', ');
  return { ok: false, html: `Name the product: ${escapeHtml(known || 'none yet')}.` };
}

/** The first word of the arguments, if it names a product; the rest of the words either way. */
export async function splitProduct(
  ctx: BotContext,
  words: string[],
): Promise<{ slug: string | undefined; rest: string[] }> {
  const [first, ...rest] = words;
  if (first !== undefined && (await findProductBySlug(ctx.db, first.toLowerCase())) !== null) {
    return { slug: first, rest };
  }
  return { slug: undefined, rest: words };
}
