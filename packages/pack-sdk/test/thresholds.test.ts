import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Evidence, evaluateEvidence, meetsThreshold } from '../src/index.ts';
import { testManifest } from './support.ts';

const threshold = { minImpressions: 500, minClicks: 20, minSpendMicros: '20000000', minDays: 7 };
const enough: Evidence = { impressions: 500, clicks: 20, spendMicros: 20_000_000n, days: 7 };

describe('the threshold engine', () => {
  it('is met only when every minimum is reached, and names the ones that are not', () => {
    expect(evaluateEvidence(enough, threshold)).toEqual({ met: true, unmet: [], threshold });
    expect(evaluateEvidence({ ...enough, clicks: 19, days: 6 }, threshold)).toMatchObject({
      met: false,
      unmet: ['minClicks', 'minDays'],
    });
    expect(evaluateEvidence({ ...enough, spendMicros: 19_999_999n }, threshold).unmet).toEqual(['minSpendMicros']);
  });

  it('fails closed when the pack sets no threshold for the finding type', () => {
    expect(meetsThreshold(testManifest(), 'cost_spike', enough)).toEqual({
      met: false,
      unmet: ['minImpressions', 'minClicks', 'minSpendMicros', 'minDays'],
      threshold: null,
    });
    expect(meetsThreshold(testManifest(), 'zero_outcome_spend', enough).met).toBe(true);
  });

  it('refuses evidence that is not whole and non-negative', () => {
    expect(() => evaluateEvidence({ ...enough, clicks: 1.5 }, threshold)).toThrow(RangeError);
    expect(() => evaluateEvidence({ ...enough, days: -1 }, threshold)).toThrow(RangeError);
    expect(() => evaluateEvidence({ ...enough, spendMicros: -1n }, threshold)).toThrow(RangeError);
  });

  it('is monotonic: more evidence never fails where less passed (property)', () => {
    const count = fc.integer({ min: 0, max: 100_000 });
    const micros = fc.bigInt({ min: 0n, max: 10n ** 12n });
    const evidence = fc.record({
      impressions: count,
      clicks: count,
      spendMicros: micros,
      days: fc.integer({ min: 0, max: 400 }),
    });
    const more = fc.record({
      impressions: count,
      clicks: count,
      spendMicros: micros,
      days: fc.integer({ min: 0, max: 400 }),
    });
    const t = fc.record({
      minImpressions: count,
      minClicks: count,
      minSpendMicros: micros.map(String),
      minDays: fc.integer({ min: 0, max: 400 }),
    });
    fc.assert(
      fc.property(t, evidence, more, (th, less, extra) => {
        const bigger: Evidence = {
          impressions: less.impressions + extra.impressions,
          clicks: less.clicks + extra.clicks,
          spendMicros: less.spendMicros + extra.spendMicros,
          days: less.days + extra.days,
        };
        const a = evaluateEvidence(less, th);
        const b = evaluateEvidence(bigger, th);
        if (a.met) expect(b.met).toBe(true);
        expect(b.unmet.every((f) => a.unmet.includes(f))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
