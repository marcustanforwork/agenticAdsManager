import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CORE_GUARD_DEFAULTS,
  GuardConfig,
  GuardLoosenedError,
  PLATFORM_GUARD_DEFAULTS,
  mergeGuardsTightenOnly,
  type GuardOverrides,
} from '../src/index.ts';

const guardConfig = fc.record({
  maxBudgetChangePct: fc.integer({ min: 1, max: 100 }),
  minBudgetDeltaMicros: fc.bigInt({ min: 0n, max: 10n ** 12n }).map(String),
  minBudgetDeltaPct: fc.integer({ min: 0, max: 100 }),
  cooldownDays: fc.integer({ min: 0, max: 60 }),
  budgetNeutralByDefault: fc.boolean(),
  maxAppliedPerDay: fc.integer({ min: 0, max: 100 }),
});

/** Is `a` at least as strict as `b` on every guard? */
function atLeastAsStrict(a: GuardConfig, b: GuardConfig): boolean {
  return (
    a.maxBudgetChangePct <= b.maxBudgetChangePct &&
    BigInt(a.minBudgetDeltaMicros) >= BigInt(b.minBudgetDeltaMicros) &&
    a.minBudgetDeltaPct >= b.minBudgetDeltaPct &&
    a.cooldownDays >= b.cooldownDays &&
    (a.budgetNeutralByDefault || !b.budgetNeutralByDefault) &&
    a.maxAppliedPerDay <= b.maxAppliedPerDay
  );
}

/** A random subset of fields from `cfg`, as an override layer. */
const subsetOf = (cfg: GuardConfig) =>
  fc.subarray(Object.keys(cfg) as (keyof GuardConfig)[]).map((keys) => {
    const layer: GuardOverrides = {};
    for (const k of keys) Object.assign(layer, { [k]: cfg[k] });
    return layer;
  });

describe('mergeGuardsTightenOnly', () => {
  it('core defaults are valid, and Meta is tighter than core', () => {
    expect(GuardConfig.parse(CORE_GUARD_DEFAULTS)).toEqual(CORE_GUARD_DEFAULTS);
    expect(mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, PLATFORM_GUARD_DEFAULTS.meta).maxBudgetChangePct).toBe(20);
    expect(mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, PLATFORM_GUARD_DEFAULTS.google)).toEqual(CORE_GUARD_DEFAULTS);
  });

  it('the result is always at least as strict as every layer it accepted (property)', () => {
    fc.assert(
      fc.property(guardConfig, guardConfig, guardConfig, (base, a, b) => {
        const layers = [base, a, b];
        let merged: GuardConfig;
        try {
          merged = mergeGuardsTightenOnly(...layers);
        } catch (e) {
          expect(e).toBeInstanceOf(GuardLoosenedError);
          return;
        }
        for (const layer of layers) expect(atLeastAsStrict(merged, layer)).toBe(true);
      }),
    );
  });

  it('accepts every layer that only tightens, and takes its values (property)', () => {
    fc.assert(
      fc.property(guardConfig, guardConfig, (base, other) => {
        // Build a layer that is strictly the tighter of the two on every field.
        const tighter: GuardConfig = {
          maxBudgetChangePct: Math.min(base.maxBudgetChangePct, other.maxBudgetChangePct),
          minBudgetDeltaMicros: String(
            BigInt(base.minBudgetDeltaMicros) > BigInt(other.minBudgetDeltaMicros)
              ? base.minBudgetDeltaMicros
              : other.minBudgetDeltaMicros,
          ),
          minBudgetDeltaPct: Math.max(base.minBudgetDeltaPct, other.minBudgetDeltaPct),
          cooldownDays: Math.max(base.cooldownDays, other.cooldownDays),
          budgetNeutralByDefault: base.budgetNeutralByDefault || other.budgetNeutralByDefault,
          maxAppliedPerDay: Math.min(base.maxAppliedPerDay, other.maxAppliedPerDay),
        };
        expect(mergeGuardsTightenOnly(base, tighter)).toEqual(tighter);
      }),
    );
  });

  it('rejects any layer that loosens a guard (property)', () => {
    fc.assert(
      fc.property(
        guardConfig.chain((base) => fc.tuple(fc.constant(base), guardConfig.chain(subsetOf))),
        ([base, layer]) => {
          const combined = { ...base, ...layer } as GuardConfig;
          const loosens = !atLeastAsStrict(combined, base);
          if (loosens) {
            expect(() => mergeGuardsTightenOnly(base, layer)).toThrow(GuardLoosenedError);
          } else {
            expect(mergeGuardsTightenOnly(base, layer)).toEqual(combined);
          }
        },
      ),
    );
  });

  it('rejects looser product overrides on top of the Meta default, naming the field', () => {
    const attempt = () =>
      mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, PLATFORM_GUARD_DEFAULTS.meta, {}, { maxBudgetChangePct: 25 });
    expect(attempt).toThrow(GuardLoosenedError);
    expect(attempt).toThrow(/maxBudgetChangePct/);
    expect(() => mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, { budgetNeutralByDefault: false })).toThrow(
      GuardLoosenedError,
    );
    expect(() => mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, { minBudgetDeltaMicros: '4999999' })).toThrow(
      GuardLoosenedError,
    );
  });

  it('rejects an incomplete base and invalid values', () => {
    expect(() => mergeGuardsTightenOnly({ maxBudgetChangePct: 10 })).toThrow();
    expect(() => mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, { cooldownDays: -1 })).toThrow();
    expect(() => mergeGuardsTightenOnly(CORE_GUARD_DEFAULTS, { maxBudgetChangePct: 0 })).toThrow();
  });
});
