// The pure step behind POST /api/v2/matches/compare (SPEC nice-to-have 13; DECISIONS pass 47):
// two fresh allocations of the run's delivery requests, direct-only and with relay, side by side.
// Both sides are projections: no trip is reserved from the live plans, nothing has "occurred", and the
// run it is given is never changed. Nothing here reads fs or the store. A place pair that is missing from
// the travel provider throws TravelDataMissingError (the route answers 503); a number is never made up.
import type { CompareResponse } from '../../../shared/v2/api';
import { CompareRequest, type ApiError } from '../../../shared/v2/schemas';
import type { AssignmentResult, Run, TravelProvider } from '../../../shared/v2/types';
import type { MatchContext, MatchMode } from '../../domain/v2/matching';
import { computeMetrics } from '../../domain/v2/metrics';
import { assignStoryFirst } from './storyFirst';

export const INVALID_COMPARE = 'The comparison takes no options. Send an empty JSON object.';

export type CompareResult =
  | { kind: 'invalid'; status: 400; error: ApiError }
  | { kind: 'ok'; response: CompareResponse };

/**
 * Validates `body` as a CompareRequest and compares the two matching modes on the run as it is now.
 * `nowMs` is only the stopwatch for `computeMs` (measured, never hardcoded); everything else in the
 * result depends on `run` and `travel` alone.
 */
export function compareRun(
  run: Run, travel: TravelProvider, body: unknown, nowMs: () => number = () => performance.now(),
): CompareResult {
  if (!CompareRequest.safeParse(body).success) {
    return { kind: 'invalid', status: 400, error: { error: INVALID_COMPARE } };
  }

  const { shipments, employees, businesses, settings } = run.scenario;
  const ctx: MatchContext = { travel, trips: run.trips, employees, businesses, settings };

  // Each side is a full match as Recompute would make it in that mode: story first (storyFirst.ts, #966). So
  // on the default run both sides are those of the 60-employee story (the relay side is the run's own plans),
  // and an added employee is counted only for a request a business sent.
  const side = (mode: MatchMode): CompareResponse['directOnly'] => {
    const startMs = nowMs();
    const result = assignStoryFirst(shipments, ctx, run.scenario, { mode });
    const timed: AssignmentResult = { ...result, computeMs: nowMs() - startMs };
    const metrics = computeMetrics({
      shipments, plans: timed.plans, unmatched: timed.unmatched, occurredEvents: [], settings,
    });
    return { result: timed, metrics };
  };

  return {
    kind: 'ok',
    response: {
      directOnly: side('direct_only'),
      withRelay: side('with_relay'),
    },
  };
}
