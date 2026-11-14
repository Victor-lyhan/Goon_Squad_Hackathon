import type { Request, Response } from 'express';
import type { BusinessDashboard, EmployeeDashboard, JobResponse, ShipmentResponse } from '../../shared/api';
import type { ApiError } from '../../shared/schemas';
import type { Run, Snapshot } from '../../shared/types';
import { snapshotAt } from '../domain/simulation';
import type { Store } from '../store';
import { businessDashboard, employeeDashboard, jobResponse, shipmentView } from './views';

/** One store read and one snapshot per request; the builder does all the work. */
const portalRoute =
  <T>(store: Store, notFound: string, build: (run: Run, snap: Snapshot, id: string) => T | null) =>
  (req: Request, res: Response<T | ApiError>) => {
    const run = store.get();
    const body = build(run, snapshotAt(run, run.clock.timeMin), String(req.params.id));
    if (body === null) {
      res.status(404).json({ error: notFound });
      return;
    }
    res.json(body);
  };

export const getBusinessDashboard = (store: Store) =>
  portalRoute<BusinessDashboard>(store, 'Business not found', businessDashboard);

export const getEmployeeDashboard = (store: Store) =>
  portalRoute<EmployeeDashboard>(store, 'Employee not found', employeeDashboard);

export const getShipment = (store: Store) =>
  portalRoute<ShipmentResponse>(store, 'Shipment not found', (run, snap, id) => {
    const view = shipmentView(run, snap, id);
    return view ? { ...view, matched: view.plan !== null } : null;
  });

export const getJob = (store: Store) => portalRoute<JobResponse>(store, 'Job not found', jobResponse);
