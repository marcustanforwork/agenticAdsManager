// Records real Google fixtures (BLUEPRINT M03, the `record-fixture` skill). Read credentials only.
//
//   RECORD=1 GOOGLE_CREDENTIAL=/path/to/key.json \
//     pnpm --filter @ads/connector-google record --account 1234567890 [--manager 1112223333] [--actions 555] [--days 7]
//
// GOOGLE_CREDENTIAL is the same JSON file given to `ads credentials put --role read`: the Read only service
// account's key file (or an authorized_user credential). Every exchange is redacted (tokens, keys, names, search
// terms, emails) and the files are scanned before they're written to fixtures/google/recorded/. The redacted
// files are safe to commit; the key file never is.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isRecording } from '@ads/connector-testing';
import { tokenProviderFor } from '../src/index.ts';
import { recordGoogleFixtures } from './recordFixtures.ts';

const ID = /^\d{10}$/;

async function main(): Promise<void> {
  if (!isRecording()) throw new Error('set RECORD=1 to call the real Google Ads API');
  const argv = process.argv.slice(2);
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv, // `pnpm … record -- --account …` passes the `--` on
    options: {
      account: { type: 'string' },
      manager: { type: 'string' },
      actions: { type: 'string', default: '' },
      days: { type: 'string', default: '7' },
    },
  });
  const account = values.account ?? '';
  if (!ID.test(account)) throw new Error('--account <10-digit customer id> is required');
  if (values.manager !== undefined && !ID.test(values.manager)) throw new Error('--manager is a 10-digit id');
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 28) throw new Error('--days is 1–28');
  const actions = values.actions ? values.actions.split(',') : [];
  if (actions.some((a) => !/^\d{1,19}$/.test(a))) throw new Error('--actions is a comma-separated list of ids');
  const credentialFile = process.env['GOOGLE_CREDENTIAL'];
  if (!credentialFile) throw new Error('set GOOGLE_CREDENTIAL to the read credential JSON file');
  const tokens = tokenProviderFor(JSON.parse(readFileSync(credentialFile, 'utf8')));
  const outDir = join(import.meta.dirname, '..', 'fixtures', 'google', 'recorded');
  const result = await recordGoogleFixtures({
    tokens,
    account,
    ...(values.manager === undefined ? {} : { loginCustomerId: values.manager }),
    days,
    conversionActionIds: actions,
    outDir,
  });
  console.log(JSON.stringify({ wrote: outDir, ...result }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'recording failed');
  process.exitCode = 1;
});
