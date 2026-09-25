#!/usr/bin/env node
// The `ads-gw` CLI. Like every surface, it will only create operator requests (invariant 9). The `credentials`
// commands are setup: they store tokens in the vault and never touch an ad account.
import { readFileSync } from 'node:fs';
import { connect, type Database } from '@ads/db';
import {
  checkCredentialCommand,
  masterKeyFromEnv,
  putCredentialCommand,
  readStdin,
  rotateKeyCommand,
  type CredentialRole,
} from '@ads/vault';
import { Command, InvalidArgumentError, Option } from 'commander';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const productSlug = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) throw new InvalidArgumentError('a product slug, e.g. my-product');
  return value;
};

/** What the commands touch, so tests can supply their own. */
export interface CliDeps {
  env: NodeJS.ProcessEnv;
  readStdin: () => Promise<string>;
  print: (line: string) => void;
  connect: (url: string) => Database;
}

const defaultDeps: CliDeps = {
  env: process.env,
  readStdin: () => readStdin(),
  print: (line) => console.log(line),
  connect: (url) => connect(url, { max: 1, applicationName: 'ads-gw-cli' }),
};

/** This CLI's key: the write master key, which opens write and feedback credentials only. */
const KEY_ENV = 'VAULT_WRITE_KEY';
const ROLES: CredentialRole[] = ['write', 'feedback'];

async function withDatabase<T>(deps: CliDeps, run: (db: Database['db']) => Promise<T>): Promise<T> {
  const url = deps.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const database = deps.connect(url);
  try {
    return await run(database.db);
  } finally {
    await database.close();
  }
}

function credentialsCommand(deps: CliDeps): Command {
  const credentials = new Command('credentials').description('store and check platform tokens in the vault');
  const roleOption = () => new Option('--role <role>', 'which credential').choices(ROLES).makeOptionMandatory();

  credentials
    .command('put')
    .description(`store a token, read as JSON from stdin (never an argument); needs DATABASE_URL and ${KEY_ENV}`)
    .requiredOption('--account <account>', 'account id, <platform>:<external id>, or external id')
    .addOption(roleOption())
    .action(async (opts: { account: string; role: CredentialRole }) => {
      const masterKey = masterKeyFromEnv(KEY_ENV, 'write', deps.env);
      const tokenText = await deps.readStdin();
      deps.print(
        await withDatabase(deps, (db) =>
          putCredentialCommand(db, { account: opts.account, role: opts.role, tokenText, masterKey }),
        ),
      );
    });

  credentials
    .command('check')
    .description('prove the key opens a stored token (audited); prints only its field names')
    .requiredOption('--account <account>', 'account id, <platform>:<external id>, or external id')
    .addOption(roleOption())
    .action(async (opts: { account: string; role: CredentialRole }) => {
      const masterKey = masterKeyFromEnv(KEY_ENV, 'write', deps.env);
      deps.print(
        await withDatabase(deps, (db) =>
          checkCredentialCommand(db, { account: opts.account, role: opts.role, masterKey }),
        ),
      );
    });

  credentials
    .command('rotate-key')
    .description(`re-wrap every token sealed with ${KEY_ENV} under ${KEY_ENV}_NEW (then make the new key current)`)
    .action(async () => {
      const from = masterKeyFromEnv(KEY_ENV, 'write', deps.env);
      const to = masterKeyFromEnv(`${KEY_ENV}_NEW`, 'write', deps.env);
      deps.print(await withDatabase(deps, (db) => rotateKeyCommand(db, { from, to })));
    });

  return credentials;
}

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command('ads-gw')
    .description('Ads Agent gateway CLI')
    .option('--product <slug>', 'the product to act on', productSlug);

  program
    .command('version')
    .description('print the version')
    .action(() => {
      console.log(`ads-gw ${pkg.version}`);
    });

  program.addCommand(credentialsCommand(deps));

  return program;
}

if (import.meta.main) {
  await buildProgram().parseAsync(process.argv);
}
