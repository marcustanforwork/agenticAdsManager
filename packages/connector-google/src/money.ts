// Exact Google money conversion (BLUEPRINT §3.1). Google reports money in micros (int64, a string in REST JSON),
// except conversion values, which are doubles in currency units.
import { decimalToMicros } from '@ads/contracts';

const MICROS = /^-?\d{1,19}$/;

/** "1230000" → 1_230_000n. Rejects anything but an integer string. */
export function microsFromGoogle(value: string): bigint {
  if (!MICROS.test(value)) throw new RangeError(`not a micros amount: ${JSON.stringify(value)}`);
  return BigInt(value);
}

/** A double in currency units (Google's `all_conversions_value`) → micros, rounded to the nearest micro. No float
 *  arithmetic: `toFixed(6)` gives the exact decimal expansion of the double Google sent, rounded at 6 places,
 *  which then converts exactly. Values ≥ 1e21 (exponent notation) and non-finite values are refused. */
export function doubleToMicros(value: number): bigint {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite amount: ${value}`);
  return decimalToMicros(value.toFixed(6));
}
