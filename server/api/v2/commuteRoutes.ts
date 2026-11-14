// The commute save of /api/v2 (DECISIONS pass 46, 48, 62): PUT /employees/:id/commute.
// One request runs in this order:
//   1. parse the body and resolve it against the current run (400 / 404 / 409, nothing fetched);
//   2. make sure the home's travel pairs are in the cache (a new home calls Google live here);
//   3. make sure the two commute route lines are there (best effort: the map draws no line without them);
//   4. in one store mutation: resolve again, apply the commute, drop every plan that rides a trip the
//      save changed, match those shipments again together with the unmatched ones, drop the homes that
//      are no longer used and, if a plan went or came, put the clock back at the start;
//   5. answer with the saved commute and the unmatched shipments that got a plan.
// A failure in any step leaves the run exactly as it was. Travel errors go to the router's handler
// (server/api/v2/errors.ts), which answers the 503 TravelUnavailable body.
// The route lines of re-planned legs are not fetched here: the next map request asks for them (pass 57).
// This file logs nothing, so no log line can hold a home's coordinates.
import type express from 'express';
import type { CommuteResponse } from '../../../shared/v2/api';
import { PutCommuteRequest, type ApiError } from '../../../shared/v2/schemas';
import type { LatLng, Run as RunV2, TravelProvider } from '../../../shared/v2/types';
import type { Store } from '../../store';
import {
  INVALID_COMMUTE, applyCommute, changedTripIds, dropPlansOnTrips, dropUnusedHomes, pairsToEnsure, resolveCommute,
  type CommuteResolution, type PlacePair,
} from './commutePlan';
import { matchPending, type PipelineDeps } from './pipeline';
import { commuteResponse } from './views';

/**
 * The part of the travel service (server/geo/travelService.ts) a commute save needs.
 * Declared here so this route depends on the shape only; the bootstrap passes the real service.
 */
export type CommutePlaces = {
  /** Registers the coordinates of a place, so its pairs can be fetched. */
  addPlaces(places: Record<string, LatLng>): void;
  /** Resolves when every pair has a travel time. Cached pairs cost no request. */
  ensurePairs(pairs: PlacePair[]): Promise<unknown>;
  /** The same for route lines. */
  ensurePolylines(pairs: PlacePair[]): Promise<unknown>;
};

export type CommuteRouteDeps = {
  store: Store<RunV2>;
  /** Must read the same cache that `places` writes to, so fetched pairs are visible at once. */
  travel: TravelProvider;
  buildEvents: PipelineDeps['buildEvents'];
  places: CommutePlaces;
};

type CommuteFailure = Extract<CommuteResolution, { ok: false }>;

/** Thrown inside the store mutation, so the store drops the draft and the version stays. */
class CommuteRefused extends Error {
  constructor(readonly failure: CommuteFailure) {
    super(failure.error);
    this.name = 'CommuteRefused';
  }
}

function refusal({ error, fieldErrors }: CommuteFailure): ApiError {
  return fieldErrors ? { error, fieldErrors } : { error };
}

// Zod's messages name the field and the rule, never the value that was sent.
function bodyErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'body';
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export function registerCommuteRoutes(router: express.Router, deps: CommuteRouteDeps): void {
  const { store, travel, places } = deps;
  const pipeline: PipelineDeps = { travel, buildEvents: deps.buildEvents };

  router.put('/employees/:id/commute', async (
    req: express.Request<{ id: string }>, res: express.Response<CommuteResponse | ApiError>, next: express.NextFunction,
  ) => {
    try {
      const employeeId = req.params.id;
      const parsed = PutCommuteRequest.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: INVALID_COMMUTE, fieldErrors: bodyErrors(parsed.error.issues) });
        return;
      }
      const body = parsed.data;

      const current = store.get();
      const first = resolveCommute(current, employeeId, body);
      if (!first.ok) {
        res.status(first.status).json(refusal(first));
        return;
      }

      // Before the run changes: the home's travel data. Only a home that is not cached yet calls Google.
      const { home } = first;
      const needed = pairsToEnsure(home, first.employee.businessId, current.scenario.businesses.map((b) => b.id));
      places.addPlaces({ [home.id]: { lat: home.lat, lng: home.lng } });
      await places.ensurePairs(needed.matrix);
      try {
        await places.ensurePolylines(needed.polylines);
      } catch {
        // Route lines are for the map only (DECISIONS pass 44): the save goes on without them.
      }

      let rematchedShipmentIds: string[] = [];
      let run: RunV2;
      try {
        run = await store.mutate((draft) => {
          // The run may have been locked or replaced while Google answered.
          const again = resolveCommute(draft, employeeId, body);
          if (!again.ok) throw new CommuteRefused(again);
          const oldTrips = draft.trips.filter((t) => t.employeeId === employeeId);
          const { trips } = applyCommute(draft, again.employee, again.home, travel);

          // Trip IDs depend only on the employee, so a plan made on a trip that changed would now ride
          // another trip or none. Those plans go as a whole and their shipments are matched again.
          const dropped = dropPlansOnTrips(draft, changedTripIds(oldTrips, trips));
          const unmatched = draft.assignments.unmatched.map((u) => u.shipmentId);

          const createdSeq = new Map(draft.scenario.shipments.map((s) => [s.id, s.createdSeq]));
          const seqOf = (id: string) => createdSeq.get(id) ?? Infinity;
          const pending = [...new Set([...dropped, ...unmatched])]
            .sort((a, b) => seqOf(a) - seqOf(b) || (a < b ? -1 : a > b ? 1 : 0));
          if (pending.length === 0) return;
          matchPending(draft, pending, pipeline);

          // The contract's meaning: no plan before this save, a plan after it. A shipment that lost its
          // plan is not listed, with a new plan or without one (then it is in `unmatched` with a reason).
          const planned = new Set(draft.assignments.plans.map((p) => p.shipmentId));
          const hadNoPlan = new Set(unmatched);
          rematchedShipmentIds = pending.filter((id) => hadNoPlan.has(id) && planned.has(id));

          // The old home goes once no plan drives to it any more.
          dropUnusedHomes(draft);
          // Statuses come from the clock. After a seek in planning, a plan that went or came would show
          // a delivery half done that was never driven, so the run is back at its start, paused.
          if (dropped.length > 0 || rematchedShipmentIds.length > 0) {
            draft.clock = { ...draft.clock, timeMin: draft.scenario.settings.simStartMin, playing: false };
          }
        });
      } catch (err) {
        if (!(err instanceof CommuteRefused)) throw err;
        res.status(err.failure.status).json(refusal(err.failure));
        return;
      }

      const saved = commuteResponse(run, employeeId, rematchedShipmentIds);
      if (!saved) throw new Error('The saved commute is not in the run');
      res.json(saved);
    } catch (err) {
      next(err);
    }
  });
}
