// The idempotent seed: products with their settings, offerings, and system flags.
// The data is a file outside shared code (products/seed.json), so no product names live in this package.
// Existing rows are never overwritten: re-running the seed can't undo a change Marcus made later.
import { ProductSettings } from '@ads/contracts';
import { z } from 'zod';
import type { DbOrTx } from './client.ts';
import { systemFlags } from './schema.ts';
import { createProduct, ensureOffering, findProductBySlug } from './repos/products.ts';

export const SeedSpec = z.object({
  products: z.array(
    z.object({
      slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
      name: z.string().min(1),
      packId: z.string().min(1),
      status: z.enum(['active', 'halted', 'dormant']),
      settings: ProductSettings,
      offerings: z.array(z.object({ kind: z.string(), key: z.string(), name: z.string() })).default([]),
    }),
  ),
  flags: z.record(z.string(), z.unknown()).default({}),
});
export type SeedSpec = z.infer<typeof SeedSpec>;

export interface SeedReport {
  productsCreated: string[];
  offeringsEnsured: number;
  flagsCreated: string[];
}

export async function seed(db: DbOrTx, spec: unknown): Promise<SeedReport> {
  const parsed = SeedSpec.parse(spec);
  return db.transaction(async (tx) => {
    const report: SeedReport = { productsCreated: [], offeringsEnsured: 0, flagsCreated: [] };
    for (const p of parsed.products) {
      let product = await findProductBySlug(tx, p.slug);
      if (!product) {
        product = await createProduct(tx, p);
        report.productsCreated.push(p.slug);
      }
      for (const o of p.offerings) {
        await ensureOffering(tx, { productId: product.id, ...o });
        report.offeringsEnsured++;
      }
    }
    for (const [key, value] of Object.entries(parsed.flags)) {
      const rows = await tx
        .insert(systemFlags)
        .values({ key, value })
        .onConflictDoNothing()
        .returning({ key: systemFlags.key });
      if (rows.length > 0) report.flagsCreated.push(key);
    }
    return report;
  });
}
