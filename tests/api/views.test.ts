import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Job, Run, Shipment, Trip } from '../../shared/types';
import { generateCandidates, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { createRouter } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';
import { businessDashboard, employeeDashboard, jobResponse, shipmentView } from '../../server/api/views';

function buildRun(): Run {
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
  const plan = generateCandidates(shipment, ctx)[0];
  const jobs: Job[] = plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`, planId: plan.id, shipmentId: shipment.id,
    employeeId: leg.employeeId, legIndex, tripId: leg.tripId,
    pickup: leg.stops[0], dropoff: leg.stops[leg.stops.length - 1], rewardCents: leg.rewardCents,
  }));
  const unmatchedShipment: Shipment = { ...shipment, id: 'shp-2', clientRequestId: 'request-2', createdSeq: 2 };
  return {
    runId: 'run-1', version: 7,
    scenario: {
      schemaVersion: 1, name: 'views', preset: 'fixture', seed: 1, graph: fixture.graph,
      businesses: fixture.businesses, hubs: fixture.hubs, employees,
      shipments: [shipment, unmatchedShipment], settings: { ...DEFAULT_SETTINGS },
    },
    trips,
    assignments: { plans: [plan], unmatched: [{ shipmentId: 'shp-2', reason: 'No carrier' }], computeMs: 0 },
    jobs,
    notifications: [
      { id: 'n1', audience: 'business', audienceId: 'biz-a', kind: 'delivery_matched', shipmentId: 'shp-1',
        planId: plan.id, message: 'm', createdSeq: 1 },
      { id: 'n2', audience: 'employee', audienceId: 'emp-1', kind: 'job_assigned', shipmentId: 'shp-1',
        planId: plan.id, jobId: jobs[0].id, message: 'm', createdSeq: 2 },
    ],
    events: buildTimeline([plan], jobs, fixture.hubs),
    clock: { phase: 'locked', playing: false, timeMin: 1040, speed: 120 },
  };
}

describe('portal views', () => {
  const run = buildRun();

  it('at t=1040 the package is at the hub and both portals agree (spec 11)', () => {
    const snap = snapshotAt(run, 1040);
    const ship = shipmentView(run, snap, 'shp-1')!;
    expect(ship.status).toBe('at_hub');
    expect(ship.deliveredAtMin).toBeNull();
    expect(ship.unmatchedReason).toBeNull();
    expect(ship.jobIds).toEqual(['plan-shp-1-L0', 'plan-shp-1-L1']);

    const e1 = employeeDashboard(run, snap, 'emp-1')!;
    const e2 = employeeDashboard(run, snap, 'emp-2')!;
    expect(e1.completed.map((v) => v.job.id)).toEqual(['plan-shp-1-L0']);
    expect(e1.assigned).toEqual([]);
    expect(e1.earnedCents).toBe(300);
    expect(e1.projectedCents).toBe(300);
    expect(e2.assigned.map((v) => v.status)).toEqual(['assigned']);
    expect(e2.earnedCents).toBe(0);
    expect(e1.trips.every((t) => t.employeeId === 'emp-1')).toBe(true);
    expect(e1.notifications.map((n) => n.id)).toEqual(['n2']);

    const bizA = businessDashboard(run, snap, 'biz-a')!;
    const bizB = businessDashboard(run, snap, 'biz-b')!;
    const planId = ship.plan!.id;
    expect(bizA.outgoing.find((v) => v.shipment.id === 'shp-1')!.plan!.id).toBe(planId);
    expect(bizB.incoming.find((v) => v.shipment.id === 'shp-1')!.jobIds).toEqual(ship.jobIds);
    expect(e1.completed[0].plan.id).toBe(planId);
    expect(e2.assigned[0].plan.id).toBe(planId);
  });

  it('at t=2000 it is delivered at 1961', () => {
    const ship = shipmentView(run, snapshotAt(run, 2000), 'shp-1')!;
    expect(ship.status).toBe('delivered');
    expect(ship.deliveredAtMin).toBe(1961);
  });

  it('business dashboard orders newest first and computes totals', () => {
    const snap = snapshotAt(run, 2000);
    const a = businessDashboard(run, snap, 'biz-a')!;
    expect(a.outgoing.map((v) => v.shipment.id)).toEqual(['shp-2', 'shp-1']);
    expect(a.outgoing[0].status).toBe('unmatched');
    expect(a.outgoing[0].unmatchedReason).toBe('No carrier');
    expect(a.totals).toEqual({ sent: 2, matched: 1, delivered: 1, spendCents: 1000 });
    expect(a.notifications.map((n) => n.id)).toEqual(['n1']);
    expect(a).toMatchObject({ phase: 'locked', version: 7 });
    expect(businessDashboard(run, snap, 'biz-b')!.notifications).toEqual([]);
  });

  it('jobResponse includes status, plan and trip', () => {
    const res = jobResponse(run, snapshotAt(run, 1040), 'plan-shp-1-L1')!;
    expect(res.status).toBe('assigned');
    expect(res.trip.id).toBe('emp-2-morn');
    expect(res.shipment.id).toBe('shp-1');
  });

  it('returns null for unknown IDs', () => {
    const snap = snapshotAt(run, 1040);
    expect(shipmentView(run, snap, 'nope')).toBeNull();
    expect(businessDashboard(run, snap, 'nope')).toBeNull();
    expect(employeeDashboard(run, snap, 'nope')).toBeNull();
    expect(jobResponse(run, snap, 'nope')).toBeNull();
  });
});
