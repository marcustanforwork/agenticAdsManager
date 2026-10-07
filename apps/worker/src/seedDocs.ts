// The product documents `ads seed` starts from: `products/<slug>/STRATEGY.md`, `PLAYBOOK.md` and `LEARNINGS.md`,
// beside the seed file. They become version 1 in the database; after that the database copy is the live one.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProductDocKind, SeedSpec } from '@ads/db';

export const DOC_KINDS = ['strategy', 'playbook', 'learnings'] as const;
/** The seed files beside the seed file: `<slug>/STRATEGY.md`, `PLAYBOOK.md`, `LEARNINGS.md`. */
const fileOf = (doc: ProductDocKind): string => `${doc.toUpperCase()}.md`;

/** The seed spec with each product's documents read from `<seed file's folder>/<slug>/*.md` (those that exist).
 *  A product whose seed entry already lists documents keeps them. */
export async function withDocFiles(spec: SeedSpec, seedFile: string): Promise<SeedSpec> {
  const products = await Promise.all(
    spec.products.map(async (p) => {
      if (Object.keys(p.docs ?? {}).length > 0) return p;
      const docs: Partial<Record<ProductDocKind, string>> = {};
      for (const doc of DOC_KINDS) {
        const path = join(dirname(seedFile), p.slug, fileOf(doc));
        if (existsSync(path)) docs[doc] = await readFile(path, 'utf8');
      }
      return { ...p, docs };
    }),
  );
  return { ...spec, products };
}
