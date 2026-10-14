// The draft stage (BLUEPRINT §5.11, M08): each confirmed finding that passed its threshold, whose type the registry
// proposes in the current phase, becomes a pending proposal with its exact action, action hash, planned undo,
// fingerprint, expiry and short id. The AI writes only the words. At phase 0 (D-082) the stage drafts nothing and
// writes nothing, so a cycle behaves as before M08. Idempotent: a finding that already has a proposal is skipped,
// and a change already open for the product is not proposed twice.
import { ComputedEvidence, type FindingTypeId, type WriteOp, hashOf, plannedUndo } from '@ads/contracts';
import {
  type AdEntity,
  type DbOrTx,
  type Finding,
  type Product,
  createProposal,
  enqueueNotification,
  defaultExpiry,
  expireDue,
  findOpenProposalByAction,
  findProposalForFinding,
  getEntity,
  getPhase,
  listAccounts,
  listFindings,
  sumSearchTerms,
} from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { findingRefText } from '../analyst/refs.ts';
import { FINDING_TYPES } from '../findings/registry.ts';
import { type ModelDeps, generateStructured } from '../model/generate.ts';
import type { ModelTracing } from '../model/tracing.ts';
import { effectiveGuards, manifestOf } from '../settings/settings.ts';
import { actionForFinding, preconditionOf } from './actions.ts';
import {
  DRAFTER_INSTRUCTIONS,
  type DraftWords,
  DrafterOutput,
  type WordsContext,
  checkedWords,
  drafterData,
  drafterPrompt,
  templateWords,
} from './rationale.ts';

/** The outbox kind of a proposal card (the worker's bot renders it with buttons, M09a). */
export const PROPOSAL_NOTIFICATION = 'proposal';

export interface DraftDeps {
  db: DbOrTx;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  packs?: PackRegistry;
  tracing?: ModelTracing | null;
  model?: ModelDeps['model'];
}

export interface DraftedProposal {
  proposalId: string;
  shortId: string;
  findingId: string;
  type: string;
  action: WriteOp['action'];
  /** A ref, platform ids only. */
  target: string;
  /** Who wrote the words: the AI (checked), or the template. `existing` = drafted by an earlier run. */
  writer: 'ai' | 'template' | 'existing';
}

export interface DraftSummary {
  status: 'drafted' | 'skipped';
  phase: number;
  detail?: string;
  drafted: DraftedProposal[];
  /** Confirmed findings that made no proposal, and why. Types that are never proposed are left out. */
  notDrafted: { findingId: string; type: string; target: string; reason: string }[];
  words?: { model?: string; costMicros?: string; error?: string };
}

/** Findings the analyst confirmed or added whose evidence met the pack's threshold: the only ones drafted. */
const isDraftable = (f: Finding): boolean =>
  f.passedThreshold && (f.analystVerdict === 'confirmed' || f.analystVerdict === 'added');

export async function draftStage(deps: DraftDeps, product: Product, cycleId: string): Promise<DraftSummary> {
  const phase = await getPhase(deps.db);
  if (phase === 0) {
    return {
      status: 'skipped',
      phase,
      detail: 'phase 0: nothing is proposed until the Phase 0 gate passes (ads phase set 1)',
      drafted: [],
      notDrafted: [],
    };
  }
  const now = deps.now();
  await expireDue(deps.db, now); // an expired proposal no longer counts as open
  const manifest = manifestOf(deps.packs, product.packId);
  const accounts = new Map((await listAccounts(deps.db, product.id)).map((a) => [a.id, a] as const));
  const findings = (await listFindings(deps.db, cycleId)).filter(isDraftable);
  const entities = new Map<string, AdEntity>();
  for (const f of findings) {
    if (f.targetEntityId !== null && !entities.has(f.targetEntityId)) {
      entities.set(f.targetEntityId, await getEntity(deps.db, f.targetEntityId));
    }
  }

  const summary: DraftSummary = { status: 'drafted', phase, drafted: [], notDrafted: [] };
  const pending: { finding: Finding; action: WriteOp; entity: AdEntity; words: DraftWords }[] = [];
  const seen = new Set<string>(); // action hashes drafted in this run
  for (const finding of findings) {
    const target = findingRefText(finding, entities, accounts);
    const existing = await findProposalForFinding(deps.db, finding.id);
    if (existing !== null) {
      summary.drafted.push({
        proposalId: existing.id,
        shortId: existing.shortId,
        findingId: finding.id,
        type: finding.type,
        action: existing.action.action,
        target,
        writer: 'existing',
      });
      continue;
    }
    const spec = FINDING_TYPES[finding.type as FindingTypeId];
    if (spec?.action == null) continue; // a diagnosis: never a proposal
    const entity = finding.targetEntityId === null ? undefined : entities.get(finding.targetEntityId);
    const account = entity === undefined ? undefined : accounts.get(entity.accountId);
    const evidence = ComputedEvidence.parse(finding.evidence);
    const built = await actionForFinding(finding, {
      phase,
      settings: product.settings,
      target: entity === undefined || account === undefined ? null : { entity, accountExternalId: account.externalId },
      guardsFor: (platform) => effectiveGuards(product.settings, manifest, platform),
      isRealSearchTerm: async (adGroupEntityId, term) =>
        (
          await sumSearchTerms(deps.db, {
            productId: product.id,
            from: evidence.from,
            to: evidence.to,
            adGroupEntityId,
            term,
          })
        ).length > 0,
    });
    if (!built.ok) {
      if (built.notYet !== true)
        summary.notDrafted.push({ findingId: finding.id, type: finding.type, target, reason: built.reason });
      continue;
    }
    const actionHash = hashOf(built.action);
    const open = seen.has(actionHash)
      ? 'this run'
      : (await findOpenProposalByAction(deps.db, { productId: product.id, actionHash }))?.shortId;
    if (open !== undefined) {
      summary.notDrafted.push({
        findingId: finding.id,
        type: finding.type,
        target,
        reason: `already proposed (${open})`,
      });
      continue;
    }
    seen.add(actionHash);
    pending.push({
      finding,
      action: built.action,
      entity: built.entity,
      words: {
        key: `proposal-${pending.length + 1}`,
        label: spec.label,
        action: built.action,
        currentDailyBudgetMicros: built.entity.dailyBudgetMicros,
        targetName: built.entity.name,
        evidence,
        findingSummary: finding.summary,
      },
    });
  }
  if (pending.length === 0) return summary;

  const kpiStage = product.settings.outcomes.primaryKpiStage;
  const ctx: WordsContext = {
    currency: product.currency,
    kpiStage,
    kpiLabel: product.settings.outcomes.stages.find((s) => s.id === kpiStage)?.label ?? kpiStage,
  };
  const words = await writeWords(
    deps,
    product,
    cycleId,
    pending.map((p) => p.words),
    ctx,
    summary,
  );

  for (const p of pending) {
    const ai = words.get(p.words.key);
    const text = ai ?? templateWords(p.words, ctx);
    const precondition = preconditionOf(p.action, p.entity);
    // The proposal and its card notification together: a resumed stage skips a drafted finding, so the card must
    // not be left behind.
    const proposal = await deps.db.transaction(async (tx) => {
      const created = await createProposal(tx, {
        productId: product.id,
        cycleId,
        findingId: p.finding.id,
        origin: 'agent',
        action: p.action,
        undo: plannedUndo(p.action, {
          dailyBudgetMicros: p.entity.dailyBudgetMicros === null ? null : p.entity.dailyBudgetMicros.toString(),
        }),
        preconditionHash: precondition.hash,
        preconditionFields: precondition.fields,
        rationale: text.rationale,
        expectedEffect: text.expectedEffect,
        expiresAt: defaultExpiry(p.action, now),
      });
      await enqueueNotification(tx, {
        productId: product.id,
        kind: PROPOSAL_NOTIFICATION,
        payload: { cycleId, proposalId: created.id },
      });
      return created;
    });
    summary.drafted.push({
      proposalId: proposal.id,
      shortId: proposal.shortId,
      findingId: p.finding.id,
      type: p.finding.type,
      action: p.action.action,
      target: findingRefText(p.finding, entities, accounts),
      writer: ai === undefined ? 'template' : 'ai',
    });
  }
  return summary;
}

/** One model call for all the new proposals' words. A failure leaves every proposal with the template. */
async function writeWords(
  deps: DraftDeps,
  product: Product,
  cycleId: string,
  drafts: DraftWords[],
  ctx: WordsContext,
  summary: DraftSummary,
): Promise<Map<string, { rationale: string; expectedEffect: string }>> {
  const data = drafterData(drafts, ctx);
  try {
    const answer = await generateStructured(
      {
        env: deps.env,
        db: deps.db,
        ...(deps.tracing === undefined ? {} : { tracing: deps.tracing }),
        ...(deps.model === undefined ? {} : { model: deps.model }),
      },
      {
        context: { product: { id: product.id, slug: product.slug }, cycleId, stage: 'drafter' },
        schema: DrafterOutput,
        name: 'draft',
        instructions: DRAFTER_INSTRUCTIONS,
        prompt: drafterPrompt(data),
        maxOutputTokens: 4_000,
      },
    );
    summary.words = { model: answer.model, costMicros: answer.costMicros.toString() };
    return checkedWords(answer.output, data, new Set(drafts.map((d) => d.key)));
  } catch (error) {
    summary.words = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    return new Map();
  }
}
