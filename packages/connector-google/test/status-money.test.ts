import { decimalToMicros } from '@ads/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { doubleToMicros, microsFromGoogle, normaliseGoogleStatus } from '../src/index.ts';

describe('normaliseGoogleStatus (BLUEPRINT §5.7)', () => {
  it.each([
    ['ENABLED', 'ELIGIBLE', 'active'],
    ['ENABLED', 'LEARNING', 'active'],
    ['ENABLED', undefined, 'active'],
    ['ENABLED', 'PAUSED', 'paused'],
    ['ENABLED', 'REMOVED', 'removed'],
    ['ENABLED', 'PENDING', 'pending'],
    ['ENABLED', 'LIMITED', 'limited'],
    ['ENABLED', 'NOT_ELIGIBLE', 'limited'],
    ['ENABLED', 'MISCONFIGURED', 'limited'],
    ['ENABLED', 'ENDED', 'limited'],
    ['ENABLED', 'SOMETHING_NEW', 'unknown'],
    ['ENABLED', 'toString', 'unknown'],
    ['PAUSED', 'ELIGIBLE', 'paused'],
    ['REMOVED', undefined, 'removed'],
    ['UNKNOWN', undefined, 'unknown'],
    ['', undefined, 'unknown'],
  ] as const)('%s / %s → %s', (status, primary, expected) => {
    expect(normaliseGoogleStatus(status, primary)).toBe(expected);
  });
});

describe('Google money (property tests)', () => {
  const int64 = fc.bigInt({ min: -9_223_372_036_854_775_808n, max: 9_223_372_036_854_775_807n });

  it('micros strings convert exactly and round-trip', () => {
    fc.assert(fc.property(int64, (m) => microsFromGoogle(m.toString()) === m));
  });

  it('refuses anything but an integer string', () => {
    for (const bad of ['1.5', '1e6', ' 1', '', '0x10', '+1']) expect(() => microsFromGoogle(bad)).toThrow();
  });

  it('a double in currency units becomes the nearest micro, with no float arithmetic', () => {
    // Any amount with at most 6 decimals that a double holds near-exactly converts back to itself.
    const micros = fc.bigInt({ min: 0n, max: 9_000_000_000_000_000n });
    fc.assert(
      fc.property(micros, (m) => {
        const decimal = `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, '0')}`;
        const asDouble = Number(decimal);
        const back = doubleToMicros(asDouble);
        // A double holds any 15-significant-digit decimal exactly enough to round-trip (DBL_DIG = 15), so every
        // amount below 1e9 in currency units (15 digits with 6 decimals) comes back as the same micros.
        if (m < 1_000_000_000_000_000n) expect(back).toBe(m);
        expect(back).toBe(decimalToMicros(asDouble.toFixed(6)));
      }),
    );
    expect(doubleToMicros(0.1 + 0.2)).toBe(300_000n);
    expect(doubleToMicros(12.5)).toBe(12_500_000n);
    expect(() => doubleToMicros(Number.NaN)).toThrow();
    expect(() => doubleToMicros(1e21)).toThrow();
  });
});
