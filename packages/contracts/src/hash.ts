import { createHash } from 'node:crypto';
import { z } from 'zod';

export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date(); // a metrics day, in the ad account's timezone

/** Stable JSON: sorted keys, no whitespace, bigint → decimal string, Date → ISO UTC.
 *  Every hash in the system (fingerprints, action hashes, snapshot hashes) is sha256Hex(canonicalJson(x)).
 *  Object properties that are undefined are left out (as JSON does); anything JSON can't represent
 *  faithfully (NaN, Infinity, functions, symbols, Map, Set, class instances) throws. */
export function canonicalJson(value: unknown): string {
  return encode(value, 'value');
}

function encode(value: unknown, path: string): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object': {
      if (value === null) return 'null';
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new TypeError(`canonicalJson: invalid Date at ${path}`);
        return JSON.stringify(value.toISOString());
      }
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => (v === undefined ? 'null' : encode(v, `${path}[${i}]`))).join(',')}]`;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`canonicalJson: unsupported object type at ${path}`);
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const v = record[key];
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${encode(v, `${path}.${key}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The one way to hash a value: sha256Hex(canonicalJson(value)). */
export const hashOf = (value: unknown): string => sha256Hex(canonicalJson(value));
