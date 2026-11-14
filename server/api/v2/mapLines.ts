// Route lines the map lacks (DECISIONS pass 57, issue #536).
// Only a live delivery request asks for the lines of its new plan (pass 47). A plan made by a commute
// re-match, Recompute, a new planning cycle, Random city or an import has none, so GET /api/v2/map starts a
// fetch for what its answer lacks. Two pieces:
// - `missingLinePairs`: a pure function, which pairs to ask for and in what order;
// - `createMapLineFetcher`: the rules of one server run (the cap, one fetch at a time, two tries per pair).
// Nothing here is awaited by a request, nothing throws, and nothing is logged: an upstream error message
// could hold the Google key.
import type { RoutePolyline } from '../../../shared/v2/api';
import { pairKey } from '../../../shared/v2/types';
import type { Leg, Run as RunV2 } from '../../../shared/v2/types';

/** At most this many pairs are passed to `ensureLegPolylines` for one map request. */
export const MAP_LINE_PAIRS_PER_REQUEST = 60;
/** A pair is passed to `ensureLegPolylines` at most this often per server run, so a pair Google cannot route is not paid for on every map request. */
export const MAP_LINE_TRIES = 2;

export type LinePair = Pick<RoutePolyline, 'from' | 'to'>;

/** `ensureLegPolylines` of the travel service (server/geo/travelService.ts). The same type as in the delivery routes. */
export type EnsureLegPolylines = (legs: Pick<Leg, 'placeIds'>[]) => Promise<unknown>;

/**
 * The pairs of a map answer that have no route line (`encoded: null`), in the order they are fetched:
 * 1. the neighbouring pairs of every plan leg (plans, legs and places in the run's order);
 * 2. the commute pairs of every employee who carries a plan (in the order of `run.trips`).
 * Each pair once. A commute of an employee with no plan is left out: nothing moves on it.
 */
export function missingLinePairs(
  run: Pick<RunV2, 'trips' | 'assignments'>,
  polylines: readonly RoutePolyline[],
): LinePair[] {
  const missing = new Set<string>();
  for (const line of polylines) {
    if (line.encoded === null) missing.add(pairKey(line.from, line.to));
  }
  const pairs: LinePair[] = [];
  if (missing.size === 0) return pairs;

  // `delete` is true once per pair, so a pair two legs share is listed where it comes first.
  const take = (from: string, to: string) => {
    if (missing.delete(pairKey(from, to))) pairs.push({ from, to });
  };
  const carriers = new Set<string>();
  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) {
      carriers.add(leg.employeeId);
      for (let i = 1; i < leg.placeIds.length; i++) take(leg.placeIds[i - 1], leg.placeIds[i]);
    }
  }
  for (const trip of run.trips) {
    if (carriers.has(trip.employeeId)) take(trip.originPlaceId, trip.destinationPlaceId);
  }
  return pairs;
}

/**
 * Returns the function the map route calls after it has answered. It never throws and returns at once.
 * - No `ensureLegPolylines` (no Google key): it does nothing.
 * - A fetch is still running: it starts none, and no try is counted.
 * - Otherwise the first `MAP_LINE_PAIRS_PER_REQUEST` missing pairs that were not yet tried `MAP_LINE_TRIES`
 *   times go to `ensureLegPolylines` as two-place legs. Nothing left to ask for: nothing is called.
 * The try counts live as long as the returned function, which is one server run.
 */
export function createMapLineFetcher(
  ensureLegPolylines: EnsureLegPolylines | undefined,
): (run: Pick<RunV2, 'trips' | 'assignments'>, polylines: readonly RoutePolyline[]) => void {
  const tries = new Map<string, number>();
  let running = false;
  const done = () => {
    running = false;
  };

  return (run, polylines) => {
    if (!ensureLegPolylines || running) return;
    try {
      const pairs = missingLinePairs(run, polylines)
        .filter(({ from, to }) => (tries.get(pairKey(from, to)) ?? 0) < MAP_LINE_TRIES)
        .slice(0, MAP_LINE_PAIRS_PER_REQUEST);
      if (pairs.length === 0) return;
      for (const { from, to } of pairs) {
        const key = pairKey(from, to);
        tries.set(key, (tries.get(key) ?? 0) + 1);
      }
      running = true;
      // A rejection is dropped, not logged. Until a line is cached its leg moves on the straight line (pass 44).
      Promise.resolve(ensureLegPolylines(pairs.map(({ from, to }) => ({ placeIds: [from, to] })))).then(done, done);
    } catch {
      done(); // `ensureLegPolylines` threw before it returned a promise
    }
  };
}
