// Pure request step for POST /api/v2/simulator/control (DECISIONS pass 47/48): no Express, no store, no timers.
// The clock rules are MVP 1's: `applyControl` in server/clock.ts is reused as it is, because its types
// accept the v2 run's events and settings.
import type { ApiError } from '../../../shared/v2/schemas';
import { SimControlRequest } from '../../../shared/v2/schemas';
import type { Clock, Run } from '../../../shared/v2/types';
import { applyControl } from '../../clock';

export type ControlPlan =
  | { kind: 'invalid'; status: 400; error: string; fieldErrors: Record<string, string> }
  | { kind: 'apply'; clock: Clock };

const invalid = (fieldErrors: Record<string, string>): ControlPlan =>
  ({ kind: 'invalid', status: 400, error: 'Invalid simulator control', fieldErrors });

/** Body of the 400 answer for an `invalid` plan. */
export const controlError = (plan: Extract<ControlPlan, { kind: 'invalid' }>): ApiError =>
  ({ error: plan.error, fieldErrors: plan.fieldErrors });

/**
 * What a control request does to the run's clock. Never mutates `run`; the caller stores `clock`.
 * `play` locks the run and `reset_playback` ("Back to start") returns it to `planning` (#734, which
 * replaces "reset stays locked" of DECISIONS pass 2). No other control changes the phase: pause, seek,
 * next event, jump to morning and finish keep it, so journey playback (seek steps) never locks.
 */
export function planControl(run: Pick<Run, 'clock' | 'events' | 'scenario'>, body: unknown): ControlPlan {
  const parsed = SimControlRequest.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.') || 'body'] ??= issue.message;
    }
    return invalid(fieldErrors);
  }
  const { settings } = run.scenario;
  const req = parsed.data;
  // A seek outside the run is refused, not clamped: "Play journey" needs exact seeks (DECISIONS pass 46).
  if (req.action === 'seek' && (req.timeMin < settings.simStartMin || req.timeMin > settings.simEndMin)) {
    return invalid({ timeMin: `Must be between ${settings.simStartMin} and ${settings.simEndMin}` });
  }
  return { kind: 'apply', clock: applyControl(run.clock, req, run.events, settings) };
}
