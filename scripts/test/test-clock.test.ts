import { describe, expect, it } from 'vitest';
import { clockOffsetDays, shiftedDate } from '../test-clock.ts';

const DAY = 86_400_000;

describe('the test clock (F4)', () => {
  it('reads the offset in whole days, 0 when unset, and refuses anything else', () => {
    expect(clockOffsetDays(undefined)).toBe(0);
    expect(clockOffsetDays('')).toBe(0);
    expect(clockOffsetDays('365')).toBe(365);
    expect(clockOffsetDays('-30')).toBe(-30);
    expect(() => clockOffsetDays('1.5')).toThrow(/whole number/);
    expect(() => clockOffsetDays('a year')).toThrow(/whole number/);
  });

  it('moves "now" and only "now": dates built from a value keep it, and time still flows', async () => {
    const Shifted = shiftedDate(Date, 365 * DAY);
    const real = Date.now();
    expect(Shifted.now() - real).toBeGreaterThanOrEqual(365 * DAY);
    expect(Shifted.now() - real).toBeLessThan(365 * DAY + 5_000);
    expect(new Shifted().getTime() - real).toBeGreaterThanOrEqual(365 * DAY);
    expect(new Shifted('2026-10-16T04:00:00Z').toISOString()).toBe('2026-10-16T04:00:00.000Z');
    expect(new Shifted(0).getTime()).toBe(0);
    expect(new Shifted(2026, 9, 16).getFullYear()).toBe(2026);
    expect(new Shifted() instanceof Date).toBe(true);
    const first = Shifted.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(Shifted.now()).toBeGreaterThan(first);
  });
});
