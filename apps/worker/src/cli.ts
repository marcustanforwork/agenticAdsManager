#!/usr/bin/env node
// The `ads` CLI. Like every surface, it only creates operator requests (invariant 9): `ads settings set` records a
// settings_patch for the one processor. The `credentials`, `accounts` and `seed` commands are setup, and the
// reads (`sync --dry`, `cycle`, `outcomes`, `findings`) never touch an ad account.
import { readFileSync } from 'node:fs';
import { createModelTracing, dryRunSync, runCycle } from '@ads/core';
import { type Db, NotFoundError, findProductBySlug } from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { accountsCommand } from './accounts.ts';
import { docsCommand } from './docs.ts';
import { findingsCommand } from './findings.ts';
import { type ModelCliDeps, modelCommand } from './model.ts';
import { outcomesCommand } from './outcomes.ts';
import { INSTALLED_PACKS } from './packs.ts';
import { seedCommand, settingsCommand } from './settings.ts';
import { credentialsCommand, defaultCliDeps, masterKeyFromEnv, withDatabase, type CliDeps } from '@ads/vault';
import { Command, InvalidArgumentError, Option } from 'commander';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const productSlug = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) throw new InvalidArgumentError('a product slug, e.g. my-product');
  return value;
};

/** What the commands touch. `fetch` and `now` replace the network and the clock in tests; `packs` the installed
 *  packs (default INSTALLED_PACKS). */
export interface WorkerCliDeps extends CliDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  packs?: PackRegistry;
  /** `ads model ping` in tests: a mock model and an in-memory trace exporter. */
  model?: ModelCliDeps['model'];
  traceExporter?: ModelCliDeps['traceExporter'];
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
  const withDb = <T>(run: (db: Db) => Promise<T>): Promise<T> => withDatabase(deps, run);
  const packs = deps.packs ?? INSTALLED_PACKS;
  const now = deps.now ?? (() => new Date());

  program.addCommand(accountsCommand(withDb, requireProduct, deps.print));
  program.addCommand(settingsCommand(withDb, requireProduct, { env: deps.env, print: deps.print, packs }));
  program.addCommand(outcomesCommand(withDb, requireProduct, { env: deps.env, print: deps.print, packs, now }));
  program.addCommand(docsCommand(withDb, requireProduct, { env: deps.env, print: deps.print, packs }));
  program.addCommand(seedCommand(withDb, { env: deps.env, print: deps.print, packs }));
  program.addCommand(findingsCommand(withDb, requireProduct, { print: deps.print }));
  program.addCommand(
    modelCommand(withDb, requireProduct, {
      env: deps.env,
      print: deps.print,
      ...(deps.model === undefined ? {} : { model: deps.model }),
      ...(deps.traceExporter === undefined ? {} : { traceExporter: deps.traceExporter }),
    }),
  );

  program
    .command('cycle')
    .description(
      "run today's cycle for the product (sync, the trust check, the detectors, then the analyst), or continue it " +
        'if it was interrupted; prints a JSON summary (counts, ids, the candidate findings and the analysis, never ' +
        'names). Needs DATABASE_URL (the direct connection, not the pooler), VAULT_READ_KEY and, for the analyst, ' +
        "the model's key (e.g. ANTHROPIC_API_KEY); traced to Langfuse when its keys are set. Exits 1 if an account " +
        'failed to sync, the trust check failed or the analysis failed.',
    )
    .addOption(
      new Option('--kind <kind>', 'daily and weekly run once a day; manual any time')
        .choices(['daily', 'weekly', 'manual'])
        .makeOptionMandatory(),
    )
    .addOption(
      new Option('--until <stage>', 'stop after this stage; the cycle stays resumable').choices([
        'synced',
        'trust_checked',
        'detected',
        'analysed',
      ]),
    )
    .action(
      async (opts: {
        kind: 'daily' | 'weekly' | 'manual';
        until?: 'synced' | 'trust_checked' | 'detected' | 'analysed';
      }) => {
        const slug = requireProduct();
        const masterKey = masterKeyFromEnv('VAULT_READ_KEY', 'read', deps.env);
        const tracing = createModelTracing(
          deps.env,
          deps.traceExporter === undefined ? {} : { exporter: deps.traceExporter },
        );
        try {
          await withDb(async (db) => {
            const product = await findProductBySlug(db, slug);
            if (!product) throw new NotFoundError('product', slug);
            const summary = await runCycle(
              {
                db,
                lockUrl: deps.env['DATABASE_URL'] ?? '',
                masterKey,
                process: 'cli',
                ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
                now,
                packs,
                env: deps.env,
                tracing,
                ...(deps.model === undefined ? {} : { model: deps.model }),
              },
              { productId: product.id, kind: opts.kind, ...(opts.until === undefined ? {} : { until: opts.until }) },
            );
            deps.print(JSON.stringify(summary, null, 2));
            if (
              summary.outcome === 'blocked' ||
              summary.sync?.accounts.some((a) => a.outcome === 'error') ||
              summary.trustResult === 'fail' ||
              summary.analysed?.status === 'failed'
            ) {
              process.exitCode = 1;
            }
          });
        } finally {
          // A CLI exits right after: send the buffered spans first.
          await tracing?.shutdown();
        }
      },
    );

  program
    .command('sync')
    .description(
      'read a platform and print what a sync would store (--dry); the real sync runs in `ads cycle`. Needs ' +
        'DATABASE_URL and VAULT_READ_KEY',
    )
    .addOption(new Option('--platform <platform>', 'which platform').choices(['meta', 'google']).makeOptionMandatory())
    .option('--dry', 'read only, store nothing')
    .action(async (opts: { platform: 'meta' | 'google'; dry?: boolean }) => {
      const product = requireProduct();
      if (opts.dry !== true) {
        throw new InvalidArgumentError(
          'only --dry; to sync and store, run a cycle: ads cycle --kind manual --until synced',
        );
      }
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

/** `pnpm --filter @ads/app-worker ads -- …` passes the `--` on; drop it so the flags after it still parse. */
export const withoutLeadingDashes = (argv: string[]): string[] =>
  argv[2] === '--' ? [...argv.slice(0, 2), ...argv.slice(3)] : argv;

if (import.meta.main) {
  await buildProgram().parseAsync(withoutLeadingDashes(process.argv));
}
