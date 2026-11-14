import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Job, Run, Shipment, Trip } from '../../shared/types';
import type { BusinessDashboard, EmployeeDashboard, JobResponse, ShipmentResponse } from '../../shared/api';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { assignShipments, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { createRouter } from '../../server/domain/routing';
import { buildTimeline } from '../../server/domain/simulation';

// Run with a real plan built from the relay fixture (same shape as views.test.ts).
function runWithPlan(): Run {
  const router = createRouter(fixture.graph);
  const employees: Employee[] = fixture.employees.map((employee, i) => ({
    ...employee, name: employee.id, homeNodeId: i === 0 ? 'X' : 'Y',
    eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
    availableEvening: i === 0, availableMorning: i === 1,
    eveningViaNodeIds: [], morningViaNodeIds: [],
  }));
  const trips: Trip[] = fixture.trips.map((trip) => {
    const route = router.shortestPath(trip.originNodeId, trip.destinationNodeId)!;
    return { ...trip, direction: trip.direction as Trip['direction'], baselineNodeIds: route.nodeIds,
      baselineDurationMin: route.durationMin, baselineDistanceM: route.distanceM };
  });
  const shipment: Shipment = { ...fixture.shipment, clientRequestId: 'request-1', label: 'Test',
    category: 'envelope', description: '', weightGrams: 100, pickupInstructions: '',
    dropoffInstructions: '', createdSeq: 1 };
  const ctx: MatchContext = { router, employees, trips, businesses: fixture.businesses,
    hubs: fixture.hubs, settings: { ...DEFAULT_SETTINGS } };
  const assignments = assignShipments([shipment], ctx);
  const plan = assignments.plans[0];
  const jobs: Job[] = plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`, planId: plan.id, shipmentId: shipment.id,
    employeeId: leg.employeeId, legIndex, tripId: leg.tripId,
    pickup: leg.stops[0], dropoff: leg.stops[leg.stops.length - 1], rewardCents: leg.rewardCents,
  }));
  const base = createInitialRun(loadDefaultScenario());
  return {
    ...base,
    scenario: { ...base.scenario, graph: fixture.graph, businesses: fixture.businesses, hubs: fixture.hubs,
      employees, shipments: [shipment], settings: { ...DEFAULT_SETTINGS } },
    trips, assignments, jobs, notifications: [],
    events: buildTimeline(assignments.plans, jobs, fixture.hubs),
    clock: { phase: 'locked', playing: false, timeMin: 1040, speed: 120 },
  };
}

let server: Server;
let base: string;
const run = runWithPlan();

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-routes-'));
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => run });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const get = async <T>(p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, body: (await res.json()) as T };
};

describe('portal read routes', () => {
  it('the test run has a real plan', () => {
    expect(run.assignments.plans).toHaveLength(1);
    expect(run.jobs.length).toBeGreaterThan(0);
  });

  it('GET /api/businesses/:id/dashboard', async () => {
    const id = run.scenario.shipments[0].originBusinessId;
    const { status, body } = await get<BusinessDashboard>(`/api/businesses/${id}/dashboard`);
    expect(status).toBe(200);
    expect(body.business.id).toBe(id);
    expect(body.outgoing).toHaveLength(1);
  });

  it('GET /api/employees/:id/dashboard', async () => {
    const id = run.jobs[0].employeeId;
    const { status, body } = await get<EmployeeDashboard>(`/api/employees/${id}/dashboard`);
    expect(status).toBe(200);
    expect(body.employee.id).toBe(id);
    expect(body.assigned.length + body.completed.length).toBeGreaterThan(0);
  });

  it('GET /api/shipments/:id includes matched', async () => {
    const id = run.scenario.shipments[0].id;
    const { status, body } = await get<ShipmentResponse>(`/api/shipments/${id}`);
    expect(status).toBe(200);
    expect(body.shipment.id).toBe(id);
    expect(body.matched).toBe(true);
    expect(body.jobIds).toEqual(run.jobs.map((j) => j.id));
  });

  it('GET /api/jobs/:id includes the trip', async () => {
    const job = run.jobs[0];
    const { status, body } = await get<JobResponse>(`/api/jobs/${job.id}`);
    expect(status).toBe(200);
    expect(body.job.id).toBe(job.id);
    expect(body.trip.id).toBe(job.tripId);
  });

  it.each([
    ['/api/businesses/nope/dashboard', 'Business not found'],
    ['/api/employees/nope/dashboard', 'Employee not found'],
    ['/api/shipments/nope', 'Shipment not found'],
    ['/api/jobs/nope', 'Job not found'],
  ])('404 for unknown id: %s', async (url, error) => {
    const { status, body } = await get(url);
    expect(status).toBe(404);
    expect(body).toEqual({ error });
  });
});
