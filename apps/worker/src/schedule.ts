// The worker's schedule (PROPOSAL §5.3, BLUEPRINT M07), in Singapore time: the daily cycle at 06:00 (its digest is
// its last stage, so the digest follows the sync), the weekly cycle on Mondays at 07:00. Only the leader runs it
// (§5.2); each firing queues one job, and the job runner runs every active product's cycle. A cycle is unique per
// product, kind and day, so a duplicate job does nothing. After a restart the leader catches up a run it missed
// earlier the same day.
import { localDate } from '@ads/contracts';
import { Cron } from 'croner';

export const SCHEDULE_TIMEZONE = 'Asia/Singapore';

export type ScheduledJob = 'daily' | 'weekly';

export const SCHEDULES: readonly { job: ScheduledJob; pattern: string }[] = [
  { job: 'daily', pattern: '0 6 * * *' },
  { job: 'weekly', pattern: '0 7 * * 1' },
];

const patternOf = (job: ScheduledJob): string => SCHEDULES.find((s) => s.job === job)?.pattern ?? '';

/** A paused croner job: used for the calculations only (it never fires). */
const calculator = (job: ScheduledJob): Cron => new Cron(patternOf(job), { timezone: SCHEDULE_TIMEZONE, paused: true });

/** The next time `job` fires after `from`. */
export function nextRunOf(job: ScheduledJob, from: Date): Date {
  const cron = calculator(job);
  try {
    const next = cron.nextRun(from);
    if (next === null) throw new Error(`the ${job} schedule has no next run`);
    return next;
  } finally {
    cron.stop();
  }
}

/** The jobs whose last scheduled time is earlier today (Singapore) and not later than `now`: a worker that was down
 *  at 06:00 and starts at 06:30 runs the daily cycle then, not tomorrow. */
export function missedToday(now: Date): ScheduledJob[] {
  const today = localDate(now, SCHEDULE_TIMEZONE);
  return SCHEDULES.filter(({ job }) => {
    const cron = calculator(job);
    try {
      const [previous] = cron.previousRuns(1, now);
      return previous !== undefined && localDate(previous, SCHEDULE_TIMEZONE) === today;
    } finally {
      cron.stop();
    }
  }).map((s) => s.job);
}

export interface Scheduler {
  stop(): void;
}

/** Starts the croner jobs; each firing calls `fire(job)`. Croner's `protect` skips a firing while the previous one
 *  is still running; errors are caught and passed to `onError`. */
export function startScheduler(
  fire: (job: ScheduledJob) => Promise<void>,
  onError: (job: ScheduledJob, error: unknown) => void,
): Scheduler {
  const crons = SCHEDULES.map(
    ({ job, pattern }) =>
      new Cron(pattern, { timezone: SCHEDULE_TIMEZONE, protect: true }, async () => {
        try {
          await fire(job);
        } catch (error) {
          onError(job, error);
        }
      }),
  );
  return {
    stop() {
      for (const c of crons) c.stop();
    },
  };
}
