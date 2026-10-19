// What the pages read. Settings are read as stored and validated here, so a broken document still shows (with its
// problems) instead of breaking the page; a settings_patch can repair it.
import type { ProductSettings } from '@ads/contracts';
import { schema } from '@ads/db';
import { db } from './server.ts';

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  packId: string;
  currency: string;
  status: 'active' | 'halted' | 'dormant';
  settingsVersion: number;
}

export async function listProductRows(): Promise<ProductRow[]> {
  const p = schema.products;
  return db()
    .select({
      id: p.id,
      slug: p.slug,
      name: p.name,
      packId: p.packId,
      currency: p.currency,
      status: p.status,
      settingsVersion: p.settingsVersion,
    })
    .from(p)
    .orderBy(p.slug);
}

export interface ProductView extends ProductRow {
  stored: unknown;
  settings: ProductSettings | null;
  issues: string[];
}
