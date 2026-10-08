// `ads findings`: a cycle's findings as JSON (M06b): the detector candidates with the analyst's verdicts, and the
// analyst's own findings, each with its computed evidence and whether it met the pack's threshold. Read only.
// Targets are shown as refs (platform ids), never names.
import { type FindingTarget, targetRefText } from '@ads/core';
import {
  type Db,
  type Finding,
  NotFoundError,
  findProductBySlug,
  getCycle,
  listAccounts,
  listCycles,
  listEntities,
  listFindings,
} from '@ads/db';
import { Command, InvalidArgumentError } from 'commander';

const uuid = (value: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidArgumentError('a cycle id (a UUID, as `ads cycle` prints it)');
  }
  return value;
};

export interface FindingsReport {
  product: string;
  cycleId: string;
  cycleDate: string;
  stageReached: string;
  /** The model's cost for the cycle, USD micros (a decimal string). */
  modelCostMicros: string;
  findings: {
    id: string;
    type: string;
    source: string;
    verdict: string | null;
    target: string;
    summary: string;
    whyNow: string | null;
    dismissedReason: string | null;
    confidence: string | null;
    passedThreshold: boolean;
    evidence: unknown;
    params: unknown;
    evidenceRefs: unknown;
  }[];
}

export function findingsCommand(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  requireProduct: () => string,
  deps: { print: (line: string) => void },
): Command {
  return new Command('findings')
    .description(
      "print a cycle's findings as JSON: the detectors' candidates with the analyst's verdicts, and the analyst's " +
        "own findings, with computed evidence (read only; default: the product's latest cycle). Needs DATABASE_URL",
    )
    .option('--cycle <id>', 'the cycle id', uuid)
    .action(async (opts: { cycle?: string }) => {
      const slug = requireProduct();
      await withDb(async (db) => {
        const product = await findProductBySlug(db, slug);
        if (!product) throw new NotFoundError('product', slug);
        const cycle =
          opts.cycle === undefined ? (await listCycles(db, product.id, 1))[0] : await getCycle(db, opts.cycle);
        if (cycle === undefined) throw new NotFoundError('cycle', `the latest of ${slug}`);
        if (cycle.productId !== product.id) throw new NotFoundError('cycle', `${cycle.id} of ${slug}`);
        const accounts = new Map((await listAccounts(db, product.id)).map((a) => [a.id, a] as const));
        const entities = new Map((await listEntities(db, product.id)).map((e) => [e.id, e] as const));
        const targetOf = (f: Finding): string => {
          const entity = f.targetEntityId === null ? undefined : entities.get(f.targetEntityId);
          const account = f.targetAccountId === null ? undefined : accounts.get(f.targetAccountId);
          const target: FindingTarget | null =
            entity !== undefined
              ? { kind: 'entity', entity }
              : account !== undefined
                ? { kind: 'account', account }
                : f.targetEntityId === null && f.targetAccountId === null
                  ? { kind: 'product' }
                  : null;
          return target === null ? '?' : targetRefText(target, accounts);
        };
        const report: FindingsReport = {
          product: slug,
          cycleId: cycle.id,
          cycleDate: cycle.cycleDate,
          stageReached: cycle.stageReached,
          modelCostMicros: cycle.modelCostMicros.toString(),
          findings: (await listFindings(db, cycle.id)).map((f) => ({
            id: f.id,
            type: f.type,
            source: f.source,
            verdict: f.analystVerdict,
            target: targetOf(f),
            summary: f.summary,
            whyNow: f.whyNow,
            dismissedReason: f.dismissedReason,
            confidence: f.confidence,
            passedThreshold: f.passedThreshold,
            evidence: f.evidence,
            params: f.params,
            evidenceRefs: f.evidenceRefs,
          })),
        };
        deps.print(JSON.stringify(report, null, 2));
      });
    });
}
