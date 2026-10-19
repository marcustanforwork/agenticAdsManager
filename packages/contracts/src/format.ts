// Display formatting shared by every surface (F2): core's digest and brief, the Telegram cards and the dashboard
// print money, counts and times with these, so they say the same thing. Display only: never feed the results back
// into maths (invariant 6: the maths stays in bigint micros).
import { MICROS_PER_UNIT } from './money.ts';

/** ISO 4217 currencies whose minor unit isn't 2 decimal places (list one). Every other currency has 2. Node's Intl
 *  (CLDR) differs for a few display conventions (HUF, IDR, COP… shown without decimals), so this table is explicit. */
const MINOR_DIGITS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

/** Decimal places of a currency's minor unit: SGD 2 (cents), JPY 0 (whole yen), KWD 3. */
export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** Micros in one minor unit: SGD 10_000n (a cent), JPY 1_000_000n (a yen), KWD 1_000n. */
export function microsPerMinorUnit(currency: string): bigint {
  return 10n ** BigInt(6 - minorDigits(currency));
}

/** What goes before an amount: "S$" for SGD (both products' currency), else the code and a space ("USD "). */
export function moneyPrefix(currency: string): string {
  const code = currency.toUpperCase();
  return code === 'SGD' ? 'S$' : `${code} `;
}

const groupThousands = (whole: bigint): string => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "S$1,234.57", "JPY 1,235", "USD 12.30": rounded half away from zero to the currency's minor unit, with
 *  thousands commas; a negative amount starts with "-" ("-S$5.00"). */
export function formatMoney(micros: bigint, currency: string): string {
  const digits = minorDigits(currency);
  const unit = microsPerMinorUnit(currency);
  const negative = micros < 0n;
  const minor = ((negative ? -micros : micros) + unit / 2n) / unit;
  const scale = 10n ** BigInt(digits);
  const frac = digits === 0 ? '' : `.${(minor % scale).toString().padStart(digits, '0')}`;
  return `${negative && minor !== 0n ? '-' : ''}${moneyPrefix(currency)}${groupThousands(minor / scale)}${frac}`;
}

/** Display only: "S$1,234.57" (`formatMoney` in SGD). */
export const formatSgd = (micros: bigint): string => formatMoney(micros, 'SGD');

/** An AI cost in US dollars, exact (the providers bill in USD, D-078; a cycle costs fractions of a cent):
 *  "US$0.0123", "US$1.50" (at least two decimals). */
export function formatUsdExact(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const frac = (abs % MICROS_PER_UNIT).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}US$${groupThousands(abs / MICROS_PER_UNIT)}.${frac}`;
}

/** `part` as a whole percentage of `whole`, rounded down (null when `whole` isn't positive). */
export function percentOf(part: bigint, whole: bigint): number | null {
  return whole > 0n ? Number((part * 100n) / whole) : null;
}

/** Cost per outcome in micros, rounded half up; null without outcomes. */
export function costPer(spendMicros: bigint, outcomes: number): bigint | null {
  if (outcomes <= 0) return null;
  const n = BigInt(outcomes);
  return (spendMicros * 2n + n) / (2n * n);
}

/** A stage id or a plain noun as words: "pool_request" → "pool request"; with `plural`, "pool requests" ("enquiry" →
 *  "enquiries", "search" → "searches"; a word already ending in s is kept). A stage named for a state rather than a
 *  thing ("paid", "booked", "activated") becomes a noun: "paid outcome", "paid outcomes". Never give it a stage
 *  *label*: labels are descriptive phrases ("Signup (email link clicked)") that don't take a plural. */
export function stageWord(word: string, plural = false): string {
  const w = word.replaceAll('_', ' ').toLowerCase();
  if (/(?:ed|\bpaid)$/.test(w)) return plural ? `${w} outcomes` : `${w} outcome`;
  if (!plural || w.endsWith('s')) return w;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return /(?:ch|sh|x|z)$/.test(w) ? `${w}es` : `${w}s`;
}

/** "1 signup" / "3 signups" / "2 pool requests" / "4 paid outcomes" from a stage id or a plain noun (`stageWord`). */
export function countOf(n: number, word: string): string {
  return `${n} ${stageWord(word, n !== 1)}`;
}
