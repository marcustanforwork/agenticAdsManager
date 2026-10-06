// `ads outcomes`: read the product's outcomes from its source (through its pack), then print the last N days by
// stage. Counts only: no ids, emails or hashes are printed. The attribution rate arrives in M05b.
import { syncOutcomes, type OutcomeReadSummary } from '@ads/core';
import { NotFoundError, countOutcomesByStage, findProductBySlug, type Db } from '@ads/db';
import { Command, InvalidArgumentError } from 'commander';
import type { SettingsCliDeps } from './settings.ts';

export interface OutcomesReport {
  product: string;
  window: { from: string; to: string; days: number };
  read: OutcomeReadSummary | { outcome: 'not_read' };
  kpiStage: string;
  /** Every stage in the settings, in order, plus any stored stage the settings no longer have. */
  stages: { stage: string; label: string | null; tier: string | null; kpi: boolean; outcomes: number; test: number }[];
}

export function outcomesCommand(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  product: () => string,
  deps: SettingsCliDeps & { now: () => Date },
): Command {
  return new Command('outcomes')
    .description(
      "read the product's outcomes from its source, then print them by stage (counts; test traffic apart). " +
        'Needs DATABASE_URL and the pack’s source settings (SnapPool: SNAPPOOL_DATABASE_URL)',
    )
    .option('--days <n>', 'how many days to show', (v) => {
      if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 365) throw new InvalidArgumentError('1 to 365');
      return Number(v);
    })
    .option('--no-read', 'show what is stored, without reading the source')
    .action(async (opts: { days?: number; read: boolean }) => {
      const slug = product();
      const days = opts.days ?? 30;
      const report = await withDb(async (db): Promise<OutcomesReport> => {
        const p = await findProductBySlug(db, slug);
        if (!p) throw new NotFoundError('product', slug);
        const read: OutcomesReport['read'] = opts.read
          ? await syncOutcomes({ db, packs: deps.packs, env: deps.env, now: deps.now }, p)
          : { outcome: 'not_read' };
        const to = deps.now();
        const from = new Date(to.getTime() - days * 86_400_000);
        const counts = await countOutcomesByStage(db, { productId: p.id, from, to });
        const { stages, primaryKpiStage } = p.settings.outcomes;
        const rows: OutcomesReport['stages'] = stages.map((s) => {
          const c = counts.find((x) => x.stage === s.id);
          return {
            stage: s.id,
            label: s.label,
            tier: s.tier,
            kpi: s.id === primaryKpiStage,
            outcomes: c?.outcomes ?? 0,
            test: c?.test ?? 0,
          };
        });
        for (const c of counts) {
          if (!stages.some((s) => s.id === c.stage)) rows.push({ ...c, label: null, tier: null, kpi: false });
        }
        return {
          product: slug,
          window: { from: from.toISOString(), to: to.toISOString(), days },
          read,
          kpiStage: primaryKpiStage,
          stages: rows,
        };
      });
      deps.print(JSON.stringify(report, null, 2));
      if (report.read.outcome === 'error') process.exitCode = 1;
    });
}
