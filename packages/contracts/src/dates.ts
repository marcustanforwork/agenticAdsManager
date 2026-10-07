// Calendar-day helpers for metrics days (YYYY-MM-DD in an ad account's timezone, BLUEPRINT §5.7).

/** The calendar day of `now` in an IANA timezone, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** `day` minus `n` calendar days (pure date arithmetic, no timezone involved). */
export function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  // The round trip refuses impossible days such as 2026-02-30, which Date would roll into March.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) {
    throw new RangeError(`not a date: ${JSON.stringify(day)}`);
  }
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (`to` − `from`; negative when `to` is earlier). Both are YYYY-MM-DD. */
export function daysFrom(from: string, to: string): number {
  // minusDays(…, 0) validates both days the same way.
  const a = Date.parse(`${minusDays(from, 0)}T00:00:00Z`);
  const b = Date.parse(`${minusDays(to, 0)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
