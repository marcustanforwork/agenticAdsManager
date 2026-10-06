// Publishing the installed packs' manifests (BLUEPRINT §3.4): the worker does it at startup, so the dashboard can
// show defaults, phases and fact forms without importing packs. Re-publishing a version replaces it.
import { publishPackManifest, type DbOrTx } from '@ads/db';
import { manifestDocument, type PackRegistry } from '@ads/pack-sdk';

export async function publishPackManifests(db: DbOrTx, packs: PackRegistry): Promise<string[]> {
  const published: string[] = [];
  for (const pack of packs.list()) {
    const doc = manifestDocument(pack.manifest);
    await publishPackManifest(db, doc);
    published.push(`${doc.packId}@${doc.version}`);
  }
  return published;
}
