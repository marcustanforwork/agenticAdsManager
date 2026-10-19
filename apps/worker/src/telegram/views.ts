// The read-only commands (BLUEPRINT M09b): `/status`, `/proposals`, `/brief`, `/drift` and `/changes`, and `/undo`,
// which in Phase 1 only shows the undo for Marcus to make by hand. Every figure comes from the database; platform text
// (names, keywords) is escaped. Nothing here changes anything except `/undo <rev>`, which records an `undo` request.
import { type WriteOp, SET_AT_APPLY } from '@ads/contracts';
import { entityRefText, formatMoney } from '@ads/core';
import {
  type Db,
  type Product,
  findEntityByRef,
  findProposalByShortId,
  getEntity,
  getPhase,
  getProduct,
  listAccounts,
  listBriefs,
  listChanges,
  listCycles,
  listProducts,
  listProposals,
  listUnacknowledgedDrift,
  writesEnabled,
} from '@ads/db';
import type { BotContext } from './bot.ts';
import { localTime } from './cards.ts';
import { briefMessage } from './feedback.ts';
import { escapeHtml } from './format.ts';
import { sendCard } from './pause.ts';
import { type CommandOutcome, liveProducts, nowOf, pickProduct, reasonOf, reply, submitAsOwner } from './reply.ts';

/** The most proposal cards `/proposals` sends at once. */
export const MAX_CARDS = 10;
/** The most lines `/drift` and `/changes` list per product. */
export const MAX_LINES = 15;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The products a read-only command covers: the one named, or every product that isn't dormant. */
async function productsFor(ctx: BotContext, args: string): Promise<Product[] | null> {
  const slug = args.trim().split(/\s+/).filter(Boolean)[0];
  if (slug === undefined) return liveProducts(ctx);
  const pick = await pickProduct(ctx, slug);
  if (pick.ok) return [pick.product];
  await reply(ctx, pick.html);
  return null;
}

/** An entity, as `campaign “name” <code>ref</code>` (the name as last synced, if known). */
async function targetHtml(db: Db, productId: string, ref: Parameters<typeof entityRefText>[0]): Promise<string> {
  const entity = await findEntityByRef(db, productId, ref);
  const name = entity === null ? '' : ` “${escapeHtml(clip(entity.name.replaceAll(/\s+/g, ' '), 60))}”`;
  return `${escapeHtml(ref.type.replaceAll('_', ' '))}${name} <code>${escapeHtml(entityRefText(ref))}</code>`;
}

/** A write action in words (HTML). */
export async function changeHtml(db: Db, product: Pick<Product, 'id' | 'currency'>, action: WriteOp): Promise<string> {
  const target = (ref: Parameters<typeof entityRefText>[0]) => targetHtml(db, product.id, ref);
  switch (action.action) {
    case 'pause_entity':
      return `pause ${await target(action.target)}`;
    case 'resume_entity':
      return `turn ${await target(action.target)} back on`;
    case 'add_negative_keyword':
      return `add the negative keyword “${escapeHtml(action.text)}” (${action.matchType.toLowerCase()} match) to ${await target(action.target)}`;
    case 'remove_negative_keyword':
      return action.criterionId === SET_AT_APPLY
        ? `remove the negative keyword that change added from ${await target(action.target)}`
        : `remove the negative keyword <code>${escapeHtml(action.criterionId)}</code> from ${await target(action.target)}`;
    case 'adjust_budget':
      return `set the daily budget of ${await target(action.target)} to ${escapeHtml(
        formatMoney(BigInt(action.newDailyBudgetMicros), product.currency),
      )}`;
    case 'create_entity_paused':
      return `create a paused ${escapeHtml(action.type.replaceAll('_', ' '))} under ${await target(action.parent)}`;
    case 'mark_abandoned':
      return `mark ${await target(action.target)} as abandoned`;
    case 'upload_conversions':
      return `upload ${action.events.length} conversions to ${escapeHtml(action.platform)}`;
  }
}

// ── /status ───────────────────────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  active: '▶️ active',
  halted: '⏸ halted (the agent is stopped; /resume_agent)',
  dormant: '💤 dormant',
};

export async function statusCommand(ctx: BotContext): Promise<CommandOutcome> {
  const now = nowOf(ctx);
  const lines = [
    `<b>Status</b> · phase ${await getPhase(ctx.db)} · writes ${(await writesEnabled(ctx.db)) ? 'on' : 'off'}`,
  ];
  const all = await listProducts(ctx.db);
  // Live products first, then the dormant ones.
  for (const product of [...all.filter((p) => p.status !== 'dormant'), ...all.filter((p) => p.status === 'dormant')]) {
    const head = `• <b>${escapeHtml(product.slug)}</b>: ${STATUS_ICON[product.status] ?? escapeHtml(product.status)}`;
    if (product.status === 'dormant') {
      lines.push(head);
      continue;
    }
    const [cycle] = await listCycles(ctx.db, product.id, 1);
    const waiting = (await listProposals(ctx.db, product.id, ['pending'])).filter(
      (p) => p.expiresAt.getTime() > now.getTime(),
    ).length;
    const approved = (await listProposals(ctx.db, product.id, ['approved'])).length;
    const drift = (await listUnacknowledgedDrift(ctx.db, product.id)).length;
    const [brief] = await listBriefs(ctx.db, product.id, 1);
    const cycleText =
      cycle === undefined
        ? 'no cycle yet'
        : `last cycle: ${cycle.kind} ${cycle.cycleDate}, ${
            cycle.error !== null ? 'failed' : cycle.finishedAt === null ? `running (${cycle.stageReached})` : 'done'
          }${cycle.trustResult === null ? '' : `, trust ${cycle.trustResult}`}`;
    lines.push(
      head,
      `   ${escapeHtml(cycleText)}`,
      `   ${waiting} waiting for you · ${approved} approved (make by hand) · ${drift} drift to check`,
      `   last brief: ${brief === undefined ? 'none yet' : localTime(brief.createdAt, product.timezone)}`,
    );
  }
  await reply(ctx, lines.join('\n'));
  return 'shown';
}

// ── /proposals ────────────────────────────────────────────────────────────────────────────────

/** The proposals waiting for Marcus, as their cards (newest first). */
export async function proposalsCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const products = await productsFor(ctx, args);
  if (products === null) return 'usage';
  const now = nowOf(ctx);
  const waiting = [];
  for (const product of products) {
    waiting.push(
      ...(await listProposals(ctx.db, product.id, ['pending'])).filter((p) => p.expiresAt.getTime() > now.getTime()),
    );
  }
  if (waiting.length === 0) {
    await reply(ctx, 'Nothing is waiting for you.');
    return 'shown';
  }
  const shown = waiting.slice(0, MAX_CARDS);
  await reply(
    ctx,
    `${waiting.length} waiting for you${
      waiting.length > shown.length
        ? `; here are the newest ${shown.length} (<code>ads proposals list</code> shows all)`
        : ''
    }:`,
  );
  for (const p of shown) await sendCard(ctx, p.id);
  return 'shown';
}

// ── /brief ────────────────────────────────────────────────────────────────────────────────────

/** The product's latest brief again, with its feedback buttons. */
export async function briefCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const pick = await pickProduct(ctx, args.trim().split(/\s+/).filter(Boolean)[0]);
  if (!pick.ok) {
    await reply(ctx, pick.html);
    return 'usage';
  }
  const [brief] = await listBriefs(ctx.db, pick.product.id, 1);
  if (brief === undefined) {
    await reply(ctx, `No brief yet for ${escapeHtml(pick.product.slug)}.`);
    return 'shown';
  }
  const message = briefMessage(brief);
  for (const [i, chunk] of message.chunks.entries()) {
    const last = i === message.chunks.length - 1;
    await ctx.api.sendMessage(ctx.ownerId, chunk, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(last && message.keyboard !== undefined ? { reply_markup: message.keyboard } : {}),
    });
  }
  return 'shown';
}

// ── /drift ────────────────────────────────────────────────────────────────────────────────────

/** A drift value: stored as `{ value }` (`recordDrift`), shown short. */
const valueText = (stored: unknown): string => {
  const v = stored !== null && typeof stored === 'object' && 'value' in stored ? stored.value : stored;
  return clip(typeof v === 'string' ? v : (JSON.stringify(v) ?? 'null'), 40);
};

/** Changes made outside this system that nobody has looked at yet (BLUEPRINT §5.7). */
export async function driftCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const products = await productsFor(ctx, args);
  if (products === null) return 'usage';
  const lines: string[] = [];
  for (const product of products) {
    const events = await listUnacknowledgedDrift(ctx.db, product.id);
    if (events.length === 0) continue;
    const accounts = new Map((await listAccounts(ctx.db, product.id)).map((a) => [a.id, a.externalId] as const));
    lines.push(
      `<b>${escapeHtml(product.slug)}</b>: ${events.length} change${events.length === 1 ? '' : 's'} made outside the agent`,
    );
    for (const e of events.slice(0, MAX_LINES)) {
      const entity = await getEntity(ctx.db, e.adEntityId);
      const ref = {
        platform: entity.platform,
        accountId: accounts.get(entity.accountId) ?? '?',
        type: entity.type,
        externalId: entity.externalId,
      };
      lines.push(
        `• ${await targetHtml(ctx.db, product.id, ref)}: ${escapeHtml(e.field)} ${escapeHtml(valueText(e.expected))} → ${escapeHtml(
          valueText(e.observed),
        )} (${localTime(e.detectedAt, product.timezone)})`,
      );
    }
    if (events.length > MAX_LINES) lines.push(`…and ${events.length - MAX_LINES} more.`);
  }
  await reply(ctx, lines.length === 0 ? 'No drift to check.' : lines.join('\n'));
  return 'shown';
}

// ── /changes and /undo ────────────────────────────────────────────────────────────────────────

/** Recent changes: the change log's revisions (the gateway's, from M11b) and, in Phase 1, the approved proposals
 *  Marcus made by hand. */
export async function changesCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const products = await productsFor(ctx, args);
  if (products === null) return 'usage';
  const lines: string[] = [];
  for (const product of products) {
    const revisions = await listChanges(ctx.db, product.id, MAX_LINES);
    const approved = (await listProposals(ctx.db, product.id, ['approved'])).slice(0, MAX_LINES);
    lines.push(`<b>${escapeHtml(product.slug)}</b>`);
    if (revisions.length === 0 && approved.length === 0) {
      lines.push('Nothing changed yet.');
      continue;
    }
    for (const c of revisions) {
      lines.push(
        `• <code>${escapeHtml(c.revisionId)}</code> ${localTime(c.appliedAt, product.timezone)}: ${await changeHtml(
          ctx.db,
          product,
          c.action,
        )}${c.revertedByRevisionId === null ? '' : ` (undone by <code>${escapeHtml(c.revertedByRevisionId)}</code>)`}`,
      );
    }
    if (approved.length > 0) lines.push('Approved, for you to make by hand (Phase 1):');
    for (const p of approved) {
      lines.push(`• <code>${p.shortId}</code>: ${await changeHtml(ctx.db, product, p.action)}`);
    }
  }
  lines.push('', 'To see how to undo one: <code>/undo &lt;rev or id&gt;</code>');
  await reply(ctx, lines.join('\n'));
  return 'shown';
}

const REVISION = /^rev_[0-9A-HJKMNP-TV-Z]{26}$/;
const SHORT_ID = /^[a-km-np-z2-9]{8}$/;

/** `/undo <rev>` records an `undo` request; in Phase 1 the processor returns the stored undo, which Marcus makes by
 *  hand (from M11b it becomes an undo proposal to confirm). `/undo <proposal id>` shows the planned undo of a change
 *  he approved and made by hand (Phase 1 has no revisions). */
export async function undoCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const id = args.trim();
  if (REVISION.test(id)) {
    const { outcome } = await submitAsOwner(ctx, { kind: 'undo', revisionId: id });
    if (outcome.status !== 'done') {
      await reply(ctx, `Can't undo: ${escapeHtml(reasonOf(outcome))}`);
      return 'refused';
    }
    const result = outcome.result as { productId: string; action: WriteOp; undo: WriteOp };
    const product = await getProduct(ctx.db, result.productId);
    await reply(
      ctx,
      `To undo <code>${escapeHtml(id)}</code> (${await changeHtml(ctx.db, product, result.action)}):\n` +
        `${await changeHtml(ctx.db, product, result.undo)}.\nPhase 1 applies nothing: make it by hand in the ads manager.`,
    );
    return 'recorded';
  }
  if (SHORT_ID.test(id)) {
    const proposal = await findProposalByShortId(ctx.db, id);
    if (proposal === null) {
      await reply(ctx, `No proposal <code>${escapeHtml(id)}</code>.`);
      return 'refused';
    }
    const product = await getProduct(ctx.db, proposal.productId);
    if (proposal.status !== 'approved') {
      const why =
        proposal.status === 'pending'
          ? 'it is still waiting for a decision: cancel or reject it on its card instead'
          : `it is ${proposal.status.replaceAll('_', ' ')}, so there is nothing of it to undo`;
      await reply(ctx, `<code>${id}</code>: ${escapeHtml(why)}.`);
      return 'refused';
    }
    if (proposal.undo === null) {
      await reply(ctx, `<code>${id}</code> (${await changeHtml(ctx.db, product, proposal.action)}) can't be undone.`);
      return 'refused';
    }
    await reply(
      ctx,
      `To undo <code>${id}</code> (${await changeHtml(ctx.db, product, proposal.action)}):\n${await changeHtml(
        ctx.db,
        product,
        proposal.undo,
      )}.\nMake it by hand in the ads manager, if you made the change.`,
    );
    return 'shown';
  }
  await reply(
    ctx,
    'Usage: <code>/undo &lt;rev_…&gt;</code> (a revision) or <code>/undo &lt;proposal id&gt;</code>. /changes lists them.',
  );
  return 'usage';
}
