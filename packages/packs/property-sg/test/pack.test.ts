// The Property SG pack as a whole: it passes definePack, its thresholds are monotonic, its fact JSON Schema agrees
// with zod, and its phases follow a project's launch dates.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { FindingTypeId, type LifecycleContext } from '@ads/contracts';
import {
  type Evidence,
  PackDefinitionError,
  createRegistry,
  definePack,
  evaluateEvidence,
  manifestDocument,
} from '@ads/pack-sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PropertyFacts, detectPhase, manifest, pack, singaporeDayStart } from '../src/index.ts';

describe('the Property SG pack', () => {
  it('passes definePack and loads through a registry', () => {
    expect(createRegistry([pack]).get('property-sg')).toBe(pack);
    const { outcomes, copy } = pack.manifest.defaults;
    expect(outcomes.primaryKpiStage).toBe('form_fill');
    expect(outcomes.stages.map((s) => [s.id, s.tier])).toEqual([
      ['form_fill', 'success'],
      ['qualified_viewing', 'hard'],
      ['booked', 'hard'],
    ]);
    expect(outcomes.feedback.every((r) => r.stage === 'form_fill' && r.destinationId === null)).toBe(true);
    expect(pack.manifest.platformPolicy).toEqual({ meta: { specialAdCategories: ['HOUSING'] } });
    expect(copy.tier).toBe('fragments');
    // Placeholders: no real copy contains them, so copy checks fail until Marcus enters the CEA details (T13).
    expect(copy.requiredStrings).toHaveLength(4);
    for (const s of copy.requiredStrings) expect(s).toMatch(/^\[.+\]$/);
  });

  it('fails definePack with a looser guard override', () => {
    expect(() => definePack({ ...pack, manifest: { ...manifest, guardOverrides: { cooldownDays: 1 } } })).toThrow(
      PackDefinitionError,
    );
  });

  it('has a threshold for every finding type, and they are monotonic (property)', () => {
    expect(Object.keys(manifest.thresholds).sort()).toEqual([...FindingTypeId.options].sort());
    const count = fc.integer({ min: 0, max: 50_000 });
    const micros = fc.bigInt({ min: 0n, max: 10n ** 11n });
    const ev = fc.record({
      impressions: count,
      clicks: count,
      spendMicros: micros,
      days: fc.integer({ min: 0, max: 120 }),
    });
    fc.assert(
      fc.property(fc.constantFrom(...FindingTypeId.options), ev, ev, (type, less, extra) => {
        const more: Evidence = {
          impressions: less.impressions + extra.impressions,
          clicks: less.clicks + extra.clicks,
          spendMicros: less.spendMicros + extra.spendMicros,
          days: less.days + extra.days,
        };
        if (evaluateEvidence(less, manifest.thresholds[type]).met) {
          expect(evaluateEvidence(more, manifest.thresholds[type]).met).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('publishes a fact JSON Schema that accepts and rejects the same samples as the zod schema', () => {
    const doc = manifestDocument(manifest);
    const validate = new Ajv2020({ strict: false }).compile(
      (doc.manifest['facts'] as { jsonSchema: Record<string, unknown> }).jsonSchema,
    );
    const good = {
      district: 'D19',
      mrt: [{ station: 'Lakeside', walkMinutes: 4 }],
      psfBand: { minMicros: '2150000000', maxMicros: '2480000000' },
      unitMix: [{ type: '2-bedroom', units: 120, sizeSqftMin: 650, sizeSqftMax: 720 }],
      developer: 'Example Developments',
      top: '2029-06',
      launchDates: { teaser: '2026-10-01', vvip: '2026-11-01', booking: '2026-11-15' },
    };
    const samples: unknown[] = [
      good,
      { district: 'D05', developer: 'Example Developments', launchDates: {} },
      { ...good, district: 'D29' },
      { ...good, district: 'd19' },
      { ...good, top: '2029-13' },
      { ...good, top: 2029 },
      { ...good, psfBand: { minMicros: 2150, maxMicros: '2480000000' } },
      { ...good, launchDates: { booking: '2026-11-31x' } },
      { ...good, launchDates: { booking: '2026-13-01' } },
      { ...good, mrt: [{ station: '' }] },
      { ...good, unitMix: [{ type: '3-bedroom', units: -1 }] },
      { ...good, developer: undefined },
      { ...good, launchDates: undefined },
      {},
    ];
    for (const s of samples) expect([s, validate(s)]).toEqual([s, PropertyFacts.safeParse(s).success]);
    fc.assert(
      fc.property(fc.jsonValue(), (s) => {
        expect(validate(s)).toBe(PropertyFacts.safeParse(s).success);
      }),
      { numRuns: 300 },
    );
  });

  describe('detectPhase', () => {
    const ctx = (now: string, facts: Record<string, unknown> = {}): LifecycleContext => ({
      now: new Date(now),
      facts,
      firstSpendAt: null,
      spendLast30dMicros: 0n,
    });
    const dates = { launchDates: { teaser: '2026-10-01', vvip: '2026-11-01', booking: '2026-11-15' } };

    it.each([
      ['no facts', '2026-12-01T00:00:00Z', {}, 'teaser'],
      ['launch dates not an object', '2026-12-01T00:00:00Z', { launchDates: 'soon' }, 'teaser'],
      ['before every date', '2026-09-01T00:00:00Z', dates, 'teaser'],
      ['after the teaser starts', '2026-10-15T00:00:00Z', dates, 'teaser'],
      ['the VVIP preview', '2026-11-03T00:00:00Z', dates, 'vvip'],
      ['the last second before booking day (Singapore)', '2026-11-14T15:59:59Z', dates, 'vvip'],
      ['booking day starts at 00:00 Singapore time', '2026-11-14T16:00:00Z', dates, 'booking'],
      [
        'clearing',
        '2027-03-01T00:00:00Z',
        { launchDates: { ...dates.launchDates, clearing: '2027-02-01' } },
        'clearing',
      ],
      [
        'a date that is not a day is ignored',
        '2026-11-20T00:00:00Z',
        { launchDates: { vvip: '2026-02-31' } },
        'teaser',
      ],
    ])('%s', (_name, now, facts, phase) => {
      expect(detectPhase(ctx(now, facts))).toBe(phase);
    });

    it('has the four launch phases, in order', () => {
      expect(manifest.phases.map((p) => p.id)).toEqual(['teaser', 'vvip', 'booking', 'clearing']);
    });
  });

  it('reads days in Singapore time, and only real days', () => {
    expect(singaporeDayStart('2026-11-15')?.toISOString()).toBe('2026-11-14T16:00:00.000Z');
    expect(singaporeDayStart('2028-02-29')?.toISOString()).toBe('2028-02-28T16:00:00.000Z');
    expect(singaporeDayStart('2026-02-29')).toBeNull();
    expect(singaporeDayStart('2026-11-15T00:00:00Z')).toBeNull();
    expect(singaporeDayStart('0099-01-01')).toBeNull();
  });
});
