// Marcus's own actions (PROPOSAL §5.4, BLUEPRINT M09b): `pause`, `pause_all` and `undo` requests. A pause becomes an
// operator proposal with the same parts as a drafted one (action, planned undo, fingerprint), built by the same
// helpers, and a 30-minute expiry (§3.8): the confirm tap on its card is the approval. Phase 1 applies nothing, so
// Marcus makes a confirmed pause by hand; from M11b the gateway applies it at once. Nothing here checks the
// product's status: a halted (or dormant) product still accepts pauses, since halting is when you want them.
import { type EntityType, type OperatorRequest, hashOf, plannedUndo } from '@ads/contracts';
import {
  type AdEntity,
  type OperatorRequestRow,
  type ProposalRecord,
  type Tx,
  RefusedError,
  createProposal,
  findAccount,
  findEntityByRef,
  findOpenProposalByAction,
  getChange,
  getStoredSettings,
  listAccounts,
  listEntities,
  transitionProposal,
} from '@ads/db';
import { entityRefOf } from '../analyst/refs.ts';
import { preconditionOf } from '../draft/actions.ts';
import type { RequestHandler } from './handlers.ts';

type RequestOf<K extends OperatorRequest['kind']> = Extract<OperatorRequest, { kind: K }>;

/** How long a confirm card stays open (BLUEPRINT §3.8). */
export const OPERATOR_CONFIRM_MS = 30 * 60_000;

/** The levels Marcus can pause: a pause on a campaign, an ad group or Meta ad set, or an ad stops its spend. */
export const PAUSABLE_TYPES: readonly EntityType[] = ['campaign', 'ad_group', 'ad'];

/** What a pause request returns about its proposal; the bot shows the card from it, and `pause_all`'s confirm
 *  approves each one with exactly this version and hash. */
export interface OperatorProposalRef {
  proposalId: string;
  shortId: string;
  version: number;
  actionHash: string;
  /** False when an open proposal for the same pause already existed: it is returned instead of a second one. */
  created: boolean;
}

const refOf = (p: ProposalRecord, created: boolean): OperatorProposalRef => ({
  proposalId: p.id,
  shortId: p.shortId,
  version: p.version,
  actionHash: p.actionHash,
  created,
});

/** The pause proposal for one synced, active entity: an open one with the same action if there is one (any origin:
 *  a drafted pause Marcus asks for again is that card), else a new operator proposal. */
async function pauseProposal(
  tx: Tx,
  entity: AdEntity,
  accountExternalId: string,
  row: OperatorRequestRow,
): Promise<OperatorProposalRef> {
  const action = { action: 'pause_entity' as const, target: entityRefOf(entity, { externalId: accountExternalId }) };
  const now = new Date();
  const open = await findOpenProposalByAction(tx, { productId: entity.productId, actionHash: hashOf(action) });
  if (open !== null) {
    const waiting = open.status === 'pending' || open.status === 'approved';
    if (!waiting || open.expiresAt.getTime() > now.getTime()) return refOf(open, false);
    // Past its expiry but not yet swept (`expireDue`): it can't be confirmed any more, so a fresh one replaces it.
    await transitionProposal(tx, { proposalId: open.id, to: 'expired', from: open.status });
  }
  const precondition = preconditionOf(action, entity);
  const proposal = await createProposal(tx, {
    productId: entity.productId,
    origin: 'operator',
    action,
    undo: plannedUndo(action),
    preconditionHash: precondition.hash,
    preconditionFields: precondition.fields,
    rationale: `Your own request, from ${row.channel}.`,
    expectedEffect: 'Its spending stops until it is turned back on.',
    expiresAt: new Date(now.getTime() + OPERATOR_CONFIRM_MS),
    requestId: row.id,
  });
  return refOf(proposal, true);
}

/** Refuses an entity a pause can't act on. */
function assertPausable(entity: AdEntity): void {
  const words = entity.type.replaceAll('_', ' ');
  if (!PAUSABLE_TYPES.includes(entity.type)) throw new RefusedError(`a ${words} can't be paused from here`);
  if (entity.status !== 'active') throw new RefusedError(`the ${words} is ${entity.status}, not active`);
}

/** pause: one entity, named by its platform ref. It must be synced (the fingerprint is taken from its synced state)
 *  and active. */
export const pause: RequestHandler<RequestOf<'pause'>> = async (tx, request, row) => {
  const account = await findAccount(tx, request.target.platform, request.target.accountId);
  if (account === null)
    throw new RefusedError(`unknown ${request.target.platform} account ${request.target.accountId}`);
  const entity = await findEntityByRef(tx, account.productId, request.target);
  if (entity === null) {
    throw new RefusedError(`no synced ${request.target.type.replaceAll('_', ' ')} ${request.target.externalId}`);
  }
  assertPausable(entity);
  return { ...(await pauseProposal(tx, entity, account.externalId, row)) };
};

/** pause_all: every active campaign of the product, one pause proposal each (pausing a campaign stops everything
 *  under it). The bot confirms them together. */
export const pauseAll: RequestHandler<RequestOf<'pause_all'>> = async (tx, request, row) => {
  const { slug } = await getStoredSettings(tx, request.productId); // an unknown product is refused
  const accounts = new Map((await listAccounts(tx, request.productId)).map((a) => [a.id, a.externalId] as const));
  const campaigns = (await listEntities(tx, request.productId, { type: 'campaign' })).filter(
    (e) => e.status === 'active',
  );
  if (campaigns.length === 0) throw new RefusedError(`${slug} has no active campaign to pause`);
  const proposals: OperatorProposalRef[] = [];
  for (const campaign of campaigns) {
    proposals.push(await pauseProposal(tx, campaign, accounts.get(campaign.accountId) ?? '', row));
  }
  return { product: slug, proposals };
};

/** undo, Phase 1 behaviour: the change's stored undo, for Marcus to make by hand. It must have one and not have been
 *  undone already. From M11b this creates the undo proposal instead (`createUndoProposal`, db). */
export const undo: RequestHandler<RequestOf<'undo'>> = async (tx, request) => {
  const change = await getChange(tx, request.revisionId); // NotFoundError → refused
  if (change.undo === null) {
    throw new RefusedError(`${change.revisionId} (${change.action.action}) cannot be undone`);
  }
  if (change.revertedByRevisionId !== null) {
    throw new RefusedError(`${change.revisionId} was already undone by ${change.revertedByRevisionId}`);
  }
  return { revisionId: change.revisionId, productId: change.productId, action: change.action, undo: change.undo };
};
