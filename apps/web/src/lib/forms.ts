// Reading form fields, and money in forms. Money is entered as a decimal amount in the product's currency
// ("25", "1,250.50") and sent as micros in a decimal string (invariant 6). A value the form can't read is sent as
// typed, so the worker refuses it with a reason the page shows, rather than the form guessing.
import { decimalToMicros, microsFromJson } from '@ads/contracts';

/** Form fields by name: every value given for each (checkbox groups have several). Files are ignored. */
export type Fields = ReadonlyMap<string, readonly string[]>;

export function fieldsOf(entries: Iterable<[string, unknown]>): Fields {
  const out = new Map<string, string[]>();
  for (const [name, value] of entries) {
    if (typeof value !== 'string') continue;
    out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

/** The first value of a field, trimmed; '' when it's missing. */
export const str = (f: Fields, name: string): string => (f.get(name)?.[0] ?? '').trim();
export const all = (f: Fields, name: string): string[] => [...(f.get(name) ?? [])];
export const checked = (f: Fields, name: string): boolean => f.has(name);

/** One item per non-empty line. */
export const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

/** A number as typed: a plain decimal becomes a number; anything else stays text, for the worker to refuse. */
export function num(text: string): number | string {
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

/** An amount typed in currency units → micros as a decimal string. "S$", spaces and thousands commas are allowed.
 *  Anything inexact or malformed stays as typed (the settings schema then refuses it). */
export function moneyToMicros(text: string): string {
  const cleaned = text.replace(/^S\$/i, '').replace(/[\s,]/g, '');
  try {
    return decimalToMicros(cleaned).toString();
  } catch {
    return text;
  }
}

/** Micros (decimal string) → the amount as the form shows it: exact, without trailing zeros ("25", "12.5"). */
export function microsToInput(micros: string | null | undefined): string {
  if (micros === null || micros === undefined || micros === '') return '';
  let m: bigint;
  try {
    m = microsFromJson(micros);
  } catch {
    return micros;
  }
  const negative = m < 0n;
  const abs = negative ? -m : m;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / 1_000_000n}${frac === '' ? '' : `.${frac}`}`;
}
