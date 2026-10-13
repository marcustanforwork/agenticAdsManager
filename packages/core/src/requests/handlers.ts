// One handler per operator-request kind. Each runs inside the processor's transaction (a savepoint), and
// throws RefusedError / StaleVersionError / NotFoundError / a settings or facts error to refuse.
// To add a kind: write its handler here, add it to HANDLERS, remove it from NOT_AVAILABLE_UNTIL, and test it
// in test/requests.test.ts (the milestone file's "Leave behind" has the checklist).
import type { OperatorRequest } from '@ads/contracts';
import {
  PHASE,
  RefusedError,
  StaleVersionError,
  getEntity,
  getFinding,
  getPhase,
  getProposal,
  getStoredSettings,
  listAccounts,
  recordDecision,
  recordEvalCase,
  setFlag,
  putOfferingFacts,
  putProductDoc,
  schema,
  setBriefFeedback,
  updateSettings,
  type AdEntity,
  type OperatorRequestRow,
  type ProductStatus,
  type ProposalRecord,
  type Tx,
} from '@ads/db';
import { and, eq } from 'drizzle-orm';
import type { PackRegistry } from '@ads/pack-sdk';
import { findingRefText } from '../analyst/refs.ts';
import { manifestOf, packGuardLayer } from '../settings/settings.ts';
import { validateFacts } from './facts.ts';
import { applySettingsPatch } from './settingsPatch.ts';

const { products } = schema;

type Kind = OperatorRequest['kind'];
type RequestOf<K extends Kind> = Extract<OperatorRequest, { kind: K }>;
export type RequestHandler<R extends OperatorRequest> = (
  tx: Tx,
  request: R,
  row: OperatorRequestRow,
  ctx: HandlerContext,
) => Promise<Record<string, unknown>>;

/** What handlers may use besides the transaction: the installed packs, for validating against their manifests
 *  (BLUEPRINT §5.4: settings and facts are validated only in the processor, with the pack manifests). */
export interface HandlerContext {
  /** Required, so no surface can process a settings change without the packs' guard layer. A product whose pack
   *  isn't installed is checked against the core and platform defaults only. */
  packs: PackRegistry;
}

/** Which milestone adds the kinds this processor doesn't handle yet. */
export const NOT_AVAILABLE_UNTIL: Partial<Record<Kind, string>> = {
  edit_approve: 'M09a',
  pause: 'M09b',
  pause_all: 'M09b',
  undo: 'M09b',
  budget: 'M14',
  resolve_attention: 'M11b',
};

/** Moves products from one status to another: one product, or every product (productId null). Products in
 *  any other status are left alone (a dormant product stays dormant). */
async function moveStatus(tx: Tx, productId: string | null, from: ProductStatus, to: ProductStatus) {
  // Unknown product → refused. Not validated: halting must work even if the stored settings are broken.
  if (productId !== null) await getStoredSettings(tx, productId);
  const changed = await tx
    .update(products)
    .set({ status: to })
    .where(and(eq(products.status, from), productId === null ? undefined : eq(products.id, productId)))
    .returning({ slug: products.slug });
  return changed.map((p) => p.slug).sort();
}

const halt: RequestHandler<RequestOf<'halt'>> = async (tx, request) => {
  // Halt stops the agent only: cycles and agent proposals wait. Marcus's own pauses still run (§6 step 3).
  const halted = await moveStatus(tx, request.productId, 'active', 'halted');
  return { halted };
};

const resumeAgent: RequestHandler<RequestOf<'resume_agent'>> = async (tx, request) => {
  const resumed = await moveStatus(tx, request.productId, 'halted', 'active');
  return { resumed };
};

const settingsPatch: RequestHandler<RequestOf<'settings_patch'>> = async (tx, request, row, ctx) => {
  // The stored document as is: a patch can repair one that fails validation (the result is validated).
  const stored = await getStoredSettings(tx, request.productId);
  // Checked here as well as in updateSettings, so a stale base is refused before the patch is judged.
  if (stored.version !== request.baseVersion) {
    throw new StaleVersionError('settings', request.baseVersion, stored.version);
  }
  const settings = applySettingsPatch(
    stored.settings,
    request.patch,
    packGuardLayer(manifestOf(ctx.packs, stored.packId)),
  );
  const version = await updateSettings(tx, {
    productId: request.productId,
    baseVersion: request.baseVersion,
    settings,
    requestId: row.id,
  });
  return { version };
};

/** facts_put (M05b): the offering's facts, replaced whole after the pack's fact schema accepts them. A product
 *  whose pack isn't installed can't have its facts checked, so they're refused. */
const factsPut: RequestHandler<RequestOf<'facts_put'>> = async (tx, request, _row, ctx) => {
  const stored = await getStoredSettings(tx, request.productId);
  const manifest = manifestOf(ctx.packs, stored.packId);
  if (manifest === null) {
    throw new RefusedError(`the ${stored.packId} pack is not installed, so its facts can't be checked`);
  }
  const facts = validateFacts(manifest, request.facts);
  const factsVersion = await putOfferingFacts(tx, { productId: request.productId, key: request.offeringKey, facts });
  return { offering: request.offeringKey, factsVersion };
};

/** The longest product document accepted. The analyst reads every document in full as trusted context (M06b),
 *  so they're kept short: about 5,000 tokens each. */
export const PRODUCT_DOC_MAX_CHARS = 20_000;

/** product_doc_put (M05b): a new version of STRATEGY, PLAYBOOK or LEARNINGS on top of `baseVersion` (0 for the
 *  first); a stale base is refused. */
const productDocPut: RequestHandler<RequestOf<'product_doc_put'>> = async (tx, request, row) => {
  await getStoredSettings(tx, request.productId); // an unknown product is refused, not a fault
  if (request.markdown.length > PRODUCT_DOC_MAX_CHARS) {
    throw new RefusedError(
      `the ${request.doc} document has ${request.markdown.length} characters; at most ${PRODUCT_DOC_MAX_CHARS}`,
    );
  }
  const version = await putProductDoc(tx, {
    productId: request.productId,
    doc: request.doc,
    baseVersion: request.baseVersion,
    markdown: request.markdown,
    requestId: row.id,
  });
  return { doc: request.doc, version };
};

const briefFeedback: RequestHandler<RequestOf<'brief_feedback'>> = async (tx, request) => {
  await setBriefFeedback(tx, request);
  return { briefId: request.briefId, useful: request.useful, newInfo: request.newInfo };
};

/** set_phase (D-082): the system's phase, raised by Marcus when he records a gate as passed. The note is kept
 *  with the request. */
const setPhase: RequestHandler<RequestOf<'set_phase'>> = async (tx, request, row) => {
  const previous = await getPhase(tx);
  await setFlag(tx, PHASE, request.phase, row.id);
  return { phase: request.phase, previous };
};

/** Every decision on an agent proposal becomes eval data (M08): the finding it came from, as a ref. */
async function recordCase(tx: Tx, proposal: ProposalRecord, decision: 'approve' | 'reject', reason: string | null) {
  if (proposal.origin !== 'agent' || proposal.cycleId === null || proposal.findingId === null) return false;
  const finding = await getFinding(tx, proposal.findingId);
  const entities = new Map<string, AdEntity>();
  if (finding.targetEntityId !== null)
    entities.set(finding.targetEntityId, await getEntity(tx, finding.targetEntityId));
  const accounts = new Map((await listAccounts(tx, proposal.productId)).map((a) => [a.id, a] as const));
  return recordEvalCase(tx, {
    productId: proposal.productId,
    cycleId: proposal.cycleId,
    findingId: finding.id,
    proposalId: proposal.id,
    decision,
    reason,
    findingType: finding.type,
    target: findingRefText(finding, entities, accounts),
  });
}

/** approve / reject (M08 through the CLI; M09a adds the Telegram cards): bound to the version and, for an
 *  approval, the action hash Marcus saw. A repeated identical decision is harmless. Phase 1 applies nothing:
 *  Marcus makes an approved change by hand. */
async function decide(
  tx: Tx,
  row: OperatorRequestRow,
  input: { proposalId: string; version: number; actionHash?: string; decision: 'approve' | 'reject'; reason?: string },
) {
  const proposal = await getProposal(tx, input.proposalId);
  const { approval, duplicate } = await recordDecision(tx, {
    proposalId: proposal.id,
    version: input.version,
    // A rejection doesn't need the hash: the version alone pins what was rejected.
    actionHash: input.actionHash ?? proposal.actionHash,
    decision: input.decision,
    reason: input.reason ?? null,
    actor: row.actor,
    channel: row.channel,
    requestId: row.id,
  });
  const evalCase = duplicate ? false : await recordCase(tx, proposal, input.decision, approval.reason);
  return {
    proposal: proposal.shortId,
    version: approval.proposalVersion,
    decision: approval.decision,
    duplicate,
    evalCase,
  };
}

const approve: RequestHandler<RequestOf<'approve'>> = (tx, request, row) =>
  decide(tx, row, { ...request, decision: 'approve' });

const reject: RequestHandler<RequestOf<'reject'>> = (tx, request, row) =>
  decide(tx, row, { ...request, decision: 'reject' });

export const HANDLERS: { [K in Kind]?: RequestHandler<RequestOf<K>> } = {
  set_phase: setPhase,
  approve,
  reject,
  halt,
  resume_agent: resumeAgent,
  settings_patch: settingsPatch,
  facts_put: factsPut,
  product_doc_put: productDocPut,
  brief_feedback: briefFeedback,
};
