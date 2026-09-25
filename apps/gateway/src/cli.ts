#!/usr/bin/env node
// The `ads-gw` CLI. Like every surface, it will only create operator requests (invariant 9). The `credentials`
// commands are setup: they store tokens in the vault and never touch an ad account.
import { readFileSync } from 'node:fs';
import { credentialsCommand, defaultCliDeps, type CliDeps } from '@ads/vault';
import { Command, InvalidArgumentError } from 'commander';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const productSlug = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) throw new InvalidArgumentError('a product slug, e.g. my-product');
  return value;
};

export type { CliDeps };

export function buildProgram(deps: CliDeps = defaultCliDeps('ads-gw')): Command {
  const program = new Command('ads-gw')
    .description('Ads Agent gateway CLI')
    .option('--product <slug>', 'the product to act on', productSlug);

  program
    .command('version')
    .description('print the version')
    .action(() => {
      console.log(`ads-gw ${pkg.version}`);
    });

  program.addCommand(
    credentialsCommand(deps, { keyEnv: 'VAULT_WRITE_KEY', keyClass: 'write', roles: ['write', 'feedback'] }),
  );

  return program;
}

if (import.meta.main) {
  await buildProgram().parseAsync(process.argv);
}
