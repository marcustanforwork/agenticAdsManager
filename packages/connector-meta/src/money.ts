// Exact Meta money conversion (BLUEPRINT §3.1). Budgets, `spend_cap` and `amount_spent` are integer strings in
// the currency's minor units; insights `spend` and `action_values` are decimal strings in currency units.
import { decimalToMicros, metaMinorToMicros } from '@ads/contracts';

/** Currencies whose Meta offset (minor units per unit) we have confirmed: 100 for each. A currency not listed
 *  here is refused rather than guessed, because a wrong offset scales every amount by 100. To add one, check
 *  Meta's currency table first and record it in GOTCHAS. */
export const CURRENCY_OFFSETS: Readonly<Record<string, bigint>> = {
  SGD: 100n,
  USD: 100n,
  EUR: 100n,
  GBP: 100n,
  AUD: 100n,
  MYR: 100n,
  HKD: 100n,
  NZD: 100n,
  CAD: 100n,
};

export class UnsupportedCurrencyError extends Error {
  constructor(currency: string) {
    super(`Meta currency ${currency} has no confirmed offset; add it to CURRENCY_OFFSETS after checking Meta's table`);
    this.name = 'UnsupportedCurrencyError';
  }
}

export function currencyOffset(currency: string): bigint {
  const offset = CURRENCY_OFFSETS[currency];
  if (offset === undefined) throw new UnsupportedCurrencyError(currency);
  return offset;
}

const MINOR = /^-?\d{1,19}$/;

/** "1500" SGD cents → 15_000_000n micros. Rejects anything but an integer string. */
export function minorStringToMicros(minor: string, currency: string): bigint {
  if (!MINOR.test(minor)) throw new RangeError(`not an integer amount in minor units: ${JSON.stringify(minor)}`);
  return metaMinorToMicros(BigInt(minor), currencyOffset(currency));
}

/** Insights amounts ("12.34", in currency units) → micros, exactly. */
export const unitsStringToMicros = (units: string): bigint => decimalToMicros(units);
