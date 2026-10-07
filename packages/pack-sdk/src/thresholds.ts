// The threshold engine (BLUEPRINT §3.4, PROPOSAL §6.5): is there enough evidence to judge? The evidence is
// computed by core from SQL, never supplied by the AI (invariant 4); the minimums come from the pack. It's
// monotonic by construction: every minimum is "at least", so more evidence never fails where less passed.
import { EvidenceThreshold, type FindingTypeId, type PackManifest } from '@ads/contracts';

/** Evidence for one target over its window, computed from the database. */
export interface Evidence {
  impressions: number;
  clicks: number;
  spendMicros: bigint;
  /** Days of data in the window. */
  days: number;
}

export type ThresholdField = keyof EvidenceThreshold;

export interface ThresholdVerdict {
  met: boolean;
  /** The minimums not reached (all of them when there is no threshold). */
  unmet: ThresholdField[];
  threshold: EvidenceThreshold | null;
}

const ALL_FIELDS: ThresholdField[] = ['minImpressions', 'minClicks', 'minSpendMicros', 'minDays'];

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`evidence ${name} must be a whole number ≥ 0`);
}

/** Checks evidence against a threshold. No threshold means nothing may be judged: not met (fail closed). */
export function evaluateEvidence(
  evidence: Evidence,
  threshold: EvidenceThreshold | null | undefined,
): ThresholdVerdict {
  assertCount('impressions', evidence.impressions);
  assertCount('clicks', evidence.clicks);
  assertCount('days', evidence.days);
  if (typeof evidence.spendMicros !== 'bigint' || evidence.spendMicros < 0n) {
    throw new RangeError('evidence spendMicros must be a bigint ≥ 0');
  }
  if (threshold === null || threshold === undefined) return { met: false, unmet: [...ALL_FIELDS], threshold: null };
  const t = EvidenceThreshold.parse(threshold);
  const unmet: ThresholdField[] = [];
  if (evidence.impressions < t.minImpressions) unmet.push('minImpressions');
  if (evidence.clicks < t.minClicks) unmet.push('minClicks');
  if (evidence.spendMicros < BigInt(t.minSpendMicros)) unmet.push('minSpendMicros');
  if (evidence.days < t.minDays) unmet.push('minDays');
  return { met: unmet.length === 0, unmet, threshold: t };
}

/** The pack's threshold for a finding type, or null when the pack sets none. */
export const thresholdFor = (manifest: PackManifest, type: FindingTypeId): EvidenceThreshold | null =>
  manifest.thresholds[type] ?? null;

/** Whether the evidence is enough for this finding type, by the pack's threshold. */
export const meetsThreshold = (manifest: PackManifest, type: FindingTypeId, evidence: Evidence): ThresholdVerdict =>
  evaluateEvidence(evidence, thresholdFor(manifest, type));
