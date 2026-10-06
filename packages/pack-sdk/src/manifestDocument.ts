// The manifest publisher's half that needs no database (BLUEPRINT §3.4): a pack manifest as plain JSON, with the
// fact schema as JSON Schema, for the `pack_manifests` table. The worker publishes it at startup, so the dashboard
// can render forms without importing packs (core's publishPackManifests writes the rows).
import type { PackManifest } from '@ads/contracts';
import { factsJsonSchema } from './definePack.ts';

export interface ManifestDocument {
  packId: string;
  version: string;
  manifest: Record<string, unknown>;
}

export function manifestDocument(manifest: PackManifest): ManifestDocument {
  const json = {
    id: manifest.id,
    version: manifest.version,
    defaults: manifest.defaults,
    phases: manifest.phases,
    facts: { jsonSchema: factsJsonSchema(manifest.facts.schema), requiredForCopy: manifest.facts.requiredForCopy },
    thresholds: manifest.thresholds,
    guardOverrides: manifest.guardOverrides ?? {},
    disabledActions: manifest.disabledActions ?? [],
    platformPolicy: manifest.platformPolicy,
    analystContext: manifest.analystContext,
    briefSections: manifest.briefSections ?? [],
  };
  // A JSON round trip: the stored document holds exactly what JSON can carry (money is already decimal strings).
  const plain = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  return { packId: manifest.id, version: manifest.version, manifest: plain };
}
