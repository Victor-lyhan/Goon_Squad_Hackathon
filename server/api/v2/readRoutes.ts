// Every /api/v2 route that does not change state: the eight GETs the three workspaces poll, plus
// POST /matches/compare, which is read-only by contract (shared/v2/api.ts).
// The handlers only put merged pieces in order: read the run from the store once, take at most one
// snapshot at the run's clock, call a pure view (views.ts) or the pure compare step (compareOps.ts).
// Statuses are never stored; they come from the snapshot function, which is passed in (the bootstrap
// issue passes the real snapshotAt). No handler calls store.mutate.
// GET /map also starts, after its answer, a background fetch of the route lines the answer lacks
// (mapLines.ts, DECISIONS pass 57). That writes to the travel cache only, never to the run.
import type { NextFunction, Request, Response, Router } from 'express';
import type { BusinessesResponse, EmployeesResponse, MapResponse, ShipmentResponse } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2, Snapshot, TravelProvider } from '../../../shared/v2/types';
import type { Store } from '../../store';
import { compareRun } from './compareOps';
import { createMapLineFetcher, type EnsureLegPolylines } from './mapLines';
import {
  businessDashboard, employeeDashboard, jobResponse, mapResponse, shipmentView, simulatorResponse,
} from './views';

export type ReadDeps = {
  store: Store<RunV2>;
  travel: TravelProvider;
  snapshotAt: (run: RunV2, timeMin: number) => Snapshot;
  /**
   * `ensureLegPolylines` of the travel service (server/geo/travelService.ts). The bootstrap passes it only
   * when the server has a Google key. GET /map calls it after the response for the pairs it answered
   * without a route line: never awaited, its failure dropped. Left out: the map fetches nothing.
   */
  ensureLegPolylines?: EnsureLegPolylines;
};

export const BUSINESS_NOT_FOUND = 'Business not found';
export const EMPLOYEE_NOT_FOUND = 'Employee not found';
export const SHIPMENT_NOT_FOUND = 'Shipment not found';
export const JOB_NOT_FOUND = 'Job not found';

type Handler = (req: Request, res: Response, next: NextFunction) => void;

/**
 * Sends what `build` returns as JSON; `null` means an unknown ID and is answered 404 with `notFound`.
 * Anything thrown goes to `next`, so the router turns a TravelDataMissingError into the documented 503.
 */
const answer = <T>(build: (req: Request) => T | null, notFound = 'Not found'): Handler =>
  (req, res: Response<T | ApiError>, next) => {
    try {
      const body = build(req);
      if (body === null) {
        res.status(404).json({ error: notFound });
        return;
      }
      res.json(body);
    } catch (err) {
      next(err);
    }
  };

/** Registers the read routes on the v2 router. Paths are relative to /api/v2. */
export function registerReadRoutes(router: Router, deps: ReadDeps): void {
  const { store, travel, snapshotAt } = deps;

  // One store read and one snapshot per request, so the run and its statuses always belong together.
  const withSnapshot = <T>(view: (run: RunV2, snapshot: Snapshot, id: string) => T | null) =>
    (req: Request): T | null => {
      const run = store.get();
      return view(run, snapshotAt(run, run.clock.timeMin), String(req.params.id));
    };

  // One per server run: it holds the "one fetch at a time" flag and the tries of every pair.
  const fetchMissingLines = createMapLineFetcher(deps.ensureLegPolylines);

  // Lists and the map hold no status, so they need no snapshot.
  router.get('/businesses', answer<BusinessesResponse>(() => ({ businesses: store.get().scenario.businesses })));
  router.get('/employees', answer<EmployeesResponse>(() => ({ employees: store.get().scenario.employees })));
  router.get('/map', (_req: Request, res: Response<MapResponse | ApiError>, next: NextFunction) => {
    let run: RunV2;
    let body: MapResponse;
    try {
      run = store.get();
      body = mapResponse(run, travel);
    } catch (err) {
      next(err);
      return;
    }
    res.json(body);
    // After the answer, and never part of it: the lines this answer lacks are fetched in the background
    // and the page's next map request returns them. It never throws.
    fetchMissingLines(run, body.polylines);
  });

  router.get('/businesses/:id/dashboard', answer(withSnapshot(businessDashboard), BUSINESS_NOT_FOUND));
  router.get('/employees/:id/dashboard', answer(withSnapshot(employeeDashboard), EMPLOYEE_NOT_FOUND));
  router.get('/shipments/:id', answer(withSnapshot<ShipmentResponse>((run, snapshot, id) => {
    const view = shipmentView(run, snapshot, id);
    return view && { ...view, matched: view.plan !== null };
  }), SHIPMENT_NOT_FOUND));
  router.get('/jobs/:id', answer(withSnapshot(jobResponse), JOB_NOT_FOUND));
  router.get('/simulator', answer(withSnapshot((run, snapshot) => simulatorResponse(run, snapshot))));

  router.post('/matches/compare', (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = compareRun(store.get(), travel, req.body);
      if (result.kind === 'invalid') {
        res.status(result.status).json(result.error);
        return;
      }
      res.json(result.response);
    } catch (err) {
      next(err);
    }
  });
}
