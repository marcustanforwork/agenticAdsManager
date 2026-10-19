// Proposal cards (BLUEPRINT M09a, §5.15): one Telegram message per proposal, with the evidence summary, the change
// as before → after, the expected effect, the expiry and, while it is pending, the Approve / Reject / Edit buttons.
// The buttons carry `v1:<verb>:<shortId>:<version>`: a press decides exactly the version shown, and the processor
// refuses it if the proposal changed, was decided or expired since (PROPOSAL §6.3). Every figure on a card comes
// from the database; the words (rationale, expected effect) are the drafter's, already number-checked (M08).
// Platform text (entity names, a negative keyword) is escaped: it is shown, never interpreted.
import {
  type ComputedEvidence,
  ComputedEvidence as EvidenceSchema,
  type EntityRef,
  type WriteOp,
  targetRefOf,
} from '@ads/contracts';
import { countOf, entityRefText, formatMoney } from '@ads/core';
import {
  type AdEntity,
  type Db,
  type ProposalRecord,
  findEntityByRef,
  getFinding,
  getProduct,
  getProposal,
} from '@ads/db';
import { clip, escapeHtml } from './format.ts';
import type { InlineKeyboard } from './bot.ts';

// ── Callback data ─────────────────────────────────────────────────────────────────────────────

/** The card verbs. Stable: they are in the callback data of cards already sent. */
export const CARD_VERBS = ['approve', 'reject', 'edit'] as const;
export type CardVerb = (typeof CARD_VERBS)[number];

/** Short ids use this alphabet (db `newShortId`): 8 characters, no look-alikes. */
const SHORT_ID = /^[a-km-np-z2-9]{8}$/;
/** Versions on a card: at most 6 digits, so the data stays well under 64 bytes. */
const MAX_VERSION = 999_999;

export function cardData(verb: CardVerb, shortId: string, version: number): string {
  if (!SHORT_ID.test(shortId)) throw new RangeError(`not a proposal short id: ${shortId}`);
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION)
    throw new RangeError(`bad version ${version}`);
  return `v1:${verb}:${shortId}:${version}`;
}

export function parseCardData(data: string): { verb: CardVerb; shortId: string; version: number } | null {
  const m = /^v1:(approve|reject|edit):([a-km-np-z2-9]{8}):([1-9]\d{0,5})$/.exec(data);
  if (m === null) return null;
  return { verb: m[1] as CardVerb, shortId: m[2] as string, version: Number(m[3]) };
}

/** Approve / Reject, and Edit when the action has something to edit (not a pause). Marcus's own requests (M09b) get
 *  Confirm / Cancel on the same verbs: confirming is the approval, and cancelling asks no reason. */
export function cardKeyboard(p: Pick<ProposalRecord, 'shortId' | 'version' | 'action' | 'origin'>): InlineKeyboard {
  const own = p.origin === 'operator';
  return {
    inline_keyboard: [
      [
        { text: own ? '✅ Confirm' : '✅ Approve', callback_data: cardData('approve', p.shortId, p.version) },
        { text: own ? '✖ Cancel' : '❌ Reject', callback_data: cardData('reject', p.shortId, p.version) },
        ...(own || editHint(p.action) === null
          ? []
          : [{ text: '✏️ Edit', callback_data: cardData('edit', p.shortId, p.version) }]),
      ],
    ],
  };
}

/** What Edit accepts for each action (the grammar is in edit.ts). */
export function editHint(action: WriteOp): string | null {
  switch (action.action) {
    case 'adjust_budget':
      return 'budget 45  (the new daily budget)';
    case 'add_negative_keyword':
      return 'keyword "free photos"  or  match exact / match phrase';
    default:
      return null;
  }
}

// ── The card ──────────────────────────────────────────────────────────────────────────────────

export interface CardView {
  proposal: ProposalRecord;
  product: { slug: string; currency: string; timezone: string };
  /** The finding it came from (agent proposals). */
  finding: { type: string; evidence: ComputedEvidence | null } | null;
  /** The target as last synced, if known. */
  entity: Pick<AdEntity, 'name' | 'status' | 'type'> | null;
  /** For the expiry: a pending proposal past it shows as expired, without buttons. */
  now: Date;
}

const STATUS_WORDS: Partial<Record<ProposalRecord['status'], string>> = {
  pending: '⏳ waiting for you',
  approved: '✅ approved. Phase 1 applies nothing: make the change by hand in the ads manager',
  rejected: '❌ rejected',
  expired: '⌛ expired',
};

/** An entity on one line: `campaign “name” <code>google:1:campaign:2</code>`. The name is the platform's (escaped,
 *  spaces collapsed, clipped); null when it isn't synced. Every Telegram message shows entities this way. */
export function entityLine(name: string | null, ref: EntityRef, max = 80): string {
  const shown = name === null ? '' : ` “${escapeHtml(clip(name.replaceAll(/\s+/g, ' '), max))}”`;
  return `${escapeHtml(ref.type.replaceAll('_', ' '))}${shown} <code>${escapeHtml(entityRefText(ref))}</code>`;
}

const targetLine = (view: CardView, ref: EntityRef): string => entityLine(view.entity?.name ?? null, ref);

/** The change in words: the headline and the before → after line. */
function changeLines(view: CardView): string[] {
  const { action, undo } = view.proposal;
  const money = (micros: string) => escapeHtml(formatMoney(BigInt(micros), view.product.currency));
  switch (action.action) {
    case 'pause_entity':
      return [
        `<b>Pause</b> ${targetLine(view, action.target)}`,
        `Before → after: status ${escapeHtml(view.entity?.status ?? 'active')} → paused`,
      ];
    case 'add_negative_keyword':
      return [
        `<b>Add a negative keyword</b> to ${targetLine(view, action.target)}`,
        `Before → after: + “${escapeHtml(action.text)}” (${action.matchType.toLowerCase()} match) blocked`,
      ];
    case 'adjust_budget': {
      const before = undo?.action === 'adjust_budget' ? money(undo.newDailyBudgetMicros) : '?';
      return [
        `<b>${action.netIncrease ? 'Raise' : 'Cut'} the daily budget</b> of ${targetLine(view, action.target)}`,
        `Before → after: ${before} → ${money(action.newDailyBudgetMicros)} a day`,
      ];
    }
    default:
      return [`<b>${escapeHtml(action.action.replaceAll('_', ' '))}</b>`];
  }
}

function evidenceLine(view: CardView): string | null {
  const e = view.finding?.evidence;
  if (e === null || e === undefined) return null;
  const outcomes = Object.entries(e.outcomesByStage)
    .map(([stage, n]) => countOf(n, stage))
    .join(', ');
  const parts = [
    `spend ${formatMoney(BigInt(e.spendMicros), view.product.currency)}`,
    countOf(e.clicks, 'click'),
    countOf(e.impressions, 'impression'),
    ...(outcomes === '' ? [] : [outcomes]),
  ];
  return `Evidence (${e.from} to ${e.to}, ${countOf(e.windowDays, 'day')}): ${escapeHtml(parts.join(' · '))}`;
}

/** `2026-10-21 10:00` in the product's timezone. */
export function localTime(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** The card's text (HTML, well under one message) and, while it can still be decided, its buttons. */
export function renderCard(view: CardView): { html: string; keyboard: InlineKeyboard | null } {
  const p = view.proposal;
  const pending = p.status === 'pending' && p.expiresAt.getTime() > view.now.getTime();
  const own = p.origin === 'operator';
  const status = pending
    ? own
      ? '⏳ waiting for your confirmation'
      : STATUS_WORDS.pending
    : p.status === 'pending'
      ? STATUS_WORDS.expired
      : own && p.status === 'rejected'
        ? '✖ cancelled'
        : (STATUS_WORDS[p.status] ?? p.status.replaceAll('_', ' '));
  const lines = [
    `<b>Proposal ${p.shortId}</b> · v${p.version} · ${escapeHtml(view.product.slug)}${
      view.finding === null ? '' : ` · ${escapeHtml(view.finding.type)}`
    }`,
    ...changeLines(view),
    evidenceLine(view),
    '',
    `<b>Why:</b> ${escapeHtml(clip(p.rationale, 700))}`,
    `<b>Expected:</b> ${escapeHtml(clip(p.expectedEffect, 500))}`,
    '',
    `Expires ${localTime(p.expiresAt, view.product.timezone)} (${escapeHtml(view.product.timezone)})`,
    `Status: ${escapeHtml(status ?? '')}`,
    own && pending ? 'Confirming is your approval. Phase 1 applies nothing: once confirmed, make it by hand.' : null,
  ].filter((l): l is string => l !== null);
  return { html: lines.join('\n'), keyboard: pending ? cardKeyboard(p) : null };
}

/** Everything a card shows, from the database. */
export async function loadCard(db: Db, proposalId: string, now: Date = new Date()): Promise<CardView> {
  const proposal = await getProposal(db, proposalId);
  const product = await getProduct(db, proposal.productId);
  const finding = proposal.findingId === null ? null : await getFinding(db, proposal.findingId);
  const evidence = finding === null ? null : EvidenceSchema.safeParse(finding.evidence);
  const ref = targetRefOf(proposal.action);
  const entity = ref === null ? null : await findEntityByRef(db, proposal.productId, ref);
  return {
    proposal,
    product: { slug: product.slug, currency: product.currency, timezone: product.timezone },
    finding:
      finding === null ? null : { type: finding.type, evidence: evidence?.success === true ? evidence.data : null },
    entity,
    now,
  };
}
