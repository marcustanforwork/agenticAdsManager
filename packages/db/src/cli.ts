// `pnpm --filter @ads/db db:migrate` and `db:seed [file]`. Connects to DATABASE_URL (Doppler supplies it:
// `doppler run -- pnpm --filter @ads/db db:migrate`). Prints what it did; never prints the URL.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect } from './client.ts';
import { migrateDatabase } from './migrate.ts';
import { seed } from './seed.ts';

const DEFAULT_SEED_FILE = fileURLToPath(new URL('../../../products/seed.json', import.meta.url));

async function main(argv: string[]): Promise<void> {
  const [command, file] = argv;
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const database = connect(url, { max: 1, applicationName: 'ads-db-cli' });
  try {
    if (command === 'migrate') {
      await migrateDatabase(database.db);
      console.log('migrations and roles.sql applied');
    } else if (command === 'seed') {
      const spec: unknown = JSON.parse(await readFile(file ?? DEFAULT_SEED_FILE, 'utf8'));
      console.log(JSON.stringify(await seed(database.db, spec)));
    } else {
      throw new Error('usage: cli.ts migrate | seed [file]');
    }
  } finally {
    await database.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
