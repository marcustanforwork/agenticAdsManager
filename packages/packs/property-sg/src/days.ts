// Calendar days in Singapore time. Singapore has no daylight saving, so a day always starts at 00:00 +08:00.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SGT_OFFSET_MS = 8 * 3_600_000;

/** The instant a `YYYY-MM-DD` day starts in Singapore, or null for anything that isn't a real calendar day. */
export function singaporeDayStart(day: string): Date | null {
  const m = DAY.exec(day);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utcMidnight = Date.UTC(y, mo - 1, d);
  const check = new Date(utcMidnight);
  // Date.UTC rolls 2026-02-31 over into March: such a day doesn't exist.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utcMidnight - SGT_OFFSET_MS);
}
