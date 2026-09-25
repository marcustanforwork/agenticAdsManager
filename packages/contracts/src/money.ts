import { z } from 'zod';

/** Money inside code: bigint micros (SGD 1.50 = 1_500_000n).
 *  Money in JSON (jsonb, HTTP, Telegram, AI input/output): a decimal STRING of micros.
 *  Reason: JSON.stringify throws on BigInt, and JSON numbers lose precision above 2^53. */
export const MicrosJson = z.string().regex(/^-?\d{1,19}$/);
export type MicrosJson = z.infer<typeof MicrosJson>;

export const MICROS_PER_UNIT = 1_000_000n;
const INT64_MAX = 9_223_372_036_854_775_807n;
const INT64_MIN = -9_223_372_036_854_775_808n;

function assertInt64(micros: bigint): bigint {
  if (micros > INT64_MAX || micros < INT64_MIN) throw new RangeError(`money out of int64 range: ${micros}`);
  return micros;
}

export const microsFromJson = (s: string): bigint => assertInt64(BigInt(MicrosJson.parse(s)));
export const microsToJson = (m: bigint): string => assertInt64(m).toString();

/** The bigint ⇄ JSON codec: decode a MicrosJson string to bigint, encode a bigint back to the string. */
export const MicrosCodec = z.codec(MicrosJson, z.bigint(), {
  decode: (s) => BigInt(s),
  encode: (m) => m.toString(),
});

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,6}))?$/;

/** Exact conversion of a decimal string in currency units ("12.34", Meta insights spend) to micros.
 *  Accepts at most 6 decimal places. Rejects anything else (exponents, spaces, "+", ".5", "1.", junk):
 *  an inexact or malformed amount is an error, never rounded. */
export function decimalToMicros(decimal: string): bigint {
  const m = DECIMAL.exec(decimal);
  if (!m) throw new RangeError(`not an exact decimal amount: ${JSON.stringify(decimal)}`);
  const [, sign, whole = '0', frac = ''] = m;
  const micros = BigInt(whole) * MICROS_PER_UNIT + BigInt(frac.padEnd(6, '0'));
  return assertInt64(sign === '-' ? -micros : micros);
}

/** Meta budgets are in the currency's minor units: micros = minor * (1_000_000 / offset); SGD offset = 100. */
export function metaMinorToMicros(minor: bigint, currencyOffset: bigint): bigint {
  if (currencyOffset <= 0n || MICROS_PER_UNIT % currencyOffset !== 0n) {
    throw new RangeError(`unsupported currency offset: ${currencyOffset}`);
  }
  return assertInt64(minor * (MICROS_PER_UNIT / currencyOffset));
}

/** Micros → Meta minor units. Throws if the amount isn't a whole number of minor units (never rounds). */
export function microsToMetaMinor(micros: bigint, currencyOffset: bigint): bigint {
  const perMinor = metaMinorToMicros(1n, currencyOffset);
  if (micros % perMinor !== 0n) throw new RangeError(`${micros} micros is not a whole number of minor units`);
  return micros / perMinor;
}

/** Display only: "S$1,234.57". Rounds half away from zero to cents. Never feed the result back into maths. */
export function formatSgd(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const cents = (abs + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${negative && cents !== 0n ? '-' : ''}S$${whole}.${frac}`;
}
