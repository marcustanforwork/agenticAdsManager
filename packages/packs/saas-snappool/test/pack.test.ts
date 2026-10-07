// The SnapPool pack as a whole: it passes definePack, its thresholds are monotonic, its fact JSON Schema agrees
// with zod, and its phases follow SnapPool's pricing phases.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { FindingTypeId } from '@ads/contracts';
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
import { SnapPoolFacts, detectPhase, manifest, pack } from '../src/index.ts';

describe('the SnapPool pack', () => {
  it('passes definePack and loads through a registry', () => {
    expect(createRegistry([pack]).get('saas-snappool')).toBe(pack);
    expect(pack.manifest.defaults.outcomes.primaryKpiStage).toBe('signup');
    expect(pack.manifest.defaults.outcomes.stages.map((s) => [s.id, s.tier])).toEqual([
      ['pool_request', 'soft'],
      ['signup', 'success'],
      ['activated', 'success'],
      ['paid', 'hard'],
    ]);
    expect(pack.manifest.defaults.outcomes.feedback).toEqual([
      { stage: 'pool_request', platform: 'meta', destinationId: null, eventName: 'Lead' },
      { stage: 'signup', platform: 'meta', destinationId: null, eventName: 'CompleteRegistration' },
      { stage: 'signup', platform: 'google', destinationId: null },
    ]);
  });

  it('fails definePack with a looser guard override', () => {
    expect(() => definePack({ ...pack, manifest: { ...manifest, guardOverrides: { maxAppliedPerDay: 50 } } })).toThrow(
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
      features: ['One shared photo pool per event'],
      eventTypes: ['wedding'],
      plans: [{ id: 'free', name: 'Free', priceMicros: null, limits: { guests: 100 } }],
      pricing: { phase: 'beta', currency: 'SGD' },
    };
    const samples: unknown[] = [
      good,
      { ...good, pricing: { phase: 'beta', currency: 'SGD', notes: 'Free during beta' } },
      { ...good, features: [] },
      { ...good, pricing: { phase: 'launch', currency: 'SGD' } },
      { ...good, pricing: { phase: 'beta', currency: 'sgd' } },
      { ...good, plans: [{ id: 'Pro', name: 'Pro', priceMicros: '19900000', limits: {} }] },
      { ...good, plans: [{ id: 'pro', name: 'Pro', priceMicros: 19.9, limits: {} }] },
      { ...good, plans: [{ id: 'pro', name: 'Pro', priceMicros: '19900000', limits: { guests: -1 } }] },
      { ...good, eventTypes: undefined },
      {},
    ];
    for (const s of samples) expect([s, validate(s)]).toEqual([s, SnapPoolFacts.safeParse(s).success]);
    fc.assert(
      fc.property(fc.jsonValue(), (s) => {
        expect(validate(s)).toBe(SnapPoolFacts.safeParse(s).success);
      }),
      { numRuns: 300 },
    );
  });

  it('detects the phase from the facts, else beta until the signup window closes', () => {
    const ctx = (now: string, facts: Record<string, unknown> = {}) => ({
      now: new Date(now),
      facts,
      firstSpendAt: null,
      spendLast30dMicros: 0n,
    });
    expect(detectPhase(ctx('2026-11-30T15:59:59Z'))).toBe('beta');
    expect(detectPhase(ctx('2026-11-30T16:00:00Z'))).toBe('standard');
    expect(detectPhase(ctx('2026-12-15T00:00:00Z', { pricing: { phase: 'promo' } }))).toBe('promo');
    expect(detectPhase(ctx('2026-10-15T00:00:00Z', { pricing: { phase: 'nonsense' } }))).toBe('beta');
    expect(manifest.phases.map((p) => p.id)).toEqual(['beta', 'promo', 'standard']);
  });
});
