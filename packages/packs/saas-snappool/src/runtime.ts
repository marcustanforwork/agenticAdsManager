// The SnapPool pack's runtime (BLUEPRINT §3.4): the outcome adapter and the phase detection. Loaded only by the
// worker; may do I/O.
import type { LifecycleContext, PackRuntime } from '@ads/contracts';
import { snapPoolAdapter } from './adapter.ts';
import { PRICING_PHASES } from './manifest.ts';

/** The beta signup window closes at the end of 2026-11-30, Singapore time (SNAPPOOL-TRACKING §1). */
export const BETA_ENDS_AT = new Date('2026-12-01T00:00:00+08:00');

/** SnapPool's pricing phase, as Marcus records it in the offering facts (`pricing.phase`); without it, beta
 *  until the signup window closes, then standard (a promotion is only ever entered from the facts). */
export function detectPhase(ctx: LifecycleContext): string {
  const pricing = ctx.facts['pricing'];
  const phase =
    pricing !== null && typeof pricing === 'object' ? (pricing as Record<string, unknown>)['phase'] : undefined;
  if (typeof phase === 'string' && (PRICING_PHASES as readonly string[]).includes(phase)) return phase;
  return ctx.now < BETA_ENDS_AT ? 'beta' : 'standard';
}

export const runtime: PackRuntime = { outcomeAdapter: snapPoolAdapter, detectPhase };
