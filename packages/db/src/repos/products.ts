// Products, settings (optimistic concurrency + full history), product documents, offerings, pack manifests.
import { ProductSettings } from '@ads/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { NotFoundError, StaleVersionError } from '../errors.ts';
import { offerings, packManifests, productDocs, products, settingsHistory, type PRODUCT_STATUSES } from '../schema.ts';

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type ProductRow = typeof products.$inferSelect;
/** A product with its settings validated: settings are checked on every write AND every read. */
export type Product = Omit<ProductRow, 'settings'> & { settings: ProductSettings };

const toProduct = (row: ProductRow): Product => ({ ...row, settings: ProductSettings.parse(row.settings) });

export interface NewProduct {
  slug: string;
  name: string;
  packId: string;
  status?: ProductStatus;
  currency?: string;
  timezone?: string;
  settings: ProductSettings;
}

/** Creates a product at settings version 1, and records that version in settings_history. */
export async function createProduct(db: DbOrTx, input: NewProduct): Promise<Product> {
  const settings = ProductSettings.parse(input.settings);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({ ...input, settings, settingsVersion: 1 })
      .returning();
    if (!row) throw new Error('insert into products returned nothing');
    await tx.insert(settingsHistory).values({ productId: row.id, version: 1, settings, requestId: null });
    return toProduct(row);
  });
}

export async function findProductBySlug(db: DbOrTx, slug: string): Promise<Product | null> {
  const [row] = await db.select().from(products).where(eq(products.slug, slug));
  return row ? toProduct(row) : null;
}

export async function getProduct(db: DbOrTx, id: string): Promise<Product> {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw new NotFoundError('product', id);
  return toProduct(row);
}

export async function listProducts(db: DbOrTx): Promise<Product[]> {
  const rows = await db.select().from(products).orderBy(products.slug);
  return rows.map(toProduct);
}

export async function setProductStatus(db: DbOrTx, id: string, status: ProductStatus): Promise<void> {
  const updated = await db.update(products).set({ status }).where(eq(products.id, id)).returning({ id: products.id });
  if (updated.length === 0) throw new NotFoundError('product', id);
}

/** Replaces the settings document if `baseVersion` is still current; otherwise throws StaleVersionError.
 *  The new version is recorded in settings_history in the same transaction. Returns the new version. */
export async function updateSettings(
  db: DbOrTx,
  input: { productId: string; baseVersion: number; settings: ProductSettings; requestId?: string | null },
): Promise<number> {
  const settings = ProductSettings.parse(input.settings);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ settings, settingsVersion: sql`${products.settingsVersion} + 1` })
      .where(and(eq(products.id, input.productId), eq(products.settingsVersion, input.baseVersion)))
      .returning({ version: products.settingsVersion });
    if (!row) {
      const [current] = await tx
        .select({ version: products.settingsVersion })
        .from(products)
        .where(eq(products.id, input.productId));
      throw new StaleVersionError('settings', input.baseVersion, current?.version ?? null);
    }
    await tx.insert(settingsHistory).values({
      productId: input.productId,
      version: row.version,
      settings,
      requestId: input.requestId ?? null,
    });
    return row.version;
  });
}

export async function getSettingsHistory(db: DbOrTx, productId: string) {
  const rows = await db
    .select()
    .from(settingsHistory)
    .where(eq(settingsHistory.productId, productId))
    .orderBy(settingsHistory.version);
  return rows.map((r) => ({ ...r, settings: ProductSettings.parse(r.settings) }));
}

// ── Product documents (STRATEGY / PLAYBOOK / LEARNINGS), versioned ─────────────────────────────

export type ProductDocKind = 'strategy' | 'playbook' | 'learnings';

export async function getProductDoc(db: DbOrTx, productId: string, doc: ProductDocKind) {
  const [row] = await db
    .select()
    .from(productDocs)
    .where(and(eq(productDocs.productId, productId), eq(productDocs.doc, doc)))
    .orderBy(desc(productDocs.version))
    .limit(1);
  return row ?? null;
}

/** Writes version `baseVersion + 1` (the first version has baseVersion 0). A stale base throws. */
export async function putProductDoc(
  db: DbOrTx,
  input: { productId: string; doc: ProductDocKind; baseVersion: number; markdown: string; requestId?: string | null },
): Promise<number> {
  return db.transaction(async (tx) => {
    // Serialise writers of this product's documents, so two writers on the same base can't both pass.
    await tx.execute(sql`select 1 from ${products} where ${products.id} = ${input.productId} for update`);
    const current = await getProductDoc(tx, input.productId, input.doc);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== input.baseVersion) {
      throw new StaleVersionError(`product doc ${input.doc}`, input.baseVersion, currentVersion);
    }
    const version = currentVersion + 1;
    await tx.insert(productDocs).values({
      productId: input.productId,
      doc: input.doc,
      version,
      markdown: input.markdown,
      requestId: input.requestId ?? null,
    });
    return version;
  });
}

// ── Offerings (the fact base) ─────────────────────────────────────────────────────────────────

export type Offering = typeof offerings.$inferSelect;

/** Inserts the offering if its key is new; an existing one keeps its facts. Returns the row. */
export async function ensureOffering(
  db: DbOrTx,
  input: { productId: string; kind: string; key: string; name: string; facts?: Record<string, unknown> },
): Promise<Offering> {
  await db
    .insert(offerings)
    .values({ ...input, facts: input.facts ?? {} })
    .onConflictDoNothing({ target: [offerings.productId, offerings.key] });
  const row = await findOffering(db, input.productId, input.key);
  if (!row) throw new NotFoundError('offering', input.key);
  return row;
}

export async function findOffering(db: DbOrTx, productId: string, key: string): Promise<Offering | null> {
  const [row] = await db
    .select()
    .from(offerings)
    .where(and(eq(offerings.productId, productId), eq(offerings.key, key)));
  return row ?? null;
}

export async function listOfferings(db: DbOrTx, productId: string): Promise<Offering[]> {
  return db.select().from(offerings).where(eq(offerings.productId, productId)).orderBy(offerings.key);
}

/** Replaces an offering's facts and bumps facts_version. The caller validates them against the pack's
 *  fact schema first (the request processor, BLUEPRINT §5.4). Returns the new facts_version. */
export async function putOfferingFacts(
  db: DbOrTx,
  input: { productId: string; key: string; facts: Record<string, unknown> },
): Promise<number> {
  const [row] = await db
    .update(offerings)
    .set({ facts: input.facts, factsVersion: sql`${offerings.factsVersion} + 1`, updatedAt: sql`now()` })
    .where(and(eq(offerings.productId, input.productId), eq(offerings.key, input.key)))
    .returning({ version: offerings.factsVersion });
  if (!row) throw new NotFoundError('offering', input.key);
  return row.version;
}

// ── Pack manifests (GLOBAL) ───────────────────────────────────────────────────────────────────

/** Publishes a manifest; re-publishing the same pack version replaces it. */
export async function publishPackManifest(
  db: DbOrTx,
  input: { packId: string; version: string; manifest: Record<string, unknown> },
): Promise<void> {
  await db
    .insert(packManifests)
    .values(input)
    .onConflictDoUpdate({
      target: [packManifests.packId, packManifests.version],
      set: { manifest: input.manifest, publishedAt: sql`now()` },
    });
}

export async function getPackManifest(db: DbOrTx, packId: string, version: string) {
  const [row] = await db
    .select()
    .from(packManifests)
    .where(and(eq(packManifests.packId, packId), eq(packManifests.version, version)));
  return row ?? null;
}
