// The dashboard's fact editor checks facts against the JSON Schema the worker publishes (M10a); the worker checks
// them against the pack's own zod schema. They must agree: the editor rejects anything the pack's schema rejects,
// and accepts what it accepts. Checked here, where both the packs and the published form are at hand.
import { jsonSchemaIssues } from '@ads/contracts';
import { FactsError, validateFacts } from '@ads/core';
import { manifestDocument } from '@ads/pack-sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INSTALLED_PACKS } from '../src/packs.ts';

const manifestOf = (id: string) => INSTALLED_PACKS.get(id).manifest;
const jsonSchemaOf = (id: string) =>
  (manifestDocument(manifestOf(id)).manifest['facts'] as { jsonSchema: Record<string, unknown> }).jsonSchema;

/** The worker's verdict: true when it would store the facts. */
function workerAccepts(packId: string, facts: unknown): boolean {
  try {
    validateFacts(manifestOf(packId), facts as Record<string, unknown>);
    return true;
  } catch (error) {
    if (error instanceof FactsError) return false;
    throw error;
  }
}
const editorAccepts = (packId: string, facts: unknown) => jsonSchemaIssues(jsonSchemaOf(packId), facts).length === 0;

const SNAPPOOL = {
  features: ['Guests upload photos to one shared pool'],
  eventTypes: ['wedding'],
  plans: [{ id: 'free', name: 'Free', priceMicros: null, limits: { guests: 50 } }],
  pricing: { phase: 'beta', currency: 'SGD' },
};
const PROPERTY = {
  district: 'D19',
  developer: 'A Developer',
  launchDates: { teaser: '2026-11-01' },
  mrt: [{ station: 'Serangoon', walkMinutes: 6 }],
  psfBand: { minMicros: '2150000000', maxMicros: '2400000000' },
  unitMix: [{ type: '2-bedroom', units: 40 }],
};

const CASES: [string, unknown, boolean][] = [
  ['saas-snappool', SNAPPOOL, true],
  ['saas-snappool', { ...SNAPPOOL, features: [] }, false],
  ['saas-snappool', { ...SNAPPOOL, features: [''] }, false],
  ['saas-snappool', { ...SNAPPOOL, plans: [{ ...SNAPPOOL.plans[0], id: 'Free Plan' }] }, false],
  ['saas-snappool', { ...SNAPPOOL, plans: [{ ...SNAPPOOL.plans[0], priceMicros: 12.5 }] }, false],
  ['saas-snappool', { ...SNAPPOOL, plans: [{ ...SNAPPOOL.plans[0], priceMicros: '19900000' }] }, true],
  ['saas-snappool', { ...SNAPPOOL, plans: [{ ...SNAPPOOL.plans[0], limits: { guests: 1.5 } }] }, false],
  ['saas-snappool', { ...SNAPPOOL, plans: [{ ...SNAPPOOL.plans[0], limits: { guests: -1 } }] }, false],
  ['saas-snappool', { ...SNAPPOOL, pricing: { phase: 'launch', currency: 'SGD' } }, false],
  ['saas-snappool', { ...SNAPPOOL, pricing: { phase: 'beta', currency: 'sgd' } }, false],
  ['saas-snappool', { ...SNAPPOOL, pricing: { phase: 'beta' } }, false],
  ['saas-snappool', { ...SNAPPOOL, colour: 'blue' }, false],
  ['saas-snappool', { ...SNAPPOOL, plans: [{ ...SNAPPOOL.plans[0], extra: 1 }] }, false],
  ['property-sg', PROPERTY, true],
  ['property-sg', { district: 'D05', developer: 'X', launchDates: {} }, true],
  ['property-sg', { ...PROPERTY, district: 'D29' }, false],
  ['property-sg', { ...PROPERTY, launchDates: { teaser: '2026-13-01' } }, false],
  ['property-sg', { ...PROPERTY, mrt: Array.from({ length: 7 }, () => ({ station: 'S' })) }, false],
  ['property-sg', { ...PROPERTY, mrt: [{ station: 'S', walkMinutes: 61 }] }, false],
  ['property-sg', { ...PROPERTY, psfBand: { minMicros: '2,150' } }, false],
  ['property-sg', { ...PROPERTY, unitMix: [{ units: 3 }] }, false],
  ['property-sg', { ...PROPERTY, top: '2027-1' }, false],
  ['property-sg', { ...PROPERTY, developer: undefined }, false],
  ['property-sg', { ...PROPERTY, launchDates: { teaser: '2026-11-01', soft: '2026-11-02' } }, false],
];

describe('the fact editor and the pack agree (M10a)', () => {
  it.each(CASES)('%s: %j → accepted %s', (packId, facts, accepted) => {
    expect(workerAccepts(packId, facts)).toBe(accepted);
    expect(editorAccepts(packId, facts)).toBe(accepted);
  });

  it('on generated facts too: the editor never accepts what the pack rejects, nor the reverse', () => {
    const text = fc.oneof(fc.constantFrom('', 'D19', 'D00', '2026-11-01', 'beta', 'SGD', 'free', 'Free'), fc.string());
    const leaf = fc.oneof(text, fc.integer({ min: -5, max: 100 }), fc.double(), fc.boolean(), fc.constant(null));
    const value = fc.oneof(leaf, fc.array(leaf, { maxLength: 3 }), fc.dictionary(text, leaf, { maxKeys: 3 }));
    const property = fc.record(
      {
        district: text,
        developer: text,
        launchDates: fc.dictionary(fc.constantFrom('teaser', 'vvip', 'x'), text),
        top: text,
        mrt: value,
      },
      { requiredKeys: [] },
    );
    const snappool = fc.record(
      {
        features: fc.array(text, { maxLength: 2 }),
        eventTypes: fc.array(text, { maxLength: 2 }),
        plans: value,
        pricing: value,
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(property, (facts) => editorAccepts('property-sg', facts) === workerAccepts('property-sg', facts)),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(snappool, (facts) => editorAccepts('saas-snappool', facts) === workerAccepts('saas-snappool', facts)),
      { numRuns: 300 },
    );
  });
});
