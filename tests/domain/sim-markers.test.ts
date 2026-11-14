import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Run, Shipment, Trip } from '../../shared/types';
import { generateCandidates, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { createRouter } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

function fixtureRun(): Run {
  const router = createRouter(fixture.graph);
  const employees: Employee[] = fixture.employees.map((employee, index) => ({
    ...employee,
    name: employee.id,
    homeNodeId: index === 0 ? 'X' : 'Y',
    eveningDepartureMin: 1020,
    morningDepartureMin: 1935,
    maxExtraMin: 8,
    availableEvening: index === 0,
    availableMorning: index === 1,
    eveningViaNodeIds: [],
    morningViaNodeIds: [],
  }));
  const trips: Trip[] = fixture.trips.map((trip) => {
    const route = router.shortestPath(trip.originNodeId, trip.destinationNodeId)!;
    return {
      ...trip,
      direction: trip.direction as Trip['direction'],
      baselineNodeIds: route.nodeIds,
      baselineDurationMin: route.durationMin,
      baselineDistanceM: route.distanceM,
    };
  });
  const shipment: Shipment = {
    ...fixture.shipment,
    clientRequestId: 'request-1',
    label: 'Fixture package',
    category: 'envelope',
    description: '',
    weightGrams: 100,
    pickupInstructions: '',
    dropoffInstructions: '',
    createdSeq: 1,
  };
  const context: MatchContext = {
    router, employees, trips, businesses: fixture.businesses, hubs: fixture.hubs,
    settings: { ...DEFAULT_SETTINGS },
  };
  const [plan] = generateCandidates(shipment, context);
  const jobs = plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`,
    planId: plan.id,
    shipmentId: plan.shipmentId,
    employeeId: leg.employeeId,
    legIndex,
    tripId: leg.tripId,
    pickup: leg.stops[0],
    dropoff: leg.stops[leg.stops.length - 1],
    rewardCents: leg.rewardCents,
  }));

  return {
    runId: 'fixture-run', version: 1,
    scenario: {
      schemaVersion: 1, name: 'Fixture', preset: 'fixture', seed: 1,
      graph: fixture.graph, businesses: fixture.businesses, hubs: fixture.hubs,
      employees, shipments: [shipment], settings: { ...DEFAULT_SETTINGS },
    },
    trips,
    assignments: { plans: [plan], unmatched: [], computeMs: 0 },
    jobs,
    notifications: [],
    events: buildTimeline([plan], jobs, fixture.hubs),
    clock: { phase: 'locked', playing: false, timeMin: 930, speed: 30 },
  };
}

describe('snapshotAt map animation', () => {
  it('interpolates planned vehicles and transfers package custody at service completion', () => {
    const run = fixtureRun();

    expect(snapshotAt(run, 1021).markers).toEqual([
      { employeeId: 'emp-1', x: 0, y: 0, servicing: true },
    ]);

    const at1027 = snapshotAt(run, 1027);
    expect(at1027.markers).toEqual([
      { employeeId: 'emp-1', x: 0.5, y: 0.5, carryingShipmentId: 'shp-1', servicing: false },
    ]);
    expect(at1027.packagePositions).toEqual({ 'shp-1': { x: 0.5, y: 0.5 } });

    const at1040 = snapshotAt(run, 1040);
    expect(at1040.markers).toEqual([
      { employeeId: 'emp-1', x: 0.5, y: 1.5, servicing: false },
    ]);
    expect(at1040.packagePositions).toEqual({ 'shp-1': { x: 1, y: 1 } });
    expect(snapshotAt(run, 1047).markers).toEqual([]);

    const at1953 = snapshotAt(run, 1953);
    expect(at1953.markers).toEqual([
      { employeeId: 'emp-2', x: 1.5, y: 1.5, carryingShipmentId: 'shp-1', servicing: false },
    ]);
    expect(at1953.packagePositions).toEqual({ 'shp-1': { x: 1.5, y: 1.5 } });

    // The fixture's 12-minute H → B edge reaches B at 1959; its delivery
    // service completes at 1961, when the package becomes stationary at B.
    const at1960 = snapshotAt(run, 1960);
    expect(at1960.markers).toEqual([
      { employeeId: 'emp-2', x: 2, y: 2, carryingShipmentId: 'shp-1', servicing: true },
    ]);
    expect(snapshotAt(run, 2000).packagePositions).toEqual({ 'shp-1': { x: 2, y: 2 } });
    expect(snapshotAt(run, 1027)).toEqual(at1027);
  });
});
