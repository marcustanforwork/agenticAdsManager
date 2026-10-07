// Offering facts (BLUEPRINT §3.4, M05b): what ads and the analyst may state about what a product sells. A
// `facts_put` request replaces an offering's facts whole; the processor validates them against the product's
// pack's fact schema (BLUEPRINT §5.4), and refuses unknown keys by name instead of dropping them.
import type { PackManifest } from '@ads/contracts';
import { unknownPaths } from './settingsPatch.ts';

/** Why facts were refused; the processor shows `message` to Marcus. */
export class FactsError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(`${message}: ${issues.join('; ')}`);
    this.name = 'FactsError';
    this.issues = issues;
  }
}

/** The facts as the pack's schema parses them. Throws FactsError for invalid facts or unknown keys. */
export function validateFacts(manifest: PackManifest, facts: Record<string, unknown>): Record<string, unknown> {
  const result = manifest.facts.schema.safeParse(facts);
  if (!result.success) {
    throw new FactsError(
      'invalid facts',
      result.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`),
    );
  }
  const unknown = unknownPaths(facts, result.data);
  if (unknown.length > 0) throw new FactsError('not a fact', unknown);
  return result.data as Record<string, unknown>;
}
