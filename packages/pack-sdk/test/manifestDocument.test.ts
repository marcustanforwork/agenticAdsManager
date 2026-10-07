// The published manifest: plain JSON, with the fact schema as JSON Schema that agrees with the zod schema.
import { Ajv2020 } from 'ajv/dist/2020.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { definePack, manifestDocument } from '../src/index.ts';
import { testFacts, testPack } from './support.ts';

const samples: unknown[] = [
  { features: ['a'], tier: 'free', priceMicros: null, limits: { guests: 0 } },
  { features: ['a', 'b'], tier: 'pro', priceMicros: '1990000', limits: { guests: 10, days: 3 }, note: 'hi' },
  { features: [], tier: 'free', priceMicros: null, limits: { guests: 0 } },
  { features: [''], tier: 'free', priceMicros: null, limits: { guests: 0 } },
  { features: ['a'], tier: 'gold', priceMicros: null, limits: { guests: 0 } },
  { features: ['a'], tier: 'free', priceMicros: 1990000, limits: { guests: 0 } },
  { features: ['a'], tier: 'free', priceMicros: '1.99', limits: { guests: 0 } },
  { features: ['a'], tier: 'free', limits: { guests: 0 } },
  { features: ['a'], tier: 'free', priceMicros: null, limits: { guests: -1 } },
  { features: ['a'], tier: 'free', priceMicros: null, limits: { guests: 1.5 } },
  { features: ['a'], tier: 'free', priceMicros: null, limits: { guests: 1, days: 0 } },
  { features: ['a'], tier: 'free', priceMicros: null, limits: { guests: 1 }, note: 'x'.repeat(41) },
  { features: ['a'], tier: 'free', priceMicros: null, limits: { guests: 1 }, extra: true },
  null,
  'facts',
  [],
];

describe('manifestDocument', () => {
  const doc = manifestDocument(definePack(testPack()).manifest);
  const validate = new Ajv2020({ strict: false }).compile(
    (doc.manifest['facts'] as { jsonSchema: Record<string, unknown> }).jsonSchema,
  );
  const zodAccepts = (v: unknown) => testFacts.safeParse(v).success;

  it('is plain JSON with the id, version and every manifest part', () => {
    expect(doc.packId).toBe('saas-test');
    expect(doc.version).toBe('1.0.0');
    expect(JSON.parse(JSON.stringify(doc.manifest))).toEqual(doc.manifest);
    expect(Object.keys(doc.manifest).sort()).toEqual(
      [
        'analystContext',
        'briefSections',
        'defaults',
        'disabledActions',
        'facts',
        'guardOverrides',
        'id',
        'phases',
        'platformPolicy',
        'thresholds',
        'version',
      ].sort(),
    );
  });

  it('has a fact JSON Schema that accepts and rejects the same samples as the zod schema', () => {
    for (const sample of samples) expect([sample, validate(sample)]).toEqual([sample, zodAccepts(sample)]);
    // The samples cover both answers. Unknown keys are accepted by both (zod strips them on parse).
    expect(samples.filter(zodAccepts)).toHaveLength(3);
  });

  it('agrees with the zod schema on generated samples too (property)', () => {
    const fact = fc.record(
      {
        features: fc.array(fc.string({ maxLength: 3 }), { maxLength: 3 }),
        tier: fc.constantFrom('free', 'pro', 'gold'),
        priceMicros: fc.oneof(fc.constant(null), fc.constantFrom('0', '1990000', '1.5', ''), fc.integer()),
        limits: fc.record(
          { guests: fc.oneof(fc.integer({ min: -2, max: 5 }), fc.double()), days: fc.integer({ min: -1, max: 3 }) },
          { requiredKeys: ['guests'] },
        ),
        note: fc.string({ maxLength: 45 }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.oneof(fact, fc.jsonValue()), (sample) => {
        expect(validate(sample)).toBe(zodAccepts(sample));
      }),
      { numRuns: 1000 },
    );
  });
});
