// Worker startup: publish the pack manifests (M05a). Resuming unfinished cycles is part of the worker service's
// startup reconciliation since M07 (`recoverWorker`, worker.ts).
import { publishPackManifests } from '@ads/core';
import { connect } from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { INSTALLED_PACKS } from './packs.ts';

export interface StartupLogger {
  info(obj: object, msg: string): void;
}

/** Publishes the installed packs' manifests (M05a), so the dashboard can read them. Skipped without DATABASE_URL. */
export async function publishManifestsAtStartup(
  env: NodeJS.ProcessEnv,
  logger: StartupLogger,
  packs: PackRegistry = INSTALLED_PACKS,
): Promise<string[] | null> {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    logger.info({}, 'no DATABASE_URL: pack manifests are not published');
    return null;
  }
  const database = connect(url, { max: 1, applicationName: 'ads-worker' });
  try {
    const published = await publishPackManifests(database.db, packs);
    logger.info({ published }, 'pack manifests published');
    return published;
  } finally {
    await database.close();
  }
}
