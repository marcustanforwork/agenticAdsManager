#!/usr/bin/env node
// The `ads` CLI. Like every surface, it will only create operator requests (invariant 9). The `credentials`
// commands are setup: they store tokens in the vault and never touch an ad account.
import { readFileSync } from 'node:fs';
import { dryRunSync } from '@ads/core';
import type { DbOrTx } from '@ads/db';
import { accountsCommand } from './accounts.ts';
import { credentialsCommand, defaultCliDeps, masterKeyFromEnv, type CliDeps } from '@ads/vault';
import { Command, InvalidArgumentError, Option } from 'commander';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const productSlug = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) throw new InvalidArgumentError('a product slug, e.g. my-product');
  return value;
};

/** What the commands touch. `fetch` and `now` replace the network and the clock in tests. */
export interface WorkerCliDeps extends CliDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}
export type { CliDeps };

export function buildProgram(deps: WorkerCliDeps = defaultCliDeps('ads')): Command {
  const program = new Command('ads')
    .description('Ads Agent worker CLI')
    .option('--product <slug>', 'the product to act on', productSlug);

  program
    .command('version')
    .description('print the version')
    .action(() => {
      console.log(`ads ${pkg.version}`);
    });

  const requireProduct = (): string => {
    const product = program.opts<{ product?: string }>().product;
    if (product === undefined) throw new InvalidArgumentError('--product <slug> is required');
    return product;
  };
  const withDb = async <T>(run: (db: DbOrTx) => Promise<T>): Promise<T> => {
    const url = deps.env['DATABASE_URL'];
    if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
    const database = deps.connect(url);
    try {
      return await run(database.db);
    } finally {
      await database.close();
    }
  };

  program.addCommand(accountsCommand(withDb, requireProduct, deps.print));

  program
    .command('sync')
    .description(
      'read a platform and print what a sync would store (only --dry until M04); needs DATABASE_URL and VAULT_READ_KEY',
    )
    .addOption(new Option('--platform <platform>', 'which platform').choices(['meta', 'google']).makeOptionMandatory())
    .option('--dry', 'read only, store nothing')
    .action(async (opts: { platform: 'meta' | 'google'; dry?: boolean }) => {
      const product = requireProduct();
      if (opts.dry !== true) throw new InvalidArgumentError('only --dry is available until M04 (the sync stage)');
      const masterKey = masterKeyFromEnv('VAULT_READ_KEY', 'read', deps.env);
      await withDb(async (db) => {
        const report = await dryRunSync({
          db,
          productSlug: product,
          platform: opts.platform,
          masterKey,
          ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
          ...(deps.now === undefined ? {} : { now: deps.now }),
        });
        deps.print(JSON.stringify(report, null, 2));
        if (report.accounts.some((a) => a.outcome === 'error')) process.exitCode = 1;
      });
    });

  program.addCommand(credentialsCommand(deps, { keyEnv: 'VAULT_READ_KEY', keyClass: 'read', roles: ['read'] }));

  return program;
}

if (import.meta.main) {
  await buildProgram().parseAsync(process.argv);
}
