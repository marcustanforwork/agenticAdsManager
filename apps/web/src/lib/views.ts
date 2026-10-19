// What the pages read. Settings are read as stored and validated here, so a broken document still shows (with its
// problems) instead of breaking the page; a settings_patch can repair it.
import { ProductSettings } from '@ads/contracts';
import { type DbOrTx, schema } from '@ads/db';
import { type SQL, eq } from 'drizzle-orm';
import { db } from './server.ts';

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  packId: string;
  currency: string;
  timezone: string;
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
      timezone: p.timezone,
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
export async function getProductView(slug: string, database: DbOrTx = db()): Promise<ProductView | null> {
  const p = schema.products;
  const [row] = await database
    .select({
      id: p.id,
      slug: p.slug,
      name: p.name,
      packId: p.packId,
      currency: p.currency,
      timezone: p.timezone,
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
export async function requestOrigin(id: string, database: DbOrTx = db()): Promise<string> {
  const r = schema.operatorRequests;
  const [row] = await database
    .select({ payload: r.payload, slug: schema.products.slug })
    .from(r)
    .leftJoin(schema.products, eq(schema.products.id, r.productId))
    .where(eq(r.id, id));
  if (!row) return '/';
  const payload = row.payload as {
    kind?: string;
    offeringKey?: string;
    proposalId?: string;
    revisionId?: string;
    briefId?: string;
    doc?: string;
  };
  const slugOf = async (
    table: typeof schema.proposals | typeof schema.changeLog | typeof schema.briefs,
    where: SQL,
  ) => {
    const [found] = await database
      .select({ slug: schema.products.slug })
      .from(table)
      .innerJoin(schema.products, eq(schema.products.id, table.productId))
      .where(where);
    return found?.slug ?? null;
  };
  const at = (slug: string | null, path: string) => (slug === null ? '/' : `/products/${slug}/${path}`);
  switch (payload.kind) {
    case 'approve':
    case 'reject':
    case 'edit_approve':
      return at(await slugOf(schema.proposals, eq(schema.proposals.id, String(payload.proposalId))), 'proposals');
    case 'undo':
      return at(await slugOf(schema.changeLog, eq(schema.changeLog.revisionId, String(payload.revisionId))), 'changes');
    case 'brief_feedback':
      return at(await slugOf(schema.briefs, eq(schema.briefs.id, String(payload.briefId))), 'briefs');
    case 'product_doc_put':
      return at(row.slug, `docs/${encodeURIComponent(String(payload.doc))}`);
    case 'facts_put':
      if (typeof payload.offeringKey === 'string') {
        return at(row.slug, `facts/${encodeURIComponent(payload.offeringKey)}`);
      }
      return at(row.slug, 'facts');
    default:
      return at(row.slug, 'settings');
  }
}
