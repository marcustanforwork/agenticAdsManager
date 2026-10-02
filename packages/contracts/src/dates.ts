// Calendar-day helpers for metrics days (YYYY-MM-DD in an ad account's timezone, BLUEPRINT §5.7).

/** The calendar day of `now` in an IANA timezone, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** `day` minus `n` calendar days (pure date arithmetic, no timezone involved). */
export function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`not a date: ${JSON.stringify(day)}`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
