// Helpers for bulk writes.
import type { DbOrTx } from '../client.ts';

/** Rows per statement. Postgres allows at most 65,535 bind parameters per statement; our widest bulk
 *  table has under 20 columns, so 1,000 rows stays well inside that. */
export const BATCH_ROWS = 1_000;

/** Runs `write` over `rows` in batches, all in one transaction (a savepoint if `db` already is one),
 *  so a large write is all-or-nothing. */
export async function inBatches<T>(
  db: DbOrTx,
  rows: T[],
  write: (tx: DbOrTx, batch: T[]) => PromiseLike<unknown>,
  size: number = BATCH_ROWS,
): Promise<void> {
  if (rows.length === 0) return;
  if (rows.length <= size) {
    await write(db, rows);
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += size) await write(tx, rows.slice(i, i + size));
  });
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Exact sum of two non-scientific decimal strings (Postgres numeric values). Missing = 0. */
export function addDecimals(a: string | null | undefined, b: string | null | undefined): string {
  const parse = (x: string) => {
    const m = DECIMAL.exec(x);
    if (!m) throw new RangeError(`not a decimal: ${JSON.stringify(x)}`);
    const [, sign, whole = '0', frac = ''] = m;
    return { sign: sign === '-' ? -1n : 1n, whole, frac };
  };
  const x = parse(a ?? '0');
  const y = parse(b ?? '0');
  const scale = Math.max(x.frac.length, y.frac.length);
  const toInt = (v: { sign: bigint; whole: string; frac: string }) =>
    v.sign * BigInt(v.whole + v.frac.padEnd(scale, '0'));
  const sum = toInt(x) + toInt(y);
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${frac}`;
}
