// definePack (BLUEPRINT §3.4): a pack is checked once, when it is defined, so a bad manifest fails at startup and
// in tests instead of in the middle of a cycle. Guard overrides may only tighten (a looser one is an error, never
// silently ignored), thresholds may only name known finding types, and the fact schema must be convertible to
// JSON Schema (the dashboard renders forms from it without importing packs).
import {
  ActionType,
  CORE_GUARD_DEFAULTS,
  CopySettings,
  EvidenceThreshold,
  FindingTypeId,
  GuardLoosenedError,
  GuardOverrides,
  NamedQueryId,
  OutcomeConfig,
  PLATFORM_GUARD_DEFAULTS,
  PhaseSpec,
  Platform,
  mergeGuardsTightenOnly,
  type PackManifest,
  type ProductPack,
} from '@ads/contracts';
import { z } from 'zod';

/** A pack id: lower-case words joined by hyphens, e.g. `saas-<product>`. */
export const PACK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** A manifest version: plain semver (bump it when defaults or thresholds change). */
export const SEMVER = /^\d+\.\d+\.\d+$/;

/** Why a pack can't be used. `issues` names every problem found, by path. */
export class PackDefinitionError extends Error {
  readonly packId: string;
  readonly issues: string[];
  constructor(packId: string, issues: string[]) {
    super(`pack ${packId} is invalid: ${issues.join('; ')}`);
    this.name = 'PackDefinitionError';
    this.packId = packId;
    this.issues = issues;
  }
}

const zodIssues = (path: string, error: z.ZodError): string[] =>
  error.issues.map((i) => `${[path, ...i.path.map(String)].join('.')}: ${i.message}`);

function check(issues: string[], path: string, schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  if (!result.success) issues.push(...zodIssues(path, result.error));
}

const PlatformPolicy = z.strictObject({
  meta: z.strictObject({ specialAdCategories: z.array(z.string().min(1)) }).optional(),
});

const BriefSection = z.strictObject({ id: NamedQueryId, title: z.string().min(1), query: NamedQueryId });

/** The fact schema as JSON Schema: the shape a form must produce (zod's input side). Throws for a schema JSON
 *  Schema can't represent (transforms, bigint, dates…), which definePack reports. */
export const factsJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { io: 'input' });

/** Every problem with a manifest, by path; empty when it's valid. */
export function manifestIssues(manifest: PackManifest): string[] {
  const issues: string[] = [];
  if (typeof manifest.id !== 'string' || !PACK_ID.test(manifest.id)) issues.push('id: must look like saas-product');
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) issues.push('version: must be semver');

  check(issues, 'defaults.outcomes', OutcomeConfig, manifest.defaults?.outcomes);
  check(issues, 'defaults.copy', CopySettings, manifest.defaults?.copy);

  check(issues, 'phases', z.array(PhaseSpec).min(1), manifest.phases);
  const phaseIds = (manifest.phases ?? []).map((p) => p.id);
  if (new Set(phaseIds).size !== phaseIds.length) issues.push('phases: ids must be unique');

  const schema = manifest.facts?.schema;
  if (!(schema instanceof z.ZodObject)) {
    issues.push('facts.schema: must be a zod object schema');
  } else {
    try {
      factsJsonSchema(schema);
    } catch (e) {
      issues.push(`facts.schema: can't be expressed as JSON Schema (${(e as Error).message})`);
    }
    for (const key of manifest.facts.requiredForCopy ?? []) {
      if (!(key in schema.shape)) issues.push(`facts.requiredForCopy: "${key}" is not a fact in the schema`);
    }
  }

  for (const [type, threshold] of Object.entries(manifest.thresholds ?? {})) {
    if (!FindingTypeId.safeParse(type).success) issues.push(`thresholds.${type}: unknown finding type`);
    else check(issues, `thresholds.${type}`, EvidenceThreshold, threshold);
  }

  if (manifest.guardOverrides !== undefined) {
    const parsed = GuardOverrides.strict().safeParse(manifest.guardOverrides);
    if (!parsed.success) {
      issues.push(...zodIssues('guardOverrides', parsed.error));
    } else {
      // Tighten-only against the core defaults and every platform's defaults (the layers below a pack).
      for (const platform of Platform.options) {
        try {
          mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, PLATFORM_GUARD_DEFAULTS[platform], parsed.data);
        } catch (e) {
          if (!(e instanceof GuardLoosenedError)) throw e;
          issues.push(`guardOverrides.${e.field}: looser than the core or ${platform} default (${e.message})`);
        }
      }
    }
  }
  if (manifest.disabledActions !== undefined)
    check(issues, 'disabledActions', z.array(ActionType), manifest.disabledActions);
  check(issues, 'platformPolicy', PlatformPolicy, manifest.platformPolicy);
  if (typeof manifest.analystContext !== 'string' || manifest.analystContext.trim() === '') {
    issues.push('analystContext: must be non-empty text');
  }
  if (manifest.briefSections !== undefined) {
    check(issues, 'briefSections', z.array(BriefSection), manifest.briefSections);
    const ids = manifest.briefSections.map((s) => s.id);
    if (new Set(ids).size !== ids.length) issues.push('briefSections: ids must be unique');
  }
  return [...new Set(issues)];
}

/** Checks a pack and returns it frozen. Throws PackDefinitionError naming every problem. */
export function definePack(pack: ProductPack): ProductPack {
  const id = typeof pack.manifest?.id === 'string' ? pack.manifest.id : '(no id)';
  const issues = pack.manifest === undefined ? ['manifest: missing'] : manifestIssues(pack.manifest);
  if (typeof pack.runtime?.outcomeAdapter !== 'function') issues.push('runtime.outcomeAdapter: must be a function');
  if (typeof pack.runtime?.detectPhase !== 'function') issues.push('runtime.detectPhase: must be a function');
  if (issues.length > 0) throw new PackDefinitionError(id, issues);
  return Object.freeze({ manifest: Object.freeze({ ...pack.manifest }), runtime: Object.freeze({ ...pack.runtime }) });
}
