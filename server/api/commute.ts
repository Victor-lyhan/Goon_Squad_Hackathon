import type { Request, Response } from 'express';
import type { CommuteResponse } from '../../shared/api';
import { PutCommuteRequest, type ApiError } from '../../shared/schemas';
import type { Employee, Trip } from '../../shared/types';
import { buildTrips, createRouter } from '../domain/routing';
import type { Store } from '../store';
import { matchPending } from './pipeline';

export const putCommute = (store: Store) => async (req: Request, res: Response<CommuteResponse | ApiError>) => {
  const parsed = PutCommuteRequest.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'body';
      fieldErrors[key] ??= issue.message;
    }
    res.status(400).json({ error: 'Invalid commute', fieldErrors });
    return;
  }
  const body = parsed.data;
  const run = store.get();
  const existing = run.scenario.employees.find((e) => e.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }
  if (run.clock.phase === 'locked') {
    res.status(409).json({ error: 'Start a new planning cycle to edit commutes' });
    return;
  }

  const nodeIds = new Set(run.scenario.graph.nodes.map((n) => n.id));
  const fieldErrors: Record<string, string> = {};
  if (!run.scenario.businesses.some((b) => b.id === body.businessId)) fieldErrors.businessId = 'Unknown business';
  if (!nodeIds.has(body.homeNodeId)) fieldErrors.homeNodeId = 'Unknown home location';
  for (const key of ['eveningViaNodeIds', 'morningViaNodeIds'] as const) {
    if (body[key].some((id) => !nodeIds.has(id))) fieldErrors[key] = 'Unknown waypoint';
  }
  if (Object.keys(fieldErrors).length) {
    res.status(400).json({ error: 'Invalid commute', fieldErrors });
    return;
  }

  let result: { employee: Employee; trips: Trip[] } | undefined;
  let rematchedShipmentIds: string[] = [];
  try {
    await store.mutate((r) => {
      const idx = r.scenario.employees.findIndex((e) => e.id === existing.id);
      if (idx < 0) throw new Error('Employee not found');
      const employee: Employee = { ...r.scenario.employees[idx], ...body };
      r.scenario.employees[idx] = employee;
      const trips = buildTrips(employee, r.scenario.businesses, createRouter(r.scenario.graph));
      r.trips = [...r.trips.filter((t) => t.employeeId !== employee.id), ...trips];
      result = { employee, trips };
      const retry = r.assignments.unmatched.map((u) => u.shipmentId);
      if (retry.length) {
        matchPending(r, retry);
        const planned = new Set(r.assignments.plans.map((p) => p.shipmentId));
        rematchedShipmentIds = retry.filter((id) => planned.has(id));
      }
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
    return;
  }
  res.json({ ...result!, rematchedShipmentIds });
};
