// `ads docs …` and the product documents the seed starts from (BLUEPRINT M05b). STRATEGY, PLAYBOOK and LEARNINGS
// live in the database, versioned; `products/<slug>/*.md` only seeds version 1. Reading is direct; a change is a
// `product_doc_put` operator request, processed by the one processor (invariant 9).
import { readFile } from 'node:fs/promises';
import { actorsFromEnv, submitRequest } from '@ads/core';
import { NotFoundError, findProductBySlug, getProductDoc, type Db, type ProductDocKind } from '@ads/db';
import { Command, InvalidArgumentError, Option } from 'commander';
import { DOC_KINDS } from './seedDocs.ts';
import { cliActor, type SettingsCliDeps } from './settings.ts';

const docKind = (value: string): ProductDocKind => {
  if (!(DOC_KINDS as readonly string[]).includes(value)) throw new InvalidArgumentError(DOC_KINDS.join(', '));
  return value as ProductDocKind;
};

async function productId(db: Db, slug: string): Promise<string> {
  const product = await findProductBySlug(db, slug);
  if (!product) throw new NotFoundError('product', slug);
  return product.id;
}

export function docsCommand(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  product: () => string,
  deps: SettingsCliDeps,
): Command {
  const docs = new Command('docs').description(
    "read or change the product's documents: strategy, playbook, learnings (needs DATABASE_URL)",
  );

  docs
    .command('get')
    .description('print the latest version of a document (Markdown), e.g. to edit it and `ads docs set` it back')
    .addOption(new Option('--doc <doc>', 'which document').argParser(docKind).makeOptionMandatory())
    .action(async (opts: { doc: ProductDocKind }) => {
      const slug = product();
      const row = await withDb(async (db) => getProductDoc(db, await productId(db, slug), opts.doc));
      if (row === null) throw new NotFoundError(`${slug} ${opts.doc} document`, 'no version yet');
      deps.print(row.markdown);
    });

  docs
    .command('set')
    .description(
      'replace a document with a Markdown file, as a new version. Recorded as a product_doc_put request for ' +
        'OPERATOR_ACTORS; prints the new version or why it was refused',
    )
    .addOption(new Option('--doc <doc>', 'which document').argParser(docKind).makeOptionMandatory())
    .requiredOption('--file <path>', 'the Markdown file')
    .option('--base-version <n>', 'refuse unless the document is still at this version (default: the latest)')
    .action(async (opts: { doc: ProductDocKind; file: string; baseVersion?: string }) => {
      const slug = product();
      if (opts.baseVersion !== undefined && !/^\d+$/.test(opts.baseVersion)) {
        throw new InvalidArgumentError('--base-version: a version number');
      }
      const markdown = await readFile(opts.file, 'utf8');
      const result = await withDb(async (db) => {
        const id = await productId(db, slug);
        const baseVersion =
          opts.baseVersion === undefined
            ? ((await getProductDoc(db, id, opts.doc))?.version ?? 0)
            : Number(opts.baseVersion);
        const { id: request, outcome } = await submitRequest(
          db,
          {
            request: { kind: 'product_doc_put', productId: id, doc: opts.doc, baseVersion, markdown },
            actor: cliActor(deps.env),
            channel: 'cli',
          },
          { actors: actorsFromEnv(deps.env['OPERATOR_ACTORS']), packs: deps.packs },
        );
        return { product: slug, doc: opts.doc, request, status: outcome.status, ...outcome.result };
      });
      deps.print(JSON.stringify(result, null, 2));
      if (result.status !== 'done') process.exitCode = 1;
    });

  return docs;
}
