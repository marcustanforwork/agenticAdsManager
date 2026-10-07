// `pnpm --filter @ads/db db:migrate`. Connects to DATABASE_URL (Doppler supplies it:
// `doppler run -- pnpm --filter @ads/db db:migrate`). Prints what it did; never prints the URL.
// Seeding moved to the worker's `ads seed` (M05a): it takes each product's settings from its pack.
import { connect } from './client.ts';
import { migrateDatabase } from './migrate.ts';

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const database = connect(url, { max: 1, applicationName: 'ads-db-cli' });
  try {
    if (command === 'migrate') {
      await migrateDatabase(database.db);
      console.log('migrations and roles.sql applied');
    } else {
      throw new Error('usage: cli.ts migrate (to seed, run the worker CLI: ads seed)');
    }
  } finally {
    await database.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
