// The display formatters every surface shares (F2): golden text in SGD, JPY and USD, and the counting words.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  costPer,
  countOf,
  formatMoney,
  formatSgd,
  formatUsdExact,
  localTime,
  microsPerMinorUnit,
  minorDigits,
  moneyPrefix,
  percentOf,
  stageWord,
} from '../src/index.ts';

describe('formatMoney', () => {
  it('SGD: cents, S$, thousands commas, half away from zero', () => {
    expect(formatMoney(0n, 'SGD')).toBe('S$0.00');
    expect(formatMoney(1_234_567_890n, 'SGD')).toBe('S$1,234.57');
    expect(formatMoney(4_999n, 'SGD')).toBe('S$0.00');
    expect(formatMoney(5_000n, 'SGD')).toBe('S$0.01');
    expect(formatMoney(-2_345_000n, 'SGD')).toBe('-S$2.35');
    expect(formatMoney(-1n, 'SGD')).toBe('S$0.00'); // rounds to zero: no sign
    expect(formatSgd(1_000_000_000_000n)).toBe('S$1,000,000.00');
  });

  it('JPY: whole yen (no minor unit)', () => {
    expect(formatMoney(1_234_500_000n, 'JPY')).toBe('JPY 1,235'); // 1,234.5 yen rounds up
    expect(formatMoney(1_234_499_999n, 'JPY')).toBe('JPY 1,234');
    expect(formatMoney(499_999n, 'JPY')).toBe('JPY 0');
    expect(formatMoney(-2_500_000n, 'JPY')).toBe('-JPY 3');
    expect(formatMoney(1_000_000_000_000n, 'JPY')).toBe('JPY 1,000,000');
  });

  it('USD and other two-decimal currencies: cents, with the code', () => {
    expect(formatMoney(1_234_565_000n, 'USD')).toBe('USD 1,234.57');
    expect(formatMoney(12_300_000n, 'USD')).toBe('USD 12.30');
    expect(formatMoney(5_000n, 'MYR')).toBe('MYR 0.01');
    expect(formatMoney(-12_500_000n, 'MYR')).toBe('-MYR 12.50');
  });

  it('three-decimal currencies keep their third place', () => {
    expect(formatMoney(1_234_500n, 'KWD')).toBe('KWD 1.235');
    expect(minorDigits('kwd')).toBe(3);
  });

  it('the minor-unit table: SGD cents, JPY whole yen, anything unlisted two places', () => {
    expect([minorDigits('SGD'), minorDigits('JPY'), minorDigits('USD'), minorDigits('XYZ')]).toEqual([2, 0, 2, 2]);
    expect([microsPerMinorUnit('SGD'), microsPerMinorUnit('JPY'), microsPerMinorUnit('KWD')]).toEqual([
      10_000n,
      1_000_000n,
      1_000n,
    ]);
    expect([moneyPrefix('SGD'), moneyPrefix('USD'), moneyPrefix('sgd')]).toEqual(['S$', 'USD ', 'S$']);
    expect(formatMoney(1_000_000n, 'jpy')).toBe('JPY 1');
  });

  it('a whole number of minor units prints exactly, in any currency', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.constantFrom('SGD', 'JPY', 'USD', 'KWD'),
        (minor, currency) => {
          const digits = minorDigits(currency);
          const text = formatMoney(minor * microsPerMinorUnit(currency), currency);
          const abs = minor < 0n ? -minor : minor;
          const scale = 10n ** BigInt(digits);
          const number = `${abs / scale}${digits === 0 ? '' : `.${(abs % scale).toString().padStart(digits, '0')}`}`;
          expect(text.replaceAll(',', '')).toBe(`${minor < 0n ? '-' : ''}${moneyPrefix(currency)}${number}`);
        },
      ),
    );
  });
});

describe('formatUsdExact (the AI cost)', () => {
  it('is exact, with at least two decimals', () => {
    expect(formatUsdExact(23_400n)).toBe('US$0.0234');
    expect(formatUsdExact(2_000_000n)).toBe('US$2.00');
    expect(formatUsdExact(1n)).toBe('US$0.000001');
    expect(formatUsdExact(1_234_500_000n)).toBe('US$1,234.50');
  });
});

describe('percentOf and costPer', () => {
  it('divide in bigint: percentages round down, cost per rounds half up', () => {
    expect(percentOf(1n, 3n)).toBe(33);
    expect(percentOf(5n, 0n)).toBeNull();
    expect(costPer(10_000_001n, 2)).toBe(5_000_001n);
    expect(costPer(10n, 0)).toBeNull();
  });
});

describe('countOf and stageWord', () => {
  it('count with a word or a stage id, never a stage label', () => {
    expect(countOf(1, 'signup')).toBe('1 signup');
    expect(countOf(3, 'pool_request')).toBe('3 pool requests');
    expect(countOf(2, 'Clicks')).toBe('2 clicks');
    expect(countOf(3, 'paid')).toBe('3 paid outcomes'); // a state becomes a noun, never "3 paids"
    expect(countOf(1, 'booked')).toBe('1 booked outcome');
    expect(countOf(4, 'qualified_viewing')).toBe('4 qualified viewings');
    expect(countOf(2, 'enquiry')).toBe('2 enquiries');
    expect(countOf(2, 'day')).toBe('2 days');
    expect(countOf(2, 'search')).toBe('2 searches');
    expect(stageWord('signup')).toBe('signup');
    expect(stageWord('paid')).toBe('paid outcome');
  });
});

describe('localTime', () => {
  it("shows a moment as the date and 24-hour time in the product's timezone", () => {
    const at = new Date('2026-10-21T02:00:00Z');
    expect(localTime(at, 'Asia/Singapore')).toBe('2026-10-21 10:00');
    expect(localTime(at, 'UTC')).toBe('2026-10-21 02:00');
    expect(localTime(new Date('2026-10-20T16:30:00Z'), 'Asia/Singapore')).toBe('2026-10-21 00:30'); // not 24:30
  });
});
