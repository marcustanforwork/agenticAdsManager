// The `credentials` commands, shared by the `ads` and `ads-gw` CLIs (which differ only in the key they hold).
// They are setup: they store tokens in the vault and never touch an ad account.
import { connect, type Database } from '@ads/db';
import { Command, Option } from 'commander';
import { checkCredentialCommand, putCredentialCommand, readStdin, rotateKeyCommand } from './commands.ts';
import { masterKeyFromEnv, type CredentialRole, type KeyClass } from './index.ts';

/** What the commands touch, so tests can supply their own. */
export interface CliDeps {
  env: NodeJS.ProcessEnv;
  readStdin: () => Promise<string>;
  print: (line: string) => void;
  connect: (url: string) => Database;
}

/** The real stdin, console and database; `app` names the connection in pg_stat_activity. */
export const defaultCliDeps = (app: string): CliDeps => ({
  env: process.env,
  readStdin: () => readStdin(),
  print: (line) => console.log(line),
  connect: (url) => connect(url, { max: 1, applicationName: `${app}-cli` }),
});

/** Which key a CLI holds: `ads` has the read key (read credentials); `ads-gw` the write key (write, feedback). */
export interface CredentialsCliSpec {
  keyEnv: string;
  keyClass: KeyClass;
  roles: [CredentialRole, ...CredentialRole[]];
}

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

/** `credentials put | check | rotate-key`. The token is read from stdin only, never from an argument. */
export function credentialsCommand(deps: CliDeps, spec: CredentialsCliSpec): Command {
  const { keyEnv: KEY_ENV, keyClass, roles } = spec;
  const credentials = new Command('credentials').description('store and check platform tokens in the vault');
  const roleOption = () => new Option('--role <role>', 'which credential').choices(roles).makeOptionMandatory();

  credentials
    .command('put')
    .description(`store a token, read as JSON from stdin (never an argument); needs DATABASE_URL and ${KEY_ENV}`)
    .requiredOption('--account <account>', 'account id, <platform>:<external id>, or external id')
    .addOption(roleOption())
    .action(async (opts: { account: string; role: CredentialRole }) => {
      const masterKey = masterKeyFromEnv(KEY_ENV, keyClass, deps.env);
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
      const masterKey = masterKeyFromEnv(KEY_ENV, keyClass, deps.env);
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
      const from = masterKeyFromEnv(KEY_ENV, keyClass, deps.env);
      const to = masterKeyFromEnv(`${KEY_ENV}_NEW`, keyClass, deps.env);
      deps.print(await withDatabase(deps, (db) => rotateKeyCommand(db, { from, to })));
    });

  return credentials;
}
