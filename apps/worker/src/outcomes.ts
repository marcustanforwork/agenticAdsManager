// `ads outcomes`: read the product's outcomes from its source (through its pack) and credit them to campaigns,
// then print the last N days by stage, with the attribution rate (M05b). Counts only: no ids, emails or hashes
// are printed.
import { attributeOutcomes, syncOutcomes, type AttributionRunSummary, type OutcomeReadSummary } from '@ads/core';
import { NotFoundError, countAttribution, countOutcomesByStage, findProductBySlug, type Db } from '@ads/db';
import { Command, InvalidArgumentError } from 'commander';
import type { SettingsCliDeps } from './settings.ts';

export interface OutcomesReport {
  product: string;
  window: { from: string; to: string; days: number };
  read: OutcomeReadSummary | { outcome: 'not_read' };
  kpiStage: string;
  /** Every stage in the settings, in order, plus any stored stage the settings no longer have. `attributed`: of
   *  `outcomes`, those credited to a campaign. */
  stages: {
    stage: string;
    label: string | null;
    tier: string | null;
    kpi: boolean;
    outcomes: number;
    test: number;
    attributed: number;
  }[];
  /** The attribution rate of the KPI stage in the window (test traffic apart): attributed / outcomes in percent,
   *  one decimal; null without outcomes. `pending` outcomes haven't been through attribution yet. */
  attribution: {
    stage: string;
    outcomes: number;
    attributed: number;
    ratePct: number | null;
    byMethod: { platform_ids: number; gclid_lookup: number; utm: number; none: number; pending: number };
    /** What this run credited (absent with --no-read). */
    run?: AttributionRunSummary;
  };
}

const ATTRIBUTED = new Set(['platform_ids', 'gclid_lookup', 'utm']);

export function outcomesCommand(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  product: () => string,
  deps: SettingsCliDeps & { now: () => Date },
): Command {
  return new Command('outcomes')
    .description(
      "read the product's outcomes from its source and credit them to campaigns, then print them by stage with " +
        'the attribution rate (counts; test traffic apart). Needs DATABASE_URL and the pack’s source settings ' +
        '(SnapPool: SNAPPOOL_DATABASE_URL)',
    )
    .option('--days <n>', 'how many days to show', (v) => {
      if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 365) throw new InvalidArgumentError('1 to 365');
      return Number(v);
    })
    .option('--no-read', 'show what is stored, without reading the source or attributing')
    .action(async (opts: { days?: number; read: boolean }) => {
      const slug = product();
      const days = opts.days ?? 30;
      const report = await withDb(async (db): Promise<OutcomesReport> => {
        const p = await findProductBySlug(db, slug);
        if (!p) throw new NotFoundError('product', slug);
        const read: OutcomesReport['read'] = opts.read
          ? await syncOutcomes({ db, packs: deps.packs, env: deps.env, now: deps.now }, p)
          : { outcome: 'not_read' };
        // Attribution reads only the database (the entities and clicks the last sync stored).
        const run = opts.read ? await attributeOutcomes(db, { productId: p.id, now: deps.now() }) : undefined;
        const to = deps.now();
        const from = new Date(to.getTime() - days * 86_400_000);
        const counts = await countOutcomesByStage(db, { productId: p.id, from, to });
        const credited = await countAttribution(db, { productId: p.id, from, to });
        const attributedIn = (stage: string): number =>
          credited
            .filter((c) => c.stage === stage && c.method !== null && ATTRIBUTED.has(c.method))
            .reduce((n, c) => n + c.outcomes, 0);
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
            attributed: attributedIn(s.id),
          };
        });
        for (const c of counts) {
          if (!stages.some((s) => s.id === c.stage)) {
            rows.push({ ...c, label: null, tier: null, kpi: false, attributed: attributedIn(c.stage) });
          }
        }
        const byMethod = { platform_ids: 0, gclid_lookup: 0, utm: 0, none: 0, pending: 0 };
        for (const c of credited) if (c.stage === primaryKpiStage) byMethod[c.method ?? 'pending'] += c.outcomes;
        const kpiOutcomes = Object.values(byMethod).reduce((a, b) => a + b, 0);
        const kpiAttributed = byMethod.platform_ids + byMethod.gclid_lookup + byMethod.utm;
        return {
          product: slug,
          window: { from: from.toISOString(), to: to.toISOString(), days },
          read,
          kpiStage: primaryKpiStage,
          stages: rows,
          attribution: {
            stage: primaryKpiStage,
            outcomes: kpiOutcomes,
            attributed: kpiAttributed,
            ratePct: kpiOutcomes === 0 ? null : Math.round((kpiAttributed * 1000) / kpiOutcomes) / 10,
            byMethod,
            ...(run === undefined ? {} : { run }),
          },
        };
      });
      deps.print(JSON.stringify(report, null, 2));
      if (report.read.outcome === 'error') process.exitCode = 1;
    });
}
