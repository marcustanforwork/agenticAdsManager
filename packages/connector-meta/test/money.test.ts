import { microsToMetaMinor } from '@ads/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UnsupportedCurrencyError, currencyOffset, minorStringToMicros, unitsStringToMicros } from '../src/index.ts';

/** Every amount whose micros fit in int64 (the `bigint` column). */
const cents = fc.bigInt({ min: 0n, max: 9_223_372_036_854_775_807n / 10_000n });

describe('Meta money conversion (property tests)', () => {
  it('minor units → micros is exact and round-trips', () => {
    fc.assert(
      fc.property(cents, (c) => {
        const micros = minorStringToMicros(c.toString(), 'SGD');
        expect(micros).toBe(c * 10_000n);
        expect(microsToMetaMinor(micros, currencyOffset('SGD'))).toBe(c);
      }),
    );
  });

  it('insights decimal strings → micros is exact for every amount in cents', () => {
    fc.assert(
      fc.property(cents, (c) => {
        const text = `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
        expect(unitsStringToMicros(text)).toBe(c * 10_000n);
      }),
    );
  });

  it('a budget and the same amount reported as spend agree', () => {
    fc.assert(
      fc.property(cents, (c) => {
        const asSpend = `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
        expect(minorStringToMicros(c.toString(), 'SGD')).toBe(unitsStringToMicros(asSpend));
      }),
    );
  });

  it('rejects anything that is not an exact amount', () => {
    for (const bad of ['1.5', '1e3', ' 12', '', '-', '12a'])
      expect(() => minorStringToMicros(bad, 'SGD')).toThrow(RangeError);
    for (const bad of ['1e3', '.5', '1.', '1,000.00', '1.2345678'])
      expect(() => unitsStringToMicros(bad)).toThrow(RangeError);
  });

  it('refuses an amount whose micros would overflow int64, instead of wrapping', () => {
    expect(() => minorStringToMicros('922337203685478', 'SGD')).toThrow(/int64/);
  });

  it('refuses a currency whose offset is not confirmed, instead of guessing', () => {
    expect(() => minorStringToMicros('100', 'JPY')).toThrow(UnsupportedCurrencyError);
    expect(currencyOffset('SGD')).toBe(100n);
  });
});
