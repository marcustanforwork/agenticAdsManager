import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MicrosCodec,
  decimalToMicros,
  formatSgd,
  metaMinorToMicros,
  microsFromJson,
  microsToJson,
  microsToMetaMinor,
} from '../src/index.ts';

const INT64_MAX = 9_223_372_036_854_775_807n;
const int64 = fc.bigInt({ min: -INT64_MAX - 1n, max: INT64_MAX });

/** Reference rendering of micros as a decimal string with exactly 6 places. */
function toDecimal(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  return `${neg ? '-' : ''}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0')}`;
}

describe('bigint JSON codec', () => {
  it('round-trips every int64 through JSON', () => {
    fc.assert(
      fc.property(int64, (m) => {
        const json = JSON.stringify({ spend: MicrosCodec.encode(m) });
        const back = MicrosCodec.decode((JSON.parse(json) as { spend: string }).spend);
        expect(back).toBe(m);
        expect(microsFromJson(microsToJson(m))).toBe(m);
      }),
    );
  });

  it('rejects non-integer and out-of-range JSON', () => {
    for (const bad of ['1.5', '', ' 1', '1e6', '+5', '0x10', '99999999999999999999']) {
      expect(() => microsFromJson(bad), bad).toThrow();
    }
    expect(() => microsFromJson('9223372036854775808')).toThrow(RangeError);
  });

  it('JSON.stringify still throws on a raw bigint (why the codec exists)', () => {
    expect(() => JSON.stringify({ spend: 1n })).toThrow(TypeError);
  });
});

describe('decimalToMicros', () => {
  it('is exact for every amount with up to 6 decimals (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (m) => {
        expect(decimalToMicros(toDecimal(m))).toBe(m);
      }),
    );
  });

  it('pads shorter fractions exactly (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 0, max: 99 }), (whole, cents) => {
        const text = `${whole}.${cents.toString().padStart(2, '0')}`;
        expect(decimalToMicros(text)).toBe(whole * 1_000_000n + BigInt(cents) * 10_000n);
      }),
    );
  });

  it('handles Meta-style spend strings', () => {
    expect(decimalToMicros('12.34')).toBe(12_340_000n);
    expect(decimalToMicros('0.1')).toBe(100_000n);
    expect(decimalToMicros('0.000001')).toBe(1n);
    expect(decimalToMicros('-3')).toBe(-3_000_000n);
    expect(decimalToMicros('007.50')).toBe(7_500_000n);
  });

  it('rejects junk and inexact amounts (property)', () => {
    const junk = fc.string().filter((s) => !/^-?\d+(\.\d{1,6})?$/.test(s));
    fc.assert(
      fc.property(junk, (s) => {
        expect(() => decimalToMicros(s)).toThrow(RangeError);
      }),
    );
    for (const bad of [
      '',
      '.5',
      '1.',
      '1.1234567',
      '1e3',
      ' 1',
      '1 ',
      '+1',
      '1,000.00',
      'NaN',
      'Infinity',
      '--1',
      '0x1f',
    ]) {
      expect(() => decimalToMicros(bad), bad).toThrow(RangeError);
    }
  });
});

describe('Meta minor units', () => {
  it('converts SGD cents exactly, both ways (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (cents) => {
        const micros = metaMinorToMicros(cents, 100n);
        expect(micros).toBe(cents * 10_000n);
        expect(microsToMetaMinor(micros, 100n)).toBe(cents);
      }),
    );
  });

  it('refuses to round sub-cent amounts and odd offsets', () => {
    expect(() => microsToMetaMinor(1n, 100n)).toThrow(RangeError);
    expect(() => metaMinorToMicros(1n, 0n)).toThrow(RangeError);
    expect(() => metaMinorToMicros(1n, 7n)).toThrow(RangeError);
    expect(metaMinorToMicros(5n, 1n)).toBe(5_000_000n); // a zero-decimal currency
  });
});

describe('formatSgd', () => {
  it('formats for display', () => {
    expect(formatSgd(0n)).toBe('S$0.00');
    expect(formatSgd(1_500_000n)).toBe('S$1.50');
    expect(formatSgd(1_234_567_890n)).toBe('S$1,234.57');
    expect(formatSgd(500_000_000n)).toBe('S$500.00');
    expect(formatSgd(4_999n)).toBe('S$0.00');
    expect(formatSgd(5_000n)).toBe('S$0.01');
    expect(formatSgd(-2_345_000n)).toBe('-S$2.35');
    expect(formatSgd(-1n)).toBe('S$0.00');
    expect(formatSgd(1_000_000_000_000n)).toBe('S$1,000,000.00');
  });
});
