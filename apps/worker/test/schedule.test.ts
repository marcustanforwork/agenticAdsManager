// The schedule in Singapore time (M07): daily 06:00, weekly Monday 07:00; and the same-day catch-up after a restart.
import { describe, expect, it } from 'vitest';
import { missedToday, nextRunOf } from '../src/schedule.ts';

// Singapore is UTC+8 all year (no daylight saving).
const sgt = (local: string): Date => new Date(`${local}+08:00`);

describe('the schedule (SGT)', () => {
  it('runs the daily cycle at 06:00 Singapore time', () => {
    expect(nextRunOf('daily', sgt('2026-10-12T05:59:00'))).toEqual(sgt('2026-10-12T06:00:00'));
    expect(nextRunOf('daily', sgt('2026-10-12T06:00:00'))).toEqual(sgt('2026-10-13T06:00:00'));
    // 06:00 SGT is 22:00 UTC the day before.
    expect(nextRunOf('daily', new Date('2026-10-12T21:30:00Z')).toISOString()).toBe('2026-10-12T22:00:00.000Z');
  });

  it('runs the weekly cycle on Mondays at 07:00 Singapore time', () => {
    // 2026-10-12 is a Monday.
    expect(nextRunOf('weekly', sgt('2026-10-12T06:59:00'))).toEqual(sgt('2026-10-12T07:00:00'));
    expect(nextRunOf('weekly', sgt('2026-10-12T07:00:00'))).toEqual(sgt('2026-10-19T07:00:00'));
    // Sunday 23:30 UTC is already Monday 07:30 in Singapore: the next one is a week on.
    expect(nextRunOf('weekly', new Date('2026-10-11T23:30:00Z'))).toEqual(sgt('2026-10-19T07:00:00'));
    expect(nextRunOf('weekly', sgt('2026-10-14T12:00:00'))).toEqual(sgt('2026-10-19T07:00:00'));
  });

  it('catches up only a run missed earlier the same Singapore day', () => {
    expect(missedToday(sgt('2026-10-12T05:00:00'))).toEqual([]);
    expect(missedToday(sgt('2026-10-12T06:30:00'))).toEqual(['daily']);
    expect(missedToday(sgt('2026-10-12T09:00:00'))).toEqual(['daily', 'weekly']);
    expect(missedToday(sgt('2026-10-13T09:00:00'))).toEqual(['daily']);
    expect(missedToday(sgt('2026-10-13T00:10:00'))).toEqual([]);
  });
});
