// Records real Meta fixtures (BLUEPRINT M02, the `record-fixture` skill). Read credentials only.
//
//   RECORD=1 META_CREDENTIAL=/path/to/token.json \
//     pnpm --filter @ads/connector-meta record -- --account act_123 [--dataset 456] [--events Lead] [--days 7]
//
// META_CREDENTIAL is the same JSON file given to `ads credentials put --role read`: { accessToken, appSecret }.
// Every exchange is redacted (tokens, appsecret_proof, names, emails) and the files are scanned before they're
// written to fixtures/meta/recorded/. The redacted files are safe to commit; the token file never is.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isRecording } from '@ads/connector-testing';
import { actionTypesForEvents, parseMetaReadCredential } from '../src/index.ts';
import { recordMetaFixtures } from './recordFixtures.ts';

async function main(): Promise<void> {
  if (!isRecording()) throw new Error('set RECORD=1 to call the real Meta API');
  const { values } = parseArgs({
    options: {
      account: { type: 'string' },
      dataset: { type: 'string' },
      events: { type: 'string', default: '' },
      days: { type: 'string', default: '7' },
    },
  });
  const account = values.account ?? '';
  if (!/^act_\d+$/.test(account)) throw new Error('--account act_<digits> is required');
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 28) throw new Error('--days is 1–28');
  const credentialFile = process.env['META_CREDENTIAL'];
  if (!credentialFile) throw new Error('set META_CREDENTIAL to the read token JSON file');
  const { accessToken, appSecret } = parseMetaReadCredential(JSON.parse(readFileSync(credentialFile, 'utf8')));
  const outDir = join(import.meta.dirname, '..', 'fixtures', 'meta', 'recorded');
  const result = await recordMetaFixtures({
    accessToken,
    appSecret,
    account,
    days,
    ...(values.dataset === undefined ? {} : { datasetId: values.dataset }),
    conversionActionTypes: actionTypesForEvents(values.events ? values.events.split(',') : []),
    outDir,
  });
  console.log(JSON.stringify({ wrote: outDir, ...result }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'recording failed');
  process.exitCode = 1;
});
