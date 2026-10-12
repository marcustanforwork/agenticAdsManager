// Worker startup (BLUEPRINT §5.5, M04): resume unfinished cycles from `stage_reached`, so a container restarted in
// the middle of a sync carries on. Skipped without DATABASE_URL and VAULT_READ_KEY (the M00 smoke test runs with no
// secrets). M07 folds this into the full startup reconciliation (`recoverWorker`) with the job runner.
import { createModelTracing, publishPackManifests, type ResumeSummary, resumeUnfinishedCycles } from '@ads/core';
import { connect } from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { masterKeyFromEnv } from '@ads/vault';
import { INSTALLED_PACKS } from './packs.ts';

export interface StartupLogger {
  info(obj: object, msg: string): void;
}

export async function resumeCyclesAtStartup(
  env: NodeJS.ProcessEnv,
  logger: StartupLogger,
  now: () => Date = () => new Date(),
  packs: PackRegistry = INSTALLED_PACKS,
): Promise<ResumeSummary | null> {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '' || env['VAULT_READ_KEY'] === undefined || env['VAULT_READ_KEY'] === '') {
    logger.info({}, 'no DATABASE_URL or VAULT_READ_KEY: unfinished cycles are not resumed');
    return null;
  }
  const masterKey = masterKeyFromEnv('VAULT_READ_KEY', 'read', env);
  const database = connect(url, { max: 2, applicationName: 'ads-worker' });
  // A resumed cycle may reach the analyst: its calls are traced like any other (no Langfuse keys = untraced).
  const tracing = createModelTracing(env);
  try {
    const out = await resumeUnfinishedCycles({
      db: database.db,
      lockUrl: url,
      masterKey,
      process: 'worker',
      now,
      packs,
      env,
      tracing,
    });
    logger.info(
      {
        resumed: out.resumed.map((r) => ({ cycleId: r.cycleId, product: r.product, outcome: r.outcome })),
        abandoned: out.abandoned.length,
        errors: out.errors,
      },
      'unfinished cycles checked',
    );
    return out;
  } finally {
    await tracing?.shutdown();
    await database.close();
  }
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
