import { z } from 'zod';
import { IsoDateTime } from './hash.ts';
import { MicrosJson } from './money.ts';
import { EntityRef } from './platform.ts';
import { WriteOp } from './writes.ts';

export const ProposalStatus = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
  'blocked',
  'stale',
  'applying',
  'applied',
  'failed',
  'rolled_back',
  'needs_attention',
  'reverted',
]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const Proposal = z.object({
  id: z.uuid(),
  shortId: z.string().length(8), // for Telegram callback data (max 64 bytes)
  productId: z.uuid(),
  cycleId: z.uuid().nullable(), // null for operator and policy proposals
  findingId: z.uuid().nullable(),
  origin: z.enum(['agent', 'operator', 'policy']), // policy = conversion uploads
  version: z.number().int().min(1),
  action: WriteOp,
  actionHash: z.string(), // sha256Hex(canonicalJson(action))
  undo: WriteOp.nullable(), // null only for irreversible actions
  revertsRevisionId: z.string().nullable(), // set when this proposal IS an undo
  preconditionHash: z.string().nullable(), // null for actions with no entity state (uploads)
  preconditionFields: z.array(z.string()),
  rationale: z.string(),
  expectedEffect: z.string(),
  status: ProposalStatus,
  statusDetail: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime, // adjust_budget 72 h; others 7 d; operator confirm cards 30 min
});
export type Proposal = z.infer<typeof Proposal>;

export const Approval = z
  .object({
    proposalId: z.uuid(),
    proposalVersion: z.number().int(),
    actionHash: z.string(), // the gateway re-checks this against the proposal
    decision: z.enum(['approve', 'reject']),
    reason: z.string().nullable(), // required when rejecting
    actor: z.string(),
    channel: z.enum(['telegram', 'web', 'cli', 'policy']),
    requestId: z.uuid().nullable(),
    decidedAt: IsoDateTime,
  })
  .refine((a) => a.decision !== 'reject' || (a.reason !== null && a.reason.trim() !== ''), {
    path: ['reason'],
    message: 'a rejection needs a reason',
  });
export type Approval = z.infer<typeof Approval>;

export const EditSpec = z.discriminatedUnion('field', [
  z.object({ field: z.literal('budget'), newDailyBudgetMicros: MicrosJson }),
  z.object({ field: z.literal('negative_text'), text: z.string().min(1).max(80) }),
  z.object({ field: z.literal('match_type'), matchType: z.enum(['EXACT', 'PHRASE']) }),
]);
export type EditSpec = z.infer<typeof EditSpec>;

/** Everything a human asks for, from any surface. One processor validates them all (BLUEPRINT §5.4). */
export const OperatorRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve'), proposalId: z.uuid(), version: z.number().int(), actionHash: z.string() }),
  z.object({ kind: z.literal('reject'), proposalId: z.uuid(), version: z.number().int(), reason: z.string().min(3) }),
  z.object({ kind: z.literal('edit_approve'), proposalId: z.uuid(), version: z.number().int(), edit: EditSpec }),
  z.object({ kind: z.literal('pause'), target: EntityRef }),
  z.object({ kind: z.literal('pause_all'), productId: z.uuid() }),
  z.object({ kind: z.literal('undo'), revisionId: z.string() }),
  z.object({ kind: z.literal('budget'), target: EntityRef, newDailyBudgetMicros: MicrosJson }), // Phase 3
  z.object({ kind: z.literal('halt'), productId: z.uuid().nullable() }), // null = all
  z.object({ kind: z.literal('resume_agent'), productId: z.uuid().nullable() }),
  z.object({
    kind: z.literal('settings_patch'),
    productId: z.uuid(),
    baseVersion: z.number().int(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('facts_put'),
    productId: z.uuid(),
    offeringKey: z.string(),
    facts: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('product_doc_put'),
    productId: z.uuid(),
    doc: z.enum(['strategy', 'playbook', 'learnings']),
    baseVersion: z.number().int(),
    markdown: z.string(),
  }),
  z.object({ kind: z.literal('brief_feedback'), briefId: z.uuid(), useful: z.boolean(), newInfo: z.boolean() }),
  z.object({
    kind: z.literal('resolve_attention'),
    proposalId: z.uuid(),
    resolution: z.enum(['applied', 'not_applied']),
    note: z.string().min(3),
  }),
  // M15a adds: source_copy_put
]);
export type OperatorRequest = z.infer<typeof OperatorRequest>;

export type GatewayResult =
  | { status: 'applied'; revisionId: string; before: unknown; after: unknown }
  | { status: 'blocked'; check: string; detail: string } // approval, allowlist or guard refused
  | { status: 'stale'; diff: Record<string, { expected: unknown; observed: unknown }> }
  | { status: 'failed'; errors: string[] } // the platform rejected it; nothing changed
  | { status: 'rolled_back'; revisionId: string; reason: string } // verify failed; automatic undo succeeded
  | { status: 'needs_attention'; detail: string } // verify failed AND the undo failed → product halted
  | { status: 'deferred'; reason: 'halted' | 'writes_disabled' | 'waiting_for_offsets' };

export interface Gateway {
  execute(proposalId: string): Promise<GatewayResult>; // loads the proposal + approval itself; trusts no caller
  reconcileApplying(): Promise<void>; // recovery at startup and on lease expiry
}
