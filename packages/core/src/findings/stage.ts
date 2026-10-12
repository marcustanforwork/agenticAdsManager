// The detect stage (M06a): run the detectors on the synced data and store the candidates as `findings` with
// `source = 'detector'`, replacing any from an interrupted run of the stage. The analyse stage (M06b) confirms or
// dismisses them.
import type { ComputedEvidence, FindingTypeId } from '@ads/contracts';
import { type DbOrTx, type Product, listAccounts, replaceDetectorFindings } from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { type Candidate, type Detector, runDetectors } from './detectors.ts';
import { targetRefText } from '../analyst/refs.ts';

export interface DetectedCandidate {
  findingId: string;
  type: FindingTypeId;
  /** A ref, platform ids only, never names: `google:1234567890:campaign:123`, `meta:act_456`, or `product`. */
  target: string;
  summary: string;
  evidence: ComputedEvidence;
}

export interface DetectSummary {
  candidates: DetectedCandidate[];
  /** Why no detector ran (no pack installed for the product). */
  skipped?: string;
}

export async function detectStage(
  deps: { db: DbOrTx; packs?: PackRegistry; now: () => Date; detectors?: readonly Detector[] },
  product: Product,
  cycleId: string,
): Promise<DetectSummary> {
  if (deps.packs === undefined || !deps.packs.has(product.packId)) {
    await replaceDetectorFindings(deps.db, { productId: product.id, cycleId, findings: [] });
    return { candidates: [], skipped: `the pack ${product.packId} is not installed, so there are no thresholds` };
  }
  const manifest = deps.packs.get(product.packId).manifest;
  const found: Candidate[] = await runDetectors(
    { db: deps.db, product, manifest, cycleId, now: deps.now() },
    deps.detectors,
  );
  const stored = await replaceDetectorFindings(deps.db, {
    productId: product.id,
    cycleId,
    findings: found.map((c) => ({
      type: c.type,
      targetEntityId: c.target.kind === 'entity' ? c.target.entity.id : null,
      targetAccountId: c.target.kind === 'account' ? c.target.account.id : null,
      summary: c.summary,
      evidence: c.evidence,
      params: c.params ?? null,
      passedThreshold: true, // detectors keep only candidates whose evidence meets the pack's threshold
    })),
  });
  const accounts = new Map((await listAccounts(deps.db, product.id)).map((a) => [a.id, a] as const));
  return {
    candidates: found.map((c, i) => ({
      findingId: stored[i]?.id ?? '',
      type: c.type,
      target: targetRefText(c.target, accounts),
      summary: c.summary,
      evidence: c.evidence,
    })),
  };
}
