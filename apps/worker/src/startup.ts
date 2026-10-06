// Worker startup (BLUEPRINT §5.5, M04): resume unfinished cycles from `stage_reached`, so a container restarted in
// the middle of a sync carries on. Skipped without DATABASE_URL and VAULT_READ_KEY (the M00 smoke test runs with no
// secrets). M07 folds this into the full startup reconciliation (`recoverWorker`) with the job runner.
import { type ResumeSummary, resumeUnfinishedCycles } from '@ads/core';
import { connect } from '@ads/db';
import { masterKeyFromEnv } from '@ads/vault';

export interface StartupLogger {
  info(obj: object, msg: string): void;
}

export async function resumeCyclesAtStartup(
  env: NodeJS.ProcessEnv,
  logger: StartupLogger,
  now: () => Date = () => new Date(),
): Promise<ResumeSummary | null> {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '' || env['VAULT_READ_KEY'] === undefined || env['VAULT_READ_KEY'] === '') {
    logger.info({}, 'no DATABASE_URL or VAULT_READ_KEY: unfinished cycles are not resumed');
    return null;
  }
  const masterKey = masterKeyFromEnv('VAULT_READ_KEY', 'read', env);
  const database = connect(url, { max: 2, applicationName: 'ads-worker' });
  try {
    const out = await resumeUnfinishedCycles({ db: database.db, lockUrl: url, masterKey, process: 'worker', now });
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
    await database.close();
  }
}
