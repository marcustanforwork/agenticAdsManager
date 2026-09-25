import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashOf, sha256Hex } from '../src/index.ts';

/** Rebuild an object with its keys inserted in a different order, recursively. */
function shuffleKeys(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, seed));
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const rotated = entries.map((_, i) => entries[(i + seed) % entries.length]!).reverse();
    return Object.fromEntries(rotated.map(([k, v]) => [k, shuffleKeys(v, seed + 1)]));
  }
  return value;
}

const jsonish = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string(),
    fc.boolean(),
    fc.constant(null),
    fc.integer(),
    fc.bigInt(),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
  ),
})).value;

describe('canonicalJson', () => {
  it('is stable regardless of key order (property)', () => {
    fc.assert(
      fc.property(jsonish, fc.nat(10), (value, seed) => {
        expect(canonicalJson(shuffleKeys(value, seed))).toBe(canonicalJson(value));
      }),
    );
  });

  it('sorts keys, drops whitespace, and encodes bigint and Date', () => {
    const value = { b: 1, a: { d: [1, 'x', null], c: true }, m: 1_500_000n, t: new Date('2026-09-25T08:00:00+08:00') };
    expect(canonicalJson(value)).toBe(
      '{"a":{"c":true,"d":[1,"x",null]},"b":1,"m":"1500000","t":"2026-09-25T00:00:00.000Z"}',
    );
  });

  it('matches JSON.stringify on plain JSON with sorted keys', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // fc.jsonValue can produce -0, which JSON prints as 0 either way.
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  it('leaves out undefined properties and nulls undefined array items, like JSON', () => {
    expect(canonicalJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}');
  });

  it('throws on values JSON cannot carry faithfully', () => {
    for (const bad of [NaN, Infinity, new Map(), new Set(), () => 1, Symbol('x'), new Date('nope')]) {
      expect(() => canonicalJson({ x: [bad] })).toThrow(TypeError);
    }
  });
});

describe('sha256Hex / hashOf', () => {
  it('matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes equal values equally, whatever the key order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(hashOf({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});
