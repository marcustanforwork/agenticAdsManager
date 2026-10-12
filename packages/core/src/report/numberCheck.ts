// The brief's number check (BLUEPRINT §5.14): every numeric token in the AI's text (amounts, percentages, counts,
// dates) must equal a value in the brief's numbers table, which comes from SQL. One that doesn't means the AI made
// it up or worked it out itself, and the brief falls back to the plain template (invariant 4).

const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
// A minus sign written right before the digits belongs to the number: "-20%" must match -20, not 20.
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_VALUE = /^-?\d+(?:\.\d+)?$/;

/** "1,234.50" → "1234.5"; "007" → "7"; "40.00" → "40"; "-20" stays "-20" (a fall is not a rise); "-0" → "0". */
export function canonicalNumber(token: string): string {
  const negative = token.startsWith('-');
  let t = token.replaceAll(',', '').replace(/^-/, '');
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  t = t.replace(/^0+(?=\d)/, '');
  return negative && t !== '0' ? `-${t}` : t;
}

export interface AllowedValues {
  numbers: ReadonlySet<string>;
  dates: ReadonlySet<string>;
  /** Text values (names, refs) removed from the prose before it is checked: a campaign called "Launch 2026" may be
   *  named without its "2026" counting as a number. */
  names: readonly string[];
}

/** Every value in the numbers table: numbers and numeric strings, dates, and the names the prose may quote. */
export function allowedValues(table: unknown): AllowedValues {
  const numbers = new Set<string>();
  const dates = new Set<string>();
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) numbers.add(canonicalNumber(String(value)));
    else if (typeof value === 'bigint') numbers.add(canonicalNumber(value.toString()));
    else if (typeof value === 'string') {
      if (DATE_VALUE.test(value)) dates.add(value);
      else if (NUMBER_VALUE.test(value)) numbers.add(canonicalNumber(value));
      else if (/\d/.test(value)) names.add(value);
      if (/^\d{4}-\d{2}$/.test(value)) {
        // A month ("2026-10") may be written as is.
        names.add(value);
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  visit(table);
  // Longest first, so a name that contains another is removed whole.
  return { numbers, dates, names: [...names].sort((a, b) => b.length - a.length) };
}

export interface NumberCheckResult {
  ok: boolean;
  /** The tokens that matched nothing in the table (empty when ok). */
  unmatched: string[];
}

export function checkNumbers(text: string, allowed: AllowedValues): NumberCheckResult {
  const unmatched: string[] = [];
  // Whole dates first (a month such as "2026-10" is also a name), then the names, then the numbers left.
  let rest = text.replace(DATE, (date) => {
    if (!allowed.dates.has(date)) unmatched.push(date);
    return ' ';
  });
  for (const name of allowed.names) rest = rest.split(name).join(' ');
  for (const token of rest.match(NUMBER) ?? []) {
    if (!allowed.numbers.has(canonicalNumber(token))) unmatched.push(token);
  }
  return { ok: unmatched.length === 0, unmatched };
}
