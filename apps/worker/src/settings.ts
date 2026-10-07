// `ads settings …` and `ads seed`. Reading is direct; a change is a `settings_patch` operator request, recorded
// and processed by the one processor (invariant 9), so it's validated like a change from Telegram or the dashboard.
import { userInfo } from 'node:os';
import { actorsFromEnv, seedSpecFromPacks, settingsHistory, submitRequest } from '@ads/core';
import {
  InvalidSettingsError,
  NotFoundError,
  findProductBySlug,
  getSettingsHistory,
  getStoredSettings,
  seed,
  type Db,
} from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { withDocFiles } from './seedDocs.ts';
import { Command, InvalidArgumentError, Option } from 'commander';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Who the CLI acts as: `cli:<ADS_OPERATOR or the login name>`. It must be listed in OPERATOR_ACTORS. */
export const cliActor = (env: NodeJS.ProcessEnv): string => `cli:${env['ADS_OPERATOR'] ?? userInfo().username}`;

export const DEFAULT_SEED_FILE = fileURLToPath(new URL('../../../products/seed.json', import.meta.url));

/** The product's id and current settings version, even when its stored settings are invalid (so they can be
 *  repaired with a patch). */
async function productRef(db: Db, slug: string): Promise<{ id: string; version: number }> {
  try {
    const product = await findProductBySlug(db, slug);
    if (!product) throw new NotFoundError('product', slug);
    return { id: product.id, version: product.settingsVersion };
  } catch (e) {
    if (!(e instanceof InvalidSettingsError)) throw e;
    const stored = await getStoredSettings(db, e.productId);
    return { id: e.productId, version: stored.version };
  }
}

function parsePatch(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidArgumentError('the patch is not valid JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidArgumentError(
      'the patch must be a JSON object, e.g. {"spend": {"dailyCeilingMicros": "20000000"}}',
    );
  }
  return value as Record<string, unknown>;
}

export interface SettingsCliDeps {
  env: NodeJS.ProcessEnv;
  print: (line: string) => void;
  packs: PackRegistry;
}

export function settingsCommand(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  product: () => string,
  deps: SettingsCliDeps,
): Command {
  const settings = new Command('settings').description("read or change the product's settings (needs DATABASE_URL)");

  settings
    .command('get')
    .description('print the settings as JSON (the current version, or an older one)')
    .option('--version <n>', 'an older version', (v) => {
      if (!/^\d+$/.test(v)) throw new InvalidArgumentError('a version number');
      return Number(v);
    })
    .action(async (opts: { version?: number }) => {
      const slug = product();
      const out = await withDb(async (db) => {
        const ref = await productRef(db, slug);
        const history = await getSettingsHistory(db, ref.id);
        const want = opts.version ?? ref.version;
        const row = history.find((h) => h.version === want);
        if (!row) throw new NotFoundError(`${slug} settings version`, String(want));
        return { product: slug, version: row.version, current: row.version === ref.version, settings: row.settings };
      });
      deps.print(JSON.stringify(out, null, 2));
    });

  settings
    .command('set')
    .description(
      'change settings with a JSON patch: objects merge key by key, anything else replaces (null unsets). ' +
        'Recorded as a settings_patch request for OPERATOR_ACTORS; prints the new version or why it was refused',
    )
    .addOption(new Option('--patch <json>', 'the patch as JSON').conflicts('file'))
    .addOption(new Option('--file <path>', 'read the patch from a JSON file'))
    .option('--base-version <n>', 'refuse unless the settings are still at this version (default: the current one)')
    .action(async (opts: { patch?: string; file?: string; baseVersion?: string }) => {
      const slug = product();
      if (opts.patch === undefined && opts.file === undefined) throw new InvalidArgumentError('--patch or --file');
      const patch = parsePatch(opts.patch ?? (await readFile(opts.file ?? '', 'utf8')));
      if (opts.baseVersion !== undefined && !/^\d+$/.test(opts.baseVersion)) {
        throw new InvalidArgumentError('--base-version: a version number');
      }
      const result = await withDb(async (db) => {
        const ref = await productRef(db, slug);
        const baseVersion = opts.baseVersion === undefined ? ref.version : Number(opts.baseVersion);
        const { id, outcome } = await submitRequest(
          db,
          {
            request: { kind: 'settings_patch', productId: ref.id, baseVersion, patch },
            actor: cliActor(deps.env),
            channel: 'cli',
          },
          { actors: actorsFromEnv(deps.env['OPERATOR_ACTORS']), packs: deps.packs },
        );
        return { product: slug, request: id, status: outcome.status, ...outcome.result };
      });
      deps.print(JSON.stringify(result, null, 2));
      if (result.status !== 'done') process.exitCode = 1;
    });

  settings
    .command('history')
    .description('list every settings version: when, by which request, and what changed')
    .action(async () => {
      const slug = product();
      const history = await withDb(async (db) => settingsHistory(db, (await productRef(db, slug)).id));
      deps.print(JSON.stringify({ product: slug, versions: history }, null, 2));
    });

  return settings;
}

/** `ads seed [file]`: the idempotent seed (M01a), with each product's missing settings taken from its pack's
 *  defaults (M05a) and its first documents from `products/<slug>/*.md` (M05b). Existing rows are never
 *  overwritten. */
export function seedCommand(withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>, deps: SettingsCliDeps): Command {
  return new Command('seed')
    .description(
      'create the products (settings from their packs), their offerings, their documents and the system flags, ' +
        'if missing',
    )
    .argument('[file]', 'the seed file', DEFAULT_SEED_FILE)
    .action(async (file: string) => {
      const spec = await withDocFiles(seedSpecFromPacks(JSON.parse(await readFile(file, 'utf8')), deps.packs), file);
      deps.print(JSON.stringify(await withDb((db) => seed(db, spec))));
    });
}
