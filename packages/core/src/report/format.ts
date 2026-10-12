// Shared formatting for the digest and the brief (M07). Display only: never feed the results back into maths.
// The report text is "Telegram markdown-lite": `# ` and `## ` headings, `- ` bullets and `**bold**`. The worker turns
// it into Telegram HTML (escaping everything else); `briefs.markdown` stores it as is.
import { formatSgd } from '@ads/contracts';
import { microsToDecimal } from '../analyst/refs.ts';

/** "S$1,234.57" for SGD; "<CUR> 1,234.57" for anything else. */
export function formatMoney(micros: bigint, currency: string): string {
  if (currency === 'SGD') return formatSgd(micros);
  const [whole = '0', frac = '00'] = microsToDecimal(micros).split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
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

/** "1 signup" / "3 signups" from a stage label ("Signup", "Paid"). Labels are written by Marcus (trusted). */
export function countOf(n: number, label: string): string {
  const word = label.toLowerCase();
  return `${n} ${n === 1 || word.endsWith('s') ? word : `${word}s`}`;
}

/** Makes text safe to sit inside a markdown-lite line: no line breaks, no `**`, and not read as a heading or bullet.
 *  Used for anything that comes from an ad platform (entity names) before it goes into a report line. */
export function plainText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').replaceAll('**', '*').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
