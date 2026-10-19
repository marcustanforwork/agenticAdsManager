// What the pages read. Settings are read as stored and validated here, so a broken document still shows (with its
// problems) instead of breaking the page; a settings_patch can repair it.
import { ProductSettings } from '@ads/contracts';
import { schema } from '@ads/db';
import { eq } from 'drizzle-orm';
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

/** A product with its settings as stored, validated here so a broken document still shows with its problems. */
export async function getProductView(slug: string): Promise<ProductView | null> {
  const p = schema.products;
  const [row] = await db()
    .select({
      id: p.id,
      slug: p.slug,
      name: p.name,
      packId: p.packId,
      currency: p.currency,
      status: p.status,
      settingsVersion: p.settingsVersion,
      stored: p.settings,
    })
    .from(p)
    .where(eq(p.slug, slug));
  if (!row) return null;
  const parsed = ProductSettings.safeParse(row.stored);
  return {
    ...row,
    settings: parsed.success ? parsed.data : null,
    issues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export async function listOfferingRows(productId: string) {
  const o = schema.offerings;
  return db()
    .select({
      key: o.key,
      name: o.name,
      kind: o.kind,
      facts: o.facts,
      factsVersion: o.factsVersion,
      updatedAt: o.updatedAt,
    })
    .from(o)
    .where(eq(o.productId, productId))
    .orderBy(o.key);
}

/** Where to go back to after a request: the screen it came from, from the request itself (never from the URL). */
export async function requestOrigin(id: string): Promise<string> {
  const r = schema.operatorRequests;
  const [row] = await db()
    .select({ payload: r.payload, slug: schema.products.slug })
    .from(r)
    .leftJoin(schema.products, eq(schema.products.id, r.productId))
    .where(eq(r.id, id));
  if (!row?.slug) return '/';
  const payload = row.payload as { kind?: string; offeringKey?: string };
  if (payload.kind === 'facts_put' && typeof payload.offeringKey === 'string') {
    return `/products/${row.slug}/facts/${encodeURIComponent(payload.offeringKey)}`;
  }
  return `/products/${row.slug}/settings`;
}
