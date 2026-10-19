// `/pause` and `/pause_all` (BLUEPRINT M09b): Marcus's own pauses, as operator proposals through the one processor.
// The bot sends a confirm card, and the confirm tap is the approval (an ordinary `approve` request bound to the
// version and action hash on the card). Phase 1 applies nothing: Marcus pauses it by hand once confirmed; from M11b
// the gateway applies it at once. Entities are found by a fragment of their name or by their id; when more than one
// matches, the bot lists them as buttons. It never guesses.
import { countOf } from '@ads/contracts';
import { OPERATOR_CONFIRM_MS, type OperatorProposalRef, PAUSABLE_TYPES, entityRefOf, entityRefText } from '@ads/core';
import {
  type AdEntity,
  type Db,
  type Product,
  findEntityByRef,
  getEntity,
  getOperatorRequest,
  getProduct,
  getProposal,
  listAccounts,
  listEntities,
  listProducts,
  NotFoundError,
} from '@ads/db';
import type { BotContext, CallbackQuery, InlineButton, InlineKeyboard } from './bot.ts';
import { entityLine, loadCard, renderCard } from './cards.ts';
import { clip, escapeHtml } from './format.ts';
import {
  CANCEL_REASON,
  type CommandOutcome,
  approvedByMarcus,
  nowOf,
  pickProduct,
  reasonOf,
  reply,
  submitAsOwner,
} from './reply.ts';

// ── Callback data ─────────────────────────────────────────────────────────────────────────────

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The pause buttons' verbs. Stable once sent: `pick` pauses one of several matches (the entity's row id);
 *  `allok` / `allno` confirm or cancel a `/pause_all` (the request's id). At most 51 bytes. */
export type PauseVerb = 'pick' | 'allok' | 'allno';

export const pauseData = (verb: PauseVerb, id: string): string => `v1:${verb}:${id}:0`;

export function parsePauseData(data: string): { verb: PauseVerb; id: string } | null {
  const m = new RegExp(`^v1:(pick|allok|allno):(${UUID}):0$`).exec(data);
  return m === null ? null : { verb: m[1] as PauseVerb, id: m[2] as string };
}

// ── Finding the entity ────────────────────────────────────────────────────────────────────────

export interface EntityMatch {
  entity: AdEntity;
  product: Pick<Product, 'id' | 'slug'>;
  accountExternalId: string;
}

/** The most matches the bot lists as buttons. */
export const MAX_MATCHES = 8;

const normalise = (text: string): string => text.trim().replaceAll(/\s+/g, ' ').toLowerCase();

/** The pausable entities a query names, split into the active ones and the rest. A query is a ref
 *  (`google:123:campaign:456`), an external id, or a fragment of the name (at least 2 characters, any case). An exact
 *  ref or id wins over a name. Removed entities are left out. */
export async function findEntities(db: Db, query: string): Promise<{ active: EntityMatch[]; inactive: EntityMatch[] }> {
  const q = normalise(query.replace(/^["“”'](.*)["“”']$/s, '$1'));
  const all: EntityMatch[] = [];
  for (const product of await listProducts(db)) {
    const accounts = new Map((await listAccounts(db, product.id)).map((a) => [a.id, a] as const));
    for (const entity of await listEntities(db, product.id, { types: PAUSABLE_TYPES })) {
      if (entity.status === 'removed') continue;
      all.push({ entity, product, accountExternalId: accounts.get(entity.accountId)?.externalId ?? '?' });
    }
  }
  const refOf = (m: EntityMatch) => entityRefText(entityRefOf(m.entity, { externalId: m.accountExternalId }));
  const byRef = all.filter((m) => refOf(m).toLowerCase() === q);
  const byId = all.filter((m) => m.entity.externalId.toLowerCase() === q);
  const byName = q.length < 2 ? [] : all.filter((m) => normalise(m.entity.name).includes(q));
  const found = byRef.length > 0 ? byRef : byId.length > 0 ? byId : byName;
  return {
    active: found.filter((m) => m.entity.status === 'active'),
    inactive: found.filter((m) => m.entity.status !== 'active'),
  };
}

/** `campaign “Summer” (main)`, for a button (plain text: Telegram doesn't parse button labels). */
const buttonLabel = (m: EntityMatch): string =>
  `${m.entity.type.replaceAll('_', ' ')} “${clip(m.entity.name.replaceAll(/\s+/g, ' '), 40)}” (${m.product.slug})`;

const entityHtml = (m: EntityMatch): string =>
  entityLine(m.entity.name, entityRefOf(m.entity, { externalId: m.accountExternalId }));

// ── /pause ────────────────────────────────────────────────────────────────────────────────────

/** Sends a proposal's card, with its buttons while it can still be decided. */
export async function sendCard(ctx: BotContext, proposalId: string): Promise<void> {
  const { html, keyboard } = renderCard(await loadCard(ctx.db, proposalId, nowOf(ctx)));
  await reply(ctx, html, keyboard ?? undefined);
}

/** Asks the processor for the pause and sends its confirm card. */
async function requestPause(ctx: BotContext, match: EntityMatch): Promise<CommandOutcome> {
  const target = entityRefOf(match.entity, { externalId: match.accountExternalId });
  const { outcome } = await submitAsOwner(ctx, { kind: 'pause', target });
  if (outcome.status !== 'done') {
    await reply(ctx, `Not paused: ${escapeHtml(reasonOf(outcome))}`);
    return 'refused';
  }
  const ref = outcome.result as unknown as OperatorProposalRef;
  if (!ref.created) await reply(ctx, 'A pause of this is already open; here is its card.');
  await sendCard(ctx, ref.proposalId);
  return 'recorded';
}

/** `/pause <name or id>`. */
export async function pauseCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  if (args.trim() === '') {
    await reply(ctx, 'Usage: <code>/pause &lt;part of the name, or the id&gt;</code>');
    return 'usage';
  }
  const { active, inactive } = await findEntities(ctx.db, args);
  const [only] = active;
  if (active.length === 1 && only !== undefined) return requestPause(ctx, only);
  if (active.length > 1) {
    const shown = active.slice(0, MAX_MATCHES);
    const buttons: InlineButton[][] = shown.map((m) => [
      { text: buttonLabel(m), callback_data: pauseData('pick', m.entity.id) },
    ]);
    const more =
      active.length > shown.length
        ? ` Showing ${shown.length} of ${active.length}: type more of the name to narrow it.`
        : '';
    await reply(ctx, `${active.length} active things match “${escapeHtml(args.trim())}”. Which one?${more}`, {
      inline_keyboard: buttons,
    });
    return 'shown';
  }
  if (inactive.length > 0) {
    const lines = inactive
      .slice(0, MAX_MATCHES)
      .map((m) => `• ${entityHtml(m)}: ${escapeHtml(m.entity.status)}`)
      .join('\n');
    await reply(ctx, `Nothing active matches “${escapeHtml(args.trim())}”; these match but aren't active:\n${lines}`);
    return 'refused';
  }
  await reply(
    ctx,
    `Nothing matches “${escapeHtml(args.trim())}”. Use part of the name, or the id the ads manager shows. ` +
      'Only campaigns, ad sets / ad groups and ads can be paused here.',
  );
  return 'refused';
}

// ── /pause_all ────────────────────────────────────────────────────────────────────────────────

interface GroupLine {
  html: string;
  status: string;
  open: boolean;
}

const GROUP_STATUS: Record<string, string> = {
  pending: '⏳',
  approved: '✅ confirmed',
  rejected: '✖ cancelled',
  expired: '⌛ expired',
};

/** The `/pause_all` card, from the database: one line per campaign with its proposal's status, and the buttons while
 *  any is still waiting. */
export async function renderPauseAll(
  db: Db,
  requestId: string,
  now: Date,
): Promise<{ html: string; keyboard: InlineKeyboard | null }> {
  const request = await getOperatorRequest(db, requestId);
  const result = (request.result ?? {}) as { proposals?: OperatorProposalRef[] };
  const refs = request.kind === 'pause_all' && request.status === 'done' ? (result.proposals ?? []) : [];
  const product = request.productId === null ? null : await getProduct(db, request.productId);
  const lines: GroupLine[] = [];
  for (const ref of refs) {
    const p = await getProposal(db, ref.proposalId);
    const open = p.status === 'pending' && p.expiresAt.getTime() > now.getTime();
    const status = open
      ? GROUP_STATUS['pending']
      : (await approvedByMarcus(db, p))
        ? GROUP_STATUS['approved'] // still "confirmed" once its 30 minutes are over (Phase 1 applies nothing)
        : p.status === 'pending'
          ? GROUP_STATUS['expired']
          : GROUP_STATUS[p.status];
    let html = `<code>${p.shortId}</code>`;
    if (p.action.action === 'pause_entity') {
      const entity = await findEntityByRef(db, p.productId, p.action.target);
      html = entityLine(entity?.name ?? null, p.action.target, 60);
    }
    lines.push({ html, status: status ?? p.status.replaceAll('_', ' '), open });
  }
  const anyOpen = lines.some((l) => l.open);
  const slug = escapeHtml(product?.slug ?? '?');
  const html = [
    `<b>Pause everything in ${slug}?</b> ${countOf(lines.length, 'active campaign')}:`,
    ...lines.map((l) => `• ${l.html} · ${escapeHtml(l.status)}`),
    '',
    anyOpen
      ? `Confirm within ${OPERATOR_CONFIRM_MS / 60_000} minutes. Phase 1 applies nothing: once confirmed, pause them by hand in the ads managers.`
      : 'Phase 1 applies nothing: pause the confirmed ones by hand in the ads managers.',
  ].join('\n');
  const keyboard: InlineKeyboard | null = anyOpen
    ? {
        inline_keyboard: [
          [
            {
              text: `✅ Pause all ${lines.filter((l) => l.open).length}`,
              callback_data: pauseData('allok', requestId),
            },
            { text: '✖ Cancel', callback_data: pauseData('allno', requestId) },
          ],
        ],
      }
    : null;
  return { html, keyboard };
}

/** `/pause_all <product>`: a pause proposal for every active campaign, confirmed together on one card. */
export async function pauseAllCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  // The product must be named: this pauses everything, so it is never taken as the default.
  const words = args.trim().split(/\s+/).filter(Boolean);
  if (words.length !== 1) {
    await reply(ctx, 'Usage: <code>/pause_all &lt;product&gt;</code>');
    return 'usage';
  }
  const pick = await pickProduct(ctx, words[0]);
  if (!pick.ok) {
    await reply(ctx, pick.html);
    return 'usage';
  }
  const { id, outcome } = await submitAsOwner(ctx, { kind: 'pause_all', productId: pick.product.id });
  if (outcome.status !== 'done') {
    await reply(ctx, `Not paused: ${escapeHtml(reasonOf(outcome))}`);
    return 'refused';
  }
  const { html, keyboard } = await renderPauseAll(ctx.db, id, nowOf(ctx));
  await reply(ctx, html, keyboard ?? undefined);
  return 'recorded';
}

// ── Button presses ────────────────────────────────────────────────────────────────────────────

/** Confirms or cancels every proposal of a `/pause_all` that is still waiting, each as its own request. A pause the
 *  agent drafted (returned instead of a second proposal) is confirmed with the rest, but Cancel leaves it pending: a
 *  cancel is not a rejection of the agent's proposal, which would count against its agree rate. */
async function decideGroup(
  ctx: BotContext,
  requestId: string,
  confirm: boolean,
): Promise<{ done: number; refused: number }> {
  const request = await getOperatorRequest(ctx.db, requestId);
  const refs =
    request.kind === 'pause_all' && request.status === 'done'
      ? (((request.result ?? {}) as { proposals?: OperatorProposalRef[] }).proposals ?? [])
      : [];
  let done = 0;
  let refused = 0;
  for (const ref of refs) {
    const p = await getProposal(ctx.db, ref.proposalId);
    if (p.status !== 'pending' || (!confirm && p.origin !== 'operator')) continue;
    const { outcome } = await submitAsOwner(
      ctx,
      confirm
        ? { kind: 'approve', proposalId: ref.proposalId, version: ref.version, actionHash: ref.actionHash }
        : { kind: 'reject', proposalId: ref.proposalId, version: ref.version, reason: CANCEL_REASON },
    );
    if (outcome.status === 'done') done += 1;
    else refused += 1;
  }
  return { done, refused };
}

/** A press on a pause button: a pick among matches, or a `/pause_all` confirm or cancel. */
export async function handlePausePress(
  ctx: BotContext,
  query: CallbackQuery,
): Promise<'unknown' | 'recorded' | 'refused'> {
  const parsed = parsePauseData(query.data ?? '');
  if (parsed === null) return 'unknown';
  if (parsed.verb === 'pick') {
    let match: EntityMatch;
    try {
      const entity = await getEntity(ctx.db, parsed.id);
      const account = (await listAccounts(ctx.db, entity.productId)).find((a) => a.id === entity.accountId);
      const product = await getProduct(ctx.db, entity.productId);
      match = { entity, product, accountExternalId: account?.externalId ?? '?' };
    } catch {
      await ctx.api.answerCallbackQuery(query.id, { text: 'That no longer exists.' });
      return 'unknown';
    }
    await ctx.api.answerCallbackQuery(query.id);
    return (await requestPause(ctx, match)) === 'recorded' ? 'recorded' : 'refused';
  }
  let counts;
  try {
    counts = await decideGroup(ctx, parsed.id, parsed.verb === 'allok');
  } catch (error) {
    if (error instanceof NotFoundError) {
      await ctx.api.answerCallbackQuery(query.id, { text: 'That request no longer exists.' });
      return 'unknown';
    }
    // Some may be decided already (each is its own request): say so, and show the card as it now is.
    ctx.logger?.error({ err: error, requestId: parsed.id }, 'deciding a pause-all failed part-way');
    await ctx.api.answerCallbackQuery(query.id, {
      text: 'Something failed part-way: the card shows what was decided.',
    });
    await refreshGroup(ctx, parsed.id, query.message?.message_id);
    return 'refused';
  }
  const verb = parsed.verb === 'allok' ? 'Confirmed' : 'Cancelled';
  await ctx.api.answerCallbackQuery(query.id, {
    text:
      counts.done === 0 && counts.refused === 0
        ? 'Nothing was waiting.'
        : `${verb} ${counts.done}${counts.refused > 0 ? `; ${counts.refused} refused (expired or changed)` : ''}`,
  });
  await refreshGroup(ctx, parsed.id, query.message?.message_id);
  return counts.done > 0 ? 'recorded' : 'refused';
}

/** Re-renders a `/pause_all` card in place. A failure only logs. */
async function refreshGroup(ctx: BotContext, requestId: string, messageId: number | undefined): Promise<void> {
  if (messageId === undefined) return;
  try {
    const { html, keyboard } = await renderPauseAll(ctx.db, requestId, nowOf(ctx));
    await ctx.api.editMessageText(ctx.ownerId, messageId, html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard ?? { inline_keyboard: [] },
    });
  } catch (error) {
    ctx.logger?.error({ err: error, requestId }, 'updating the pause-all card failed');
  }
}
