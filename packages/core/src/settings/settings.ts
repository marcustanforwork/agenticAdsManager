// Settings (BLUEPRINT §3.3, M05a): one validated document per product. A new product's settings come from its
// pack's defaults plus the core defaults; every read is validated (the schema in the repository, the pack's guard
// layer here), so a bad stored value stops the cycle with an alert instead of being used. Changes arrive only as
// `settings_patch` operator requests (requests/settingsPatch.ts), and every version is kept.
import {
  CORE_GUARD_DEFAULTS,
  GuardLoosenedError,
  PLATFORM_GUARD_DEFAULTS,
  type Platform,
  ProductSettings,
  mergeGuardsTightenOnly,
  type GuardConfig,
  type GuardOverrides,
  type PackManifest,
} from '@ads/contracts';
import {
  InvalidSettingsError,
  enqueueNotification,
  getSettingsHistory,
  schema,
  type DbOrTx,
  type Product,
  type SeedSpec,
} from '@ads/db';
import type { PackRegistry } from '@ads/pack-sdk';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { checkGuardOverridesTightenOnly } from '../requests/settingsPatch.ts';

/** The core's defaults for everything a pack doesn't supply (BLUEPRINT §3.3 comments). */
export const CORE_SETTINGS_DEFAULTS: Omit<ProductSettings, 'outcomes' | 'copy'> = {
  spend: { dailyCeilingMicros: null, monthlyCeilingMicros: null, autoPauseOnMonthlyBreach: false },
  trust: {
    minClicksToJudgeTracking: 30,
    maxOutcomeStalenessHours: 48,
    maxAttributionGapPct: 50,
    minOutcomesForGap: 10,
    minIdCapturePct: 60,
  },
  agent: { analystLookupBudget: 20, autoApproveFeedback: false, feedbackDailyCap: 200 },
  notifications: { digest: 'auto' },
  testTraffic: { emailDomains: [] },
  guardOverrides: {},
  disabledActions: [],
};

/** A new product's settings: the core defaults with the pack's outcomes and copy defaults. The pack's guard
 *  overrides and disabled actions stay a layer of their own (they apply whatever the product sets). */
export function settingsFromPack(manifest: PackManifest): ProductSettings {
  return ProductSettings.parse({
    ...CORE_SETTINGS_DEFAULTS,
    outcomes: manifest.defaults.outcomes,
    copy: manifest.defaults.copy,
  });
}

/** The guard layers below a product's own overrides: the pack's, if its pack is installed. */
export const packGuardLayer = (manifest: PackManifest | null): GuardOverrides => manifest?.guardOverrides ?? {};

/** The effective guards on a platform: the strictest of core, platform, pack and product (tighten-only). */
export const effectiveGuards = (
  settings: ProductSettings,
  manifest: PackManifest | null,
  platform: Platform,
): GuardConfig =>
  mergeGuardsTightenOnly(
    CORE_GUARD_DEFAULTS,
    PLATFORM_GUARD_DEFAULTS[platform],
    packGuardLayer(manifest),
    settings.guardOverrides,
  );

/** The product's pack manifest, or null when no registry was given or the pack isn't installed. */
export const manifestOf = (packs: PackRegistry | undefined, packId: string): PackManifest | null =>
  packs?.has(packId) === true ? packs.get(packId).manifest : null;

/** Checks what the schema can't: the product's guard overrides against every layer below them, the pack's
 *  included. Throws InvalidSettingsError, so a stored document that became invalid (say, a pack update tightened a
 *  guard) is never used. The schema itself is checked when the repository reads the product. */
export function assertSettingsUsable(product: Product, packs: PackRegistry | undefined): void {
  try {
    checkGuardOverridesTightenOnly(product.settings.guardOverrides, packGuardLayer(manifestOf(packs, product.packId)));
  } catch (e) {
    if (!(e instanceof GuardLoosenedError)) throw e;
    throw new InvalidSettingsError(product.id, product.slug, [`guardOverrides.${e.field}: ${e.message}`]);
  }
}

/** Queues an alert that a product's stored settings are invalid (sent by the worker's bot, BLUEPRINT §5.16), unless
 *  one for that product is still waiting to be sent: repeated runs and restarts don't pile up copies. */
export async function alertInvalidSettings(db: DbOrTx, error: InvalidSettingsError): Promise<void> {
  const [waiting] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.productId, error.productId),
        eq(schema.notifications.kind, 'alert'),
        isNull(schema.notifications.sentAt),
        sql`${schema.notifications.payload} ->> 'alert' = 'invalid_settings'`,
      ),
    )
    .limit(1);
  if (waiting !== undefined) return;
  await enqueueNotification(db, {
    productId: error.productId,
    kind: 'alert',
    payload: { alert: 'invalid_settings', product: error.slug, issues: error.issues },
  });
}

/** The seed file with every missing settings document taken from the product's pack (D-076). A product that
 *  lists its own settings keeps them. Throws UnknownPackError for a product whose pack isn't installed and
 *  that lists no settings. */
export function seedSpecFromPacks(raw: unknown, packs: PackRegistry): SeedSpec {
  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as { products?: unknown }).products)) {
    throw new Error('the seed file needs a "products" list');
  }
  const spec = raw as { products: Record<string, unknown>[] };
  return {
    ...(raw as Record<string, unknown>),
    products: spec.products.map((p) =>
      p['settings'] !== undefined ? p : { ...p, settings: settingsFromPack(packs.get(String(p['packId'])).manifest) },
    ),
  } as SeedSpec;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The setting paths whose values differ between two documents (a list counts as one value). */
export function changedPaths(before: unknown, after: unknown, path: string[] = []): string[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => changedPaths(before[k], after[k], [...path, k]));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [path.join('.') || '(all)'];
}

export interface SettingsVersion {
  version: number;
  changedAt: string;
  /** The operator request that made it (null for the seed). */
  requestId: string | null;
  /** What changed from the version before (empty for the first). */
  changed: string[];
}

/** Every version of the product's settings, oldest first, with what each one changed. */
export async function settingsHistory(db: DbOrTx, productId: string): Promise<SettingsVersion[]> {
  const rows = await getSettingsHistory(db, productId);
  return rows.map((row, i) => ({
    version: row.version,
    changedAt: row.changedAt.toISOString(),
    requestId: row.requestId,
    changed: i === 0 ? [] : changedPaths(rows[i - 1]?.settings, row.settings),
  }));
}
