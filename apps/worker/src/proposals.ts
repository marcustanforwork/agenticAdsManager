// `ads proposals …`, `ads phase …` and `ads eval replay` (M08). Reading is direct; a decision or a phase change is
// an operator request (approve, reject, set_phase), recorded and processed by the one processor (invariant 9), as
// from Telegram (M09a) or the dashboard (M10b). Phase 1 applies nothing: Marcus makes an approved change by hand.
// Targets are shown as refs (platform ids), never names.
import { actorsFromEnv, entityRefText, submitRequest } from '@ads/core';
import {
  type Db,
  NotFoundError,
  type ProposalRecord,
  findProductBySlug,
  findProposalByShortId,
  getFinding,
  getPhase,
  listProposalVersions,
  listProposals,
} from '@ads/db';
import { DECISION_CASES_DIR, decisionCasesFromDb, loadDecisionCases, scoreReplay } from '@ads/evals';
import type { OperatorRequest, ProposalStatus, WriteOp } from '@ads/contracts';
import type { PackRegistry } from '@ads/pack-sdk';
import { Command, InvalidArgumentError } from 'commander';
import { cliActor } from './settings.ts';

type WithDb = <T>(run: (db: Db) => Promise<T>) => Promise<T>;

export interface ProposalsCliDeps {
  env: NodeJS.ProcessEnv;
  print: (line: string) => void;
  packs: PackRegistry;
}

const shortId = (value: string): string => {
  if (!/^[a-z2-9]{8}$/.test(value)) throw new InvalidArgumentError('a proposal id (8 characters, as `list` prints it)');
  return value;
};

const versionNumber = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw new InvalidArgumentError('a version number');
  return Number(value);
};

/** The change in plain fields: what it does and to what (refs only). */
export function describeAction(action: WriteOp): Record<string, unknown> {
  switch (action.action) {
    case 'pause_entity':
    case 'resume_entity':
    case 'mark_abandoned':
      return { action: action.action, target: entityRefText(action.target) };
    case 'add_negative_keyword':
      return {
        action: action.action,
        target: entityRefText(action.target),
        text: action.text,
        matchType: action.matchType,
      };
    case 'remove_negative_keyword':
      return { action: action.action, target: entityRefText(action.target), criterionId: action.criterionId };
    case 'adjust_budget':
      return {
        action: action.action,
        target: entityRefText(action.target),
        newDailyBudgetMicros: action.newDailyBudgetMicros,
        netIncrease: action.netIncrease,
      };
    case 'create_entity_paused':
      return { action: action.action, parent: entityRefText(action.parent), type: action.type };
    case 'upload_conversions':
      return { action: action.action, platform: action.platform, events: action.events.length };
  }
}

const summaryOf = (p: ProposalRecord, findingType: string | null) => ({
  id: p.shortId,
  status: p.status,
  version: p.version,
  origin: p.origin,
  finding: findingType,
  change: describeAction(p.action),
  rationale: p.rationale,
  expectedEffect: p.expectedEffect,
  createdAt: p.createdAt.toISOString(),
  expiresAt: p.expiresAt.toISOString(),
});

const findingTypeOf = async (db: Db, p: ProposalRecord): Promise<string | null> =>
  p.findingId === null ? null : (await getFinding(db, p.findingId)).type;

async function productOf(db: Db, slug: string) {
  const product = await findProductBySlug(db, slug);
  if (!product) throw new NotFoundError('product', slug);
  return product;
}

async function proposalOf(db: Db, productId: string, id: string): Promise<ProposalRecord> {
  const p = await findProposalByShortId(db, id);
  if (p === null || p.productId !== productId) throw new NotFoundError('proposal', id);
  return p;
}

export function proposalsCommand(withDb: WithDb, requireProduct: () => string, deps: ProposalsCliDeps): Command {
  const cmd = new Command('proposals').description(
    "list, show, approve or reject the agent's proposals (Phase 1 applies nothing: you make an approved change by " +
      'hand in Google Ads or Meta Ads Manager). Needs DATABASE_URL',
  );

  const decide = async (request: (p: ProposalRecord) => OperatorRequest, slug: string, id: string) => {
    const result = await withDb(async (db) => {
      const product = await productOf(db, slug);
      const p = await proposalOf(db, product.id, id);
      const { id: requestId, outcome } = await submitRequest(
        db,
        { request: request(p), actor: cliActor(deps.env), channel: 'cli' },
        { actors: actorsFromEnv(deps.env['OPERATOR_ACTORS']), packs: deps.packs },
      );
      return { product: slug, proposal: id, request: requestId, status: outcome.status, ...outcome.result };
    });
    deps.print(JSON.stringify(result, null, 2));
    if (result.status !== 'done') process.exitCode = 1;
  };

  cmd
    .command('list')
    .description('print the proposals as JSON, newest first (default: pending only)')
    .option('--all', 'every status')
    .action(async (opts: { all?: boolean }) => {
      const slug = requireProduct();
      const out = await withDb(async (db) => {
        const product = await productOf(db, slug);
        const statuses: ProposalStatus[] | undefined = opts.all === true ? undefined : ['pending'];
        const rows = await listProposals(db, product.id, statuses);
        return {
          product: slug,
          phase: await getPhase(db),
          proposals: await Promise.all(rows.map(async (p) => summaryOf(p, await findingTypeOf(db, p)))),
        };
      });
      deps.print(JSON.stringify(out, null, 2));
    });

  cmd
    .command('show')
    .description('print one proposal in full: its action, planned undo, fingerprint and versions')
    .argument('<id>', 'the proposal id', shortId)
    .action(async (id: string) => {
      const slug = requireProduct();
      const out = await withDb(async (db) => {
        const product = await productOf(db, slug);
        const p = await proposalOf(db, product.id, id);
        return {
          ...summaryOf(p, await findingTypeOf(db, p)),
          action: p.action,
          actionHash: p.actionHash,
          undo: p.undo,
          precondition: { fields: p.preconditionFields, hash: p.preconditionHash },
          statusDetail: p.statusDetail,
          versions: (await listProposalVersions(db, p.id)).map((v) => ({
            version: v.version,
            actionHash: v.actionHash,
            createdAt: v.createdAt.toISOString(),
          })),
        };
      });
      deps.print(JSON.stringify(out, null, 2));
    });

  cmd
    .command('approve')
    .description(
      'approve a proposal at the version `list` or `show` printed (refused if it changed since): its exact action',
    )
    .argument('<id>', 'the proposal id', shortId)
    .requiredOption('--version <n>', 'the version you reviewed', versionNumber)
    .action(async (id: string, opts: { version: number }) => {
      await decide(
        (p) => ({
          kind: 'approve',
          proposalId: p.id,
          version: opts.version,
          // The hash of the version reviewed: a newer version's action is never approved by mistake.
          actionHash: p.version === opts.version ? p.actionHash : '(changed since reviewed)',
        }),
        requireProduct(),
        id,
      );
    });

  cmd
    .command('reject')
    .description('reject a proposal, with your reason (it becomes eval data and the analyst’s decision memory)')
    .argument('<id>', 'the proposal id', shortId)
    .requiredOption('--reason <text>', 'why (at least 3 characters)')
    .option('--version <n>', 'refuse unless this is still the current version', versionNumber)
    .action(async (id: string, opts: { reason: string; version?: number }) => {
      if (opts.reason.trim().length < 3) throw new InvalidArgumentError('--reason: at least 3 characters');
      await decide(
        (p) => ({ kind: 'reject', proposalId: p.id, version: opts.version ?? p.version, reason: opts.reason.trim() }),
        requireProduct(),
        id,
      );
    });

  return cmd;
}

export function phaseCommand(withDb: WithDb, deps: ProposalsCliDeps): Command {
  const cmd = new Command('phase')
    .description(
      "print the system's phase (PROPOSAL §12; D-082). At 0 nothing is proposed; set 1 when the Phase 0 gate passes",
    )
    .action(async () => {
      const phase = await withDb((db) => getPhase(db));
      deps.print(JSON.stringify({ phase }, null, 2));
    });
  cmd
    .command('set')
    .description('set the phase (a set_phase request for OPERATOR_ACTORS), with a note saying which gate passed')
    .argument('<n>', 'the phase, 0 to 5', (v) => {
      if (!/^[0-5]$/.test(v)) throw new InvalidArgumentError('a phase from 0 to 5');
      return Number(v);
    })
    .requiredOption('--note <text>', 'why, e.g. "Phase 0 gate passed: 2 of 4 briefs useful and new"')
    .action(async (phase: number, opts: { note: string }) => {
      if (opts.note.trim().length < 3) throw new InvalidArgumentError('--note: at least 3 characters');
      const result = await withDb(async (db) => {
        const { id, outcome } = await submitRequest(
          db,
          { request: { kind: 'set_phase', phase, note: opts.note.trim() }, actor: cliActor(deps.env), channel: 'cli' },
          { actors: actorsFromEnv(deps.env['OPERATOR_ACTORS']), packs: deps.packs },
        );
        return { request: id, status: outcome.status, ...outcome.result };
      });
      deps.print(JSON.stringify(result, null, 2));
      if (result.status !== 'done') process.exitCode = 1;
    });
  return cmd;
}

export function evalCommand(
  withDb: WithDb,
  optionalProduct: () => string | undefined,
  deps: ProposalsCliDeps,
): Command {
  const cmd = new Command('eval').description('replay evals (M08 v0; M16a adds model runs and comparison)');
  cmd
    .command('replay')
    .description(
      "score the analyst's recorded answers against your decisions: precision and recall per finding type. With " +
        '--product: the decisions in the database (needs DATABASE_URL); with --hand-written: the cases in a checkout',
    )
    .option('--hand-written [dir]', 'score the hand-written cases (default: packages/evals/cases/decisions)')
    .action(async (opts: { handWritten?: string | boolean }) => {
      const slug = optionalProduct();
      if (opts.handWritten !== undefined) {
        const dir = typeof opts.handWritten === 'string' ? opts.handWritten : DECISION_CASES_DIR;
        deps.print(JSON.stringify({ source: dir, ...scoreReplay(await loadDecisionCases(dir)) }, null, 2));
        return;
      }
      if (slug === undefined) throw new InvalidArgumentError('--product <slug>, or --hand-written');
      const out = await withDb(async (db) => {
        const product = await productOf(db, slug);
        return { product: slug, ...scoreReplay(await decisionCasesFromDb(db, product)) };
      });
      deps.print(JSON.stringify(out, null, 2));
    });
  return cmd;
}
