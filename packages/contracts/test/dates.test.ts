import { describe, expect, it } from 'vitest';
import { localDate, minusDays } from '../src/index.ts';

describe('dates', () => {
  it('uses the given timezone for "today"', () => {
    const now = new Date('2026-09-30T17:30:00Z');
    expect(localDate(now, 'Asia/Singapore')).toBe('2026-10-01');
    expect(localDate(now, 'UTC')).toBe('2026-09-30');
  });

  it('subtracts calendar days across month and leap-year ends', () => {
    expect(minusDays('2026-03-01', 1)).toBe('2026-02-28');
    expect(minusDays('2028-03-01', 1)).toBe('2028-02-29');
    expect(minusDays('2026-10-01', 27)).toBe('2026-09-04');
    expect(() => minusDays('nope', 1)).toThrow(RangeError);
  });
});
