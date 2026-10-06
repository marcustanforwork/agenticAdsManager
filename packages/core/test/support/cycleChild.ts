// The crash-resume test's child process (M04): it runs today's daily cycle against the test database with the
// replayed fixtures, prints "synced" once the sync stage is recorded, then hangs until the test kills it.
// Run with: node --conditions=@ads/source cycleChild.ts (the env carries the database, product and key).
import { replayFetch } from '@ads/connector-testing';
import { connect } from '@ads/db';
import { parseMasterKey } from '@ads/vault';
import { runCycle } from '../../src/index.ts';
import { NOW, TEST_PACKS, googleCassettes, metaCassettes, tokenFetch } from './world.ts';

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};
const url = env('CYCLE_DB_URL');
const database = connect(url);
await runCycle(
  {
    db: database.db,
    lockUrl: url,
    masterKey: parseMasterKey(env('CYCLE_MASTER_KEY')),
    process: 'worker',
    fetch: replayFetch([...metaCassettes(NOW), ...googleCassettes(NOW)]).fetch,
    tokenFetch,
    now: () => NOW,
    packs: TEST_PACKS,
    env: {},
    onStage: async (stage) => {
      if (stage !== 'synced') return;
      process.stdout.write('synced\n');
      await new Promise(() => undefined); // wait here for the kill
    },
  },
  { productId: env('CYCLE_PRODUCT_ID'), kind: 'daily' },
);
