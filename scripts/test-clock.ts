// Vitest setup, for every project (vitest.config.ts `setupFiles`). With TEST_CLOCK_OFFSET_DAYS set, the test
// process's clock runs that many days away from the real one: `new Date()` and `Date.now()` move, time still flows,
// and timers are untouched. CI runs the suite a second time a year ahead (F4, D-097), so a test that mixes a fixed
// fixture date with the real clock fails the day it is written, not months later when its dates pass.
// The database's own clock (`now()` in SQL) doesn't move: code compares database times with database times, and
// the clock the code is given with the clock the code is given.

/** Days to move the clock by: a whole number, or 0 when unset. Anything else is a mistake, and fails loudly. */
export function clockOffsetDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const days = Number(raw);
  if (!Number.isInteger(days)) throw new Error(`TEST_CLOCK_OFFSET_DAYS must be a whole number of days, not "${raw}"`);
  return days;
}

/** A Date class whose "now" is `offsetMs` away from `base`'s. Dates built from a value are unchanged. */
export function shiftedDate(base: DateConstructor, offsetMs: number): DateConstructor {
  class ShiftedDate extends base {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(base.now() + offsetMs);
      else super(...(args as [number]));
    }
    static override now(): number {
      return base.now() + offsetMs;
    }
  }
  return ShiftedDate as DateConstructor;
}

const days = clockOffsetDays(process.env['TEST_CLOCK_OFFSET_DAYS']);
if (days !== 0) globalThis.Date = shiftedDate(globalThis.Date, days * 86_400_000);
