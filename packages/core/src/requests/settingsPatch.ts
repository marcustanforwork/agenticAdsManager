// settings_patch (BLUEPRINT §3.8): a partial settings document merged onto the current one, then validated.
//
// Merge rule: plain objects merge key by key; everything else (a value, an array, null) replaces what was there.
// So `{ spend: { dailyCeilingMicros: "20000000" } }` changes one field, `{ copy: { bannedPhrases: [] } }` replaces
// the list, and `{ spend: { dailyCeilingMicros: null } }` unsets the ceiling.
import {
  CORE_GUARD_DEFAULTS,
  PLATFORM_GUARD_DEFAULTS,
  Platform,
  ProductSettings,
  mergeGuardsTightenOnly,
  type GuardOverrides,
} from '@ads/contracts';

/** Why a patch can't be applied; the processor shows `message` to Marcus. */
export class SettingsPatchError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}: ${issues.join('; ')}` : message);
    this.name = 'SettingsPatchError';
    this.issues = issues;
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base: unknown, patch: unknown, path: string[]): unknown {
  if (!isPlainObject(patch) || !isPlainObject(base)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) throw new SettingsPatchError(`not a setting: ${[...path, key].join('.')}`);
    out[key] = merge(base[key], value, [...path, key]);
  }
  return out;
}

/** Keys present in `input` that validation dropped (zod strips unknown keys silently): they aren't settings or
 *  facts, usually a typo. Objects inside lists are compared item by item (`unitMix.0.size`). */
export function unknownPaths(input: unknown, parsed: unknown, path: string[] = []): string[] {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((item, i) => unknownPaths(item, parsed[i], [...path, String(i)]));
  }
  if (!isPlainObject(input) || !isPlainObject(parsed)) return [];
  return Object.keys(input).flatMap((key) =>
    key in parsed ? unknownPaths(input[key], parsed[key], [...path, key]) : [[...path, key].join('.')],
  );
}

/** The product's guard overrides must be tighten-only against every layer below them: the core defaults, each
 *  platform's defaults, and the pack's overrides (M05a). */
export function checkGuardOverridesTightenOnly(overrides: GuardOverrides, packOverrides: GuardOverrides = {}): void {
  for (const platform of Platform.options) {
    mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, PLATFORM_GUARD_DEFAULTS[platform], packOverrides, overrides);
  }
}

/** Returns the new, validated settings. Throws SettingsPatchError (invalid or unknown settings) or
 *  GuardLoosenedError (a guard override looser than the defaults or the pack's overrides). */
export function applySettingsPatch(
  current: unknown,
  patch: Record<string, unknown>,
  packOverrides: GuardOverrides = {},
): ProductSettings {
  const merged = merge(current, patch, []);
  const result = ProductSettings.safeParse(merged);
  if (!result.success) {
    throw new SettingsPatchError(
      'invalid settings',
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const unknown = unknownPaths(merged, result.data);
  if (unknown.length > 0) throw new SettingsPatchError('not a setting', unknown);
  checkGuardOverridesTightenOnly(result.data.guardOverrides, packOverrides);
  return result.data;
}
