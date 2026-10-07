// The Property SG pack's runtime (BLUEPRINT §3.4): the outcome adapter and the phase detection. Loaded only by the
// worker; may do I/O.
import type { LifecycleContext, PackRuntime } from '@ads/contracts';
import { airtableAdapter } from './airtable.ts';
import { singaporeDayStart } from './days.ts';
import { LAUNCH_PHASES, type LaunchPhase } from './manifest.ts';

/** The project's launch phase from its offering facts (`launchDates`): the last phase, in launch order, whose
 *  start day has come (days start at 00:00 Singapore time). Before any of them, or without dates, teaser.
 *  A date that isn't a real day is ignored. */
export function detectPhase(ctx: LifecycleContext): LaunchPhase {
  const dates = ctx.facts['launchDates'];
  let phase: LaunchPhase = 'teaser';
  if (dates === null || typeof dates !== 'object' || Array.isArray(dates)) return phase;
  for (const p of LAUNCH_PHASES) {
    const day = (dates as Record<string, unknown>)[p];
    const start = typeof day === 'string' ? singaporeDayStart(day) : null;
    if (start !== null && start.getTime() <= ctx.now.getTime()) phase = p;
  }
  return phase;
}

export const runtime: PackRuntime = { outcomeAdapter: (env, settings) => airtableAdapter(env, settings), detectPhase };
