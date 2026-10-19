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

/** Makes text safe to sit inside a markdown-lite line: no line breaks, no `**`, and not read as a heading or bullet.
 *  Used for anything that comes from an ad platform (entity names) before it goes into a report line. */
export function plainText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').replaceAll('**', '*').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
