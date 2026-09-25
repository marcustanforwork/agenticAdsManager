import { z } from 'zod';
import type { FindingTypeId } from './findings.ts';
import { MicrosJson } from './money.ts';
import type { OutcomeAdapter } from './outcomes.ts';
import type { ActionType, CopySettings, GuardOverrides, OutcomeConfig, ProductSettings } from './settings.ts';

export const PhaseSpec = z.object({
  id: z.string(),
  label: z.string(),
  intent: z.string(), // one paragraph, shown to the analyst
  budgetPosture: z.enum(['conserve', 'steady', 'push']),
});
export type PhaseSpec = z.infer<typeof PhaseSpec>;

export const EvidenceThreshold = z.object({
  minImpressions: z.number().int().min(0),
  minClicks: z.number().int().min(0),
  minSpendMicros: MicrosJson,
  minDays: z.number().int().min(0),
});
export type EvidenceThreshold = z.infer<typeof EvidenceThreshold>;

/** Id of a named core query that a brief section may show (defined in core from M07). Never SQL. */
export const NamedQueryId = z.string().regex(/^[a-z][a-z0-9_]*$/);
export type NamedQueryId = z.infer<typeof NamedQueryId>;

/** Pure data and schemas. No I/O imports (checked). Published to the pack_manifests table at worker startup,
 *  with the fact schema converted to JSON Schema, so the dashboard can render forms without importing packs. */
export interface PackManifest {
  id: string; // the pack id, '<kind>-<product>'
  version: string; // semver; bump when defaults or thresholds change
  defaults: { outcomes: OutcomeConfig; copy: CopySettings };
  phases: PhaseSpec[];
  facts: { schema: z.ZodType; requiredForCopy: string[] };
  thresholds: Partial<Record<FindingTypeId, EvidenceThreshold>>;
  guardOverrides?: GuardOverrides; // tighten-only (definePack rejects looser)
  disabledActions?: ActionType[];
  platformPolicy: { meta?: { specialAdCategories: string[] } }; // property: ['HOUSING'] (confirmed, D-062)
  analystContext: string; // trusted guidance written by Marcus
  briefSections?: { id: string; title: string; query: NamedQueryId }[]; // named core queries, never SQL
}

/** What core supplies to a pack's phase detection. M05a may add fields. */
export interface LifecycleContext {
  now: Date;
  facts: Record<string, unknown>; // offering facts, validated against the pack's fact schema
  firstSpendAt: Date | null;
  spendLast30dMicros: bigint;
}

/** Runtime part: may do I/O. Loaded only by the worker. */
export interface PackRuntime {
  outcomeAdapter(env: Readonly<Record<string, string | undefined>>, settings: ProductSettings): OutcomeAdapter; // settings carry testTraffic
  detectPhase(ctx: LifecycleContext): string; // pure; ctx (offering facts, dates, spend) supplied by core
}

export interface ProductPack {
  manifest: PackManifest;
  runtime: PackRuntime;
}
