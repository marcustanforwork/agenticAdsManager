// Marcus's Telegram commands (BLUEPRINT M09b). One table holds the grammar: each command's name, the other spellings
// it accepts, its arguments and help, and its handler. Every command that changes something records an operator
// request through the one processor (invariant 9); nothing here calls a platform. Telegram's command menu allows only
// lowercase letters, digits and underscores, so `/pause_all` and `/resume_agent` are the menu's names; the plan's
// `/pause-all` and `/resume-agent` are accepted too. To add a command: the `add-telegram-command` skill.
import { decimalToMicros, formatMoney, microsToJson } from '@ads/contracts';
import { getStoredSettings } from '@ads/db';
import type { BotContext } from './bot.ts';
import { escapeHtml } from './format.ts';
import { pauseAllCommand, pauseCommand } from './pause.ts';
import { type CommandOutcome, pickProduct, reasonOf, reply, splitProduct, submitAsOwner } from './reply.ts';
import { briefCommand, changesCommand, driftCommand, proposalsCommand, statusCommand, undoCommand } from './views.ts';

export interface CommandSpec {
  /** The name in the menu: lowercase letters, digits and underscores (Telegram's rule for `setMyCommands`). */
  name: string;
  /** Other spellings accepted when typed. */
  aliases?: readonly string[];
  /** The arguments, for the help (`<product>` etc.). */
  usage: string;
  /** One line for the menu and the help: at most 256 characters. */
  help: string;
  run(ctx: BotContext, args: string): Promise<CommandOutcome>;
}

const words = (args: string): string[] => args.trim().split(/\s+/).filter(Boolean);

// ── Halt and resume ───────────────────────────────────────────────────────────────────────────

/** `/halt <product|all>` stops the agent: no cycles run and its proposals wait. Marcus's own pauses still work. */
async function haltCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const [target, ...extra] = words(args);
  if (target === undefined || extra.length > 0) {
    await reply(ctx, 'Usage: <code>/halt &lt;product&gt;</code> or <code>/halt all</code>');
    return 'usage';
  }
  let productId: string | null = null;
  if (target.toLowerCase() !== 'all') {
    const pick = await pickProduct(ctx, target);
    if (!pick.ok) {
      await reply(ctx, pick.html);
      return 'usage';
    }
    productId = pick.product.id;
  }
  const { outcome } = await submitAsOwner(ctx, { kind: 'halt', productId });
  if (outcome.status !== 'done') {
    await reply(ctx, `Not halted: ${escapeHtml(reasonOf(outcome))}`);
    return 'refused';
  }
  const halted = (outcome.result['halted'] as string[] | undefined) ?? [];
  await reply(
    ctx,
    halted.length === 0
      ? 'Nothing to halt: already halted, or dormant.'
      : `⏸ Halted: ${escapeHtml(halted.join(', '))}. The agent stops (no cycles; its proposals wait). ` +
          'Your own /pause still works. /resume_agent starts it again.',
  );
  return 'recorded';
}

/** `/resume_agent [product|all]`: halted products become active again (all of them when none is named). */
async function resumeCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const [target, ...extra] = words(args);
  if (extra.length > 0) {
    await reply(
      ctx,
      'Usage: <code>/resume_agent</code>, <code>/resume_agent &lt;product&gt;</code> or <code>all</code>',
    );
    return 'usage';
  }
  let productId: string | null = null;
  if (target !== undefined && target.toLowerCase() !== 'all') {
    const pick = await pickProduct(ctx, target);
    if (!pick.ok) {
      await reply(ctx, pick.html);
      return 'usage';
    }
    productId = pick.product.id;
  }
  const { outcome } = await submitAsOwner(ctx, { kind: 'resume_agent', productId });
  if (outcome.status !== 'done') {
    await reply(ctx, `Not resumed: ${escapeHtml(reasonOf(outcome))}`);
    return 'refused';
  }
  const resumed = (outcome.result['resumed'] as string[] | undefined) ?? [];
  await reply(
    ctx,
    resumed.length === 0
      ? 'Nothing was halted.'
      : `▶️ Resumed: ${escapeHtml(resumed.join(', '))}. The next scheduled cycle runs as normal.`,
  );
  return 'recorded';
}

// ── Quick settings ────────────────────────────────────────────────────────────────────────────

/** Largest ceiling the bot accepts, in currency units: a typo guard. */
const MAX_CEILING_UNITS = 10_000_000;

/** A money amount as typed: `25`, `25.50`, `S$1,000`. Null if it isn't one. */
export function parseAmount(text: string): bigint | null {
  const amount = text.replace(/^S?\$/i, '').replaceAll(',', '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(amount)) return null;
  const micros = decimalToMicros(amount);
  return micros > 0n && micros <= BigInt(MAX_CEILING_UNITS) * 1_000_000n ? micros : null;
}

/** A settings patch on the current version, through `settings_patch` (validated and kept in the history there). */
async function patchSettings(
  ctx: BotContext,
  productId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; version: number } | { ok: false; reason: string }> {
  const stored = await getStoredSettings(ctx.db, productId);
  const { outcome } = await submitAsOwner(ctx, {
    kind: 'settings_patch',
    productId,
    baseVersion: stored.version,
    patch,
  });
  return outcome.status === 'done'
    ? { ok: true, version: outcome.result['version'] as number }
    : { ok: false, reason: reasonOf(outcome) };
}

const CEILING_USAGE =
  'Usage: <code>/ceiling [product] daily|monthly &lt;amount&gt;</code>, e.g. <code>/ceiling &lt;product&gt; daily 20</code>';

/** `/ceiling [product] daily|monthly <amount>`: the product's spend ceiling, in its currency. */
async function ceilingCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const { slug, rest } = await splitProduct(ctx, words(args));
  const [period, amountText, ...extra] = rest;
  const which = period?.toLowerCase();
  const micros = amountText === undefined ? null : parseAmount(amountText);
  if ((which !== 'daily' && which !== 'monthly') || micros === null || extra.length > 0) {
    await reply(ctx, CEILING_USAGE);
    return 'usage';
  }
  const pick = await pickProduct(ctx, slug);
  if (!pick.ok) {
    await reply(ctx, pick.html);
    return 'usage';
  }
  const product = pick.product;
  const key = which === 'daily' ? 'dailyCeilingMicros' : 'monthlyCeilingMicros';
  // Read loosely: a patch may be what repairs stored settings that fail validation.
  const stored = (await getStoredSettings(ctx.db, product.id)).settings as { spend?: Record<string, unknown> };
  const previous = stored.spend?.[key];
  const before = typeof previous === 'string' ? previous : null;
  const result = await patchSettings(ctx, product.id, { spend: { [key]: microsToJson(micros) } });
  if (!result.ok) {
    await reply(ctx, `Not changed: ${escapeHtml(result.reason)}`);
    return 'refused';
  }
  const money = (m: string | null) => (m === null ? 'unset' : formatMoney(BigInt(m), product.currency));
  await reply(
    ctx,
    `${escapeHtml(product.slug)} ${which} ceiling: ${escapeHtml(money(before))} → ${escapeHtml(
      money(microsToJson(micros)),
    )} (settings v${result.version}).`,
  );
  return 'recorded';
}

const DIGEST_MODES = ['auto', 'always', 'off'] as const;
const DIGEST_WORDS: Record<(typeof DIGEST_MODES)[number], string> = {
  auto: 'only on days it spends',
  always: 'every day',
  off: 'never',
};

/** `/digest [product] auto|always|off`: when the daily digest is sent. */
async function digestCommand(ctx: BotContext, args: string): Promise<CommandOutcome> {
  const { slug, rest } = await splitProduct(ctx, words(args));
  const [modeText, ...extra] = rest;
  const mode = DIGEST_MODES.find((m) => m === modeText?.toLowerCase());
  if (mode === undefined || extra.length > 0) {
    await reply(ctx, 'Usage: <code>/digest [product] auto|always|off</code>');
    return 'usage';
  }
  const pick = await pickProduct(ctx, slug);
  if (!pick.ok) {
    await reply(ctx, pick.html);
    return 'usage';
  }
  const result = await patchSettings(ctx, pick.product.id, { notifications: { digest: mode } });
  if (!result.ok) {
    await reply(ctx, `Not changed: ${escapeHtml(result.reason)}`);
    return 'refused';
  }
  await reply(
    ctx,
    `${escapeHtml(pick.product.slug)} daily digest: ${mode} (${DIGEST_WORDS[mode]}), settings v${result.version}.`,
  );
  return 'recorded';
}

// ── The table ─────────────────────────────────────────────────────────────────────────────────

/** `/budget`: budget changes start in Phase 3 (M14). Nothing is recorded. */
async function budgetCommand(ctx: BotContext): Promise<CommandOutcome> {
  await reply(ctx, 'Budget changes are available in Phase 3.');
  return 'shown';
}

async function helpCommand(ctx: BotContext): Promise<CommandOutcome> {
  const lines = COMMANDS.map(
    (c) => `/${c.name}${c.usage === '' ? '' : ` ${escapeHtml(c.usage)}`}: ${escapeHtml(c.help)}`,
  );
  await reply(
    ctx,
    [
      '<b>Commands</b>',
      ...lines,
      '',
      'Proposal cards have their own buttons. /cancel ends a question the bot asked.',
    ].join('\n'),
  );
  return 'shown';
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: 'status', usage: '', help: 'Phase, products, last cycle, what is waiting', run: statusCommand },
  {
    name: 'proposals',
    usage: '[product]',
    help: 'The proposals waiting for you, as cards',
    run: proposalsCommand,
  },
  { name: 'brief', usage: '[product]', help: 'The latest weekly brief again', run: briefCommand },
  { name: 'drift', usage: '[product]', help: 'Changes made outside the agent', run: driftCommand },
  { name: 'pause', usage: '<name or id>', help: 'Pause a campaign, ad set / ad group or ad', run: pauseCommand },
  {
    name: 'pause_all',
    aliases: ['pause-all', 'pauseall'],
    usage: '<product>',
    help: 'Pause every active campaign of a product',
    run: pauseAllCommand,
  },
  {
    name: 'changes',
    usage: '[product]',
    help: 'Recent changes, and the approved ones to make by hand',
    run: changesCommand,
  },
  { name: 'undo', usage: '<rev or id>', help: 'How to undo a change', run: undoCommand },
  { name: 'halt', usage: '<product|all>', help: 'Stop the agent (not the ads); pauses still work', run: haltCommand },
  {
    name: 'resume_agent',
    aliases: ['resume-agent', 'resume'],
    usage: '[product|all]',
    help: 'Start the halted agent again',
    run: resumeCommand,
  },
  {
    name: 'ceiling',
    usage: '[product] daily|monthly <amount>',
    help: 'Set a spend ceiling',
    run: ceilingCommand,
  },
  { name: 'digest', usage: '[product] auto|always|off', help: 'When the daily digest comes', run: digestCommand },
  { name: 'budget', usage: '', help: 'Budget changes (Phase 3)', run: budgetCommand },
  { name: 'help', aliases: ['start'], usage: '', help: 'This list', run: helpCommand },
];

/** `/name@bot args` → the command's name (lowercase, hyphens as typed) and its arguments. Null if not a command. */
export function parseCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-z][a-z0-9_-]{0,31})(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m === null ? null : { name: (m[1] ?? '').toLowerCase(), args: (m[2] ?? '').trim() };
}

export function findCommand(name: string): CommandSpec | null {
  return COMMANDS.find((c) => c.name === name || (c.aliases ?? []).includes(name)) ?? null;
}

/** Runs a command message. Null when the text isn't a command at all; `unknown` for a command the bot lacks. */
export async function handleCommand(ctx: BotContext, text: string): Promise<CommandOutcome | null> {
  const parsed = parseCommand(text);
  if (parsed === null) return null;
  const command = findCommand(parsed.name);
  if (command === null) {
    await reply(ctx, `I don't know /${escapeHtml(parsed.name)}. /help lists the commands.`);
    return 'unknown';
  }
  try {
    return await command.run(ctx, parsed.args);
  } catch (error) {
    // A fault, not a refusal (those are answered by the command): Marcus still gets an answer.
    ctx.logger?.error({ err: error, command: command.name }, 'a command failed');
    await reply(
      ctx,
      `/${command.name} failed on our side; the worker log has the error. /status shows what is in place.`,
    );
    return 'refused';
  }
}

/** The menu Telegram shows under "/" (`setMyCommands`). */
export const MENU = COMMANDS.map((c) => ({
  command: c.name,
  description: c.usage === '' ? c.help : `${c.usage}: ${c.help}`,
}));
