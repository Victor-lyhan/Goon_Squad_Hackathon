// The delivery-request routes of /api/v2 (DECISIONS pass 47, 48, 50, 62):
//   POST  /shipments            planCreateShipment -> withShipment -> atPlanningStart -> matchPending -> shipmentView
//   PATCH /shipments/:id        planPatchShipment  -> withShipment -> atPlanningStart -> matchPending -> shipmentView
//   POST  /shipments/:id/match  planMatchRetry     -> atPlanningStart -> matchPending -> shipmentView
// The handlers only put merged pieces in order. Each request is decided inside one store mutation, so
// two requests can never both create the same `clientRequestId` or both take the same shipment ID.
// A request that stores something also puts the clock back at the start of the run, in that same
// mutation: a preview (a seek, Play journey) moves the clock without locking the run, and a delivery
// stored after it must not be answered as already under way or delivered.
// A request that stores nothing (a refusal, a replay, a retry of a matched delivery) leaves the run,
// its clock and its version exactly as they were, and so does a request that fails.
// A delivery that finds no match is a success with `matched: false` and the matcher's reason.
// Travel errors go to the router's handler (errors.ts), which answers the 503 TravelUnavailable body.
import type express from 'express';
import type { ShipmentResponse } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Leg, Run as RunV2, Shipment, Snapshot, TravelProvider } from '../../../shared/v2/types';
import type { Store } from '../../store';
import { takesNoOptions } from './bodyGuard';
import { matchPending, type PipelineDeps } from './pipeline';
import {
  atPlanningStart, planCreateShipment, planMatchRetry, planPatchShipment, withShipment, type ShipmentRefusal,
} from './shipmentOps';
import { shipmentView } from './views';

export type ShipmentRouteDeps = {
  store: Store<RunV2>;
  travel: TravelProvider;
  buildEvents: PipelineDeps['buildEvents'];
  /** The same type as in the read routes; the bootstrap passes the real snapshot function. */
  snapshotAt: (run: RunV2, timeMin: number) => Snapshot;
  /**
   * `ensureLegPolylines` of the travel service (server/geo/travelService.ts): fetches the route lines
   * of a newly matched delivery. Called after the response, never awaited, and its failure is dropped.
   */
  ensureLegPolylines?: (legs: Pick<Leg, 'placeIds'>[]) => Promise<unknown>;
};

/** What a request means once it is decided against the run inside the store mutation. */
type Decision =
  | ShipmentRefusal                                              // answer `status` with `error`
  | { kind: 'replay' | 'already_matched'; shipmentId: string }   // 200 with the stored delivery, nothing changes
  | { kind: 'stored'; shipmentId: string; run: RunV2 };          // `run` is the new state

type NothingToStore = Exclude<Decision, { kind: 'stored' }>;

/**
 * Thrown inside the store mutation, so the store drops the draft and the version stays.
 * `run` is the state the decision was made on.
 */
class NothingStored extends Error {
  constructor(readonly decision: NothingToStore, readonly run: RunV2) {
    super('Nothing stored');
    this.name = 'NothingStored';
  }
}

type Decide = (draft: RunV2, req: express.Request) => Decision;

/** Registers the delivery-request routes on the v2 router. Paths are relative to /api/v2. */
export function registerShipmentRoutes(router: express.Router, deps: ShipmentRouteDeps): void {
  const { store, snapshotAt, ensureLegPolylines } = deps;
  const pipeline: PipelineDeps = { travel: deps.travel, buildEvents: deps.buildEvents };

  // Never throws and never rejects: the route lines are for the map only (DECISIONS pass 44, 47).
  // Nothing is logged, because an upstream error message could hold the Google key.
  const fetchRouteLines = (legs: Leg[]): void => {
    if (!ensureLegPolylines) return;
    try {
      ensureLegPolylines(legs).catch(() => undefined);
    } catch {
      // Until the lines are cached, these legs are drawn and moved on the straight line.
    }
  };

  /** One write route: `decide` runs on the store's draft, `storedStatus` answers a request that changed the run. */
  const write = (storedStatus: 200 | 201, decide: Decide) => async (
    req: express.Request, res: express.Response<ShipmentResponse | ApiError>, next: express.NextFunction,
  ) => {
    try {
      let shipmentId = '';
      let stored = true;
      let run: RunV2;
      try {
        run = await store.mutate((draft) => {
          const decision = decide(draft, req);
          if (decision.kind !== 'stored') throw new NothingStored(decision, draft);
          shipmentId = decision.shipmentId;
          return decision.run;
        });
      } catch (err) {
        if (!(err instanceof NothingStored)) throw err;
        const { decision } = err;
        if ('error' in decision) {
          res.status(decision.status).json(decision.error);
          return;
        }
        ({ shipmentId } = decision);
        ({ run } = err);
        stored = false;
      }

      const view = shipmentView(run, snapshotAt(run, run.clock.timeMin), shipmentId);
      if (!view) throw new Error('The stored delivery is not in the run');
      res.status(stored ? storedStatus : 200).json({ ...view, matched: view.plan !== null });

      // Only a plan made by this request needs its lines; a replay's plan had them requested before.
      if (stored && view.plan) fetchRouteLines(view.plan.legs);
    } catch (err) {
      next(err);
    }
  };

  /** Stores `shipment` (new or edited) in the draft, with the clock back at the start, and matches it. */
  const storeAndMatch = (draft: RunV2, shipment: Shipment): Decision => {
    const run = atPlanningStart(withShipment(draft, shipment));
    matchPending(run, [shipment.id], pipeline);
    return { kind: 'stored', shipmentId: shipment.id, run };
  };

  router.post('/shipments', write(201, (draft, req) => {
    const plan = planCreateShipment(draft, req.body);
    return plan.kind === 'create' ? storeAndMatch(draft, plan.shipment) : plan;
  }));

  router.patch('/shipments/:id', write(200, (draft, req) => {
    const plan = planPatchShipment(draft, String(req.params.id), req.body);
    return plan.kind === 'patch' ? storeAndMatch(draft, plan.shipment) : plan;
  }));

  // A retry has no options: a body that is a list is a 400 and matches nothing.
  router.post('/shipments/:id/match', takesNoOptions, write(200, (draft, req) => {
    const plan = planMatchRetry(draft, String(req.params.id));
    if (plan.kind !== 'match') return plan;
    const run = atPlanningStart(draft);
    matchPending(run, [plan.shipmentId], pipeline);
    return { kind: 'stored', shipmentId: plan.shipmentId, run };
  }));
}
