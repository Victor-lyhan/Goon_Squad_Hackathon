import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { DeliveryPlan, Job, Run, Scenario, Shipment, Trip } from '../../shared/types';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, generateCandidates, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

function jobsFor(plans: DeliveryPlan[]): Job[] {
  return plans.flatMap((plan) => plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`,
    planId: plan.id,
    shipmentId: plan.shipmentId,
    employeeId: leg.employeeId,
    legIndex,
    tripId: leg.tripId,
    pickup: leg.stops[0]!,
    dropoff: leg.stops[leg.stops.length - 1]!,
    rewardCents: leg.rewardCents,
  })));
}

function runForScenario(scenario: Scenario): Run {
  const router = createRouter(scenario.graph);
  const trips = scenario.employees.flatMap((employee) => buildTrips(employee, scenario.businesses, router));
  const context: MatchContext = {
    router,
    trips,
    employees: scenario.employees,
    businesses: scenario.businesses,
    hubs: scenario.hubs,
    settings: scenario.settings,
  };
  const assignments = assignShipments(scenario.shipments, context);
  const jobs = jobsFor(assignments.plans);
  return {
    runId: `spec7-${scenario.seed}`,
    version: 1,
    scenario,
    trips,
    assignments,
    jobs,
    notifications: [],
    events: buildTimeline(assignments.plans, jobs, scenario.hubs),
    clock: { phase: 'locked', playing: false, timeMin: 930, speed: 30 },
  };
}

function fixtureRelayRun(): Run {
  const router = createRouter(fixture.graph);
  const employees = fixture.employees.map((employee, index) => ({
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
    clientRequestId: 'spec7-fixture', label: 'Fixture relay', category: 'envelope',
    description: '', weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  };
  const context: MatchContext = {
    router, trips, employees, businesses: fixture.businesses, hubs: fixture.hubs, settings: { ...DEFAULT_SETTINGS },
  };
  const plan = generateCandidates(shipment, context).find((candidate) => candidate.kind === 'relay')!;
  const jobs = jobsFor([plan]);
  return {
    runId: 'spec7-fixture', version: 1,
    scenario: {
      schemaVersion: 1, name: 'Fixture', preset: 'fixture', seed: 1,
      graph: fixture.graph, businesses: fixture.businesses, hubs: fixture.hubs,
      employees, shipments: [shipment], settings: { ...DEFAULT_SETTINGS },
    },
    trips, assignments: { plans: [plan], unmatched: [], computeMs: 0 }, jobs, notifications: [],
    events: buildTimeline([plan], jobs, fixture.hubs),
    clock: { phase: 'locked', playing: false, timeMin: 930, speed: 30 },
  };
}

function pointFor(run: Run, nodeId: string): { x: number; y: number } {
  const node = run.scenario.graph.nodes.find((candidate) => candidate.id === nodeId)!;
  return { x: node.x, y: node.y };
}

function expectMarkerAtService(run: Run, plan: DeliveryPlan): void {
  for (const leg of plan.legs) {
    for (const stop of leg.stops) {
      for (const timeMin of [stop.serviceStartMin, stop.serviceEndMin - 1]) {
        const marker = snapshotAt(run, timeMin).markers.find((candidate) => candidate.employeeId === leg.employeeId);
        expect(marker, `${plan.id} ${stop.kind} at ${timeMin}`).toMatchObject({
          ...pointFor(run, stop.nodeId), servicing: true,
        });
      }
    }
  }
}

function expectCustodyMarkers(run: Run): void {
  for (const plan of run.assignments.plans) {
    const shipment = run.scenario.shipments.find((candidate) => candidate.id === plan.shipmentId)!;
    const origin = pointFor(run, run.scenario.businesses.find((business) => business.id === shipment.originBusinessId)!.nodeId);
    const destination = pointFor(run, run.scenario.businesses.find((business) => business.id === shipment.destinationBusinessId)!.nodeId);
    const firstPickup = plan.legs[0]!.stops[0]!;

    expect(snapshotAt(run, firstPickup.serviceEndMin - 1).packagePositions[shipment.id]).toEqual(origin);
    expectMarkerAtService(run, plan);

    if (plan.kind === 'relay') {
      const firstLeg = plan.legs[0]!;
      const hubDrop = firstLeg.stops[firstLeg.stops.length - 1]!;
      const hubPickup = plan.legs[1]!.stops[0]!;
      const hub = pointFor(run, hubDrop.nodeId);

      const atHub = snapshotAt(run, hubDrop.serviceEndMin);
      const beforeHubDrop = snapshotAt(run, hubDrop.serviceEndMin - 1);
      expect(atHub.shipmentStatus[shipment.id]).toBe('at_hub');
      expect(atHub.packagePositions[shipment.id]).toEqual(hub);
      expect(atHub.jobStatus[`${plan.id}-L0`]).toBe('completed');
      expect(atHub.earningsCents[firstLeg.employeeId]).toBeGreaterThanOrEqual(firstLeg.rewardCents);
      expect(atHub.earningsCents[firstLeg.employeeId] - beforeHubDrop.earningsCents[firstLeg.employeeId])
        .toBeGreaterThanOrEqual(firstLeg.rewardCents);
      expect(atHub.jobStatus[`${plan.id}-L1`]).toBe('assigned');

      const afterDrop = snapshotAt(run, hubDrop.serviceEndMin + 1);
      expect(afterDrop.packagePositions[shipment.id]).toEqual(hub);
      expect(afterDrop.markers.find((marker) => marker.employeeId === firstLeg.employeeId)?.carryingShipmentId)
        .not.toBe(shipment.id);
      expect(snapshotAt(run, hubPickup.serviceEndMin - 1).packagePositions[shipment.id]).toEqual(hub);
    }

    const delivered = snapshotAt(run, plan.deliveryMin);
    expect(delivered.shipmentStatus[shipment.id]).toBe('delivered');
    expect(delivered.packagePositions[shipment.id]).toEqual(destination);
    const finalLeg = plan.legs[plan.legs.length - 1]!;
    expect(delivered.earningsCents[finalLeg.employeeId]).toBeGreaterThanOrEqual(finalLeg.rewardCents);
    const beforeDelivery = snapshotAt(run, plan.deliveryMin - 1);
    expect(delivered.earningsCents[finalLeg.employeeId] - beforeDelivery.earningsCents[finalLeg.employeeId])
      .toBeGreaterThanOrEqual(finalLeg.rewardCents);
  }
}

function shuffledTimes(): number[] {
  const times = Array.from({ length: 2160 - 930 + 1 }, (_, index) => 930 + index);
  let state = 0x5EED1234;
  for (let index = times.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const other = state % (index + 1);
    [times[index], times[other]] = [times[other]!, times[index]!];
  }
  return times;
}

describe('spec §7 simulator rules', () => {
  it('keeps fixture and every Demo-city plan stationary during service and changes custody only on completion', () => {
    const fixtureRun = fixtureRelayRun();
    const demoRun = DEMO_RUN;

    expect(fixtureRun.assignments.plans).toHaveLength(1);
    expect(demoRun.assignments.plans.length).toBeGreaterThan(0);
    expectCustodyMarkers(fixtureRun);
    expectCustodyMarkers(demoRun);
  }, 30_000);

  it('is replay-equivalent in forward, reverse, and seeded-shuffled minute orders without decreasing earnings', () => {
    const run = DEMO_RUN;
    const expected = new Map<number, ReturnType<typeof snapshotAt>>();
    let previousEarnings = 0;

    for (let timeMin = 930; timeMin <= 2160; timeMin += 1) {
      const snapshot = snapshotAt(run, timeMin);
      expected.set(timeMin, snapshot);
      const earnings = Object.values(snapshot.earningsCents).reduce((sum, value) => sum + value, 0);
      expect(earnings).toBeGreaterThanOrEqual(previousEarnings);
      previousEarnings = earnings;
    }
    for (let timeMin = 2160; timeMin >= 930; timeMin -= 1) {
      expect(snapshotAt(run, timeMin)).toEqual(expected.get(timeMin));
    }
    for (const timeMin of shuffledTimes()) {
      expect(snapshotAt(run, timeMin)).toEqual(expected.get(timeMin));
    }
  }, 30_000);

  it('orders same-minute events by custody kind then plan ID, and never emits unmatched markers', () => {
    const leg = (kind: 'pickup' | 'hub_drop' | 'hub_pickup' | 'delivery', employeeId: string) => ({
      tripId: `${employeeId}-eve`, employeeId, routeNodeIds: ['A'], finishMin: 1000,
      extraMin: 0, extraDistanceM: 0, rewardCents: 300,
      stops: [{ kind, nodeId: 'A', arrivalMin: 998, serviceStartMin: 998, serviceEndMin: 1000 }],
    });
    const plans: DeliveryPlan[] = [
      { id: 'plan-z-drop', shipmentId: 'shp-z-drop', kind: 'relay', hubId: 'hub-1', deliveryMin: 1000, customerPriceCents: 0, platformContributionCents: 0, legs: [leg('hub_drop', 'emp-z')] },
      { id: 'plan-a-drop', shipmentId: 'shp-a-drop', kind: 'relay', hubId: 'hub-1', deliveryMin: 1000, customerPriceCents: 0, platformContributionCents: 0, legs: [leg('hub_drop', 'emp-a')] },
      { id: 'plan-z-pickup', shipmentId: 'shp-z-pickup', kind: 'relay', hubId: 'hub-1', deliveryMin: 1000, customerPriceCents: 0, platformContributionCents: 0, legs: [leg('hub_pickup', 'emp-zp')] },
      { id: 'plan-a-pickup', shipmentId: 'shp-a-pickup', kind: 'direct', deliveryMin: 1000, customerPriceCents: 0, platformContributionCents: 0, legs: [leg('pickup', 'emp-ap')] },
      { id: 'plan-z-delivered', shipmentId: 'shp-z-delivered', kind: 'direct', deliveryMin: 1000, customerPriceCents: 0, platformContributionCents: 0, legs: [leg('delivery', 'emp-zd')] },
    ];
    expect(buildTimeline(plans, [], [{ id: 'hub-1', name: 'Hub', nodeId: 'A' }]).map((event) => `${event.kind}:${event.planId}`)).toEqual([
      'hub_drop:plan-a-drop', 'hub_drop:plan-z-drop', 'hub_pickup:plan-z-pickup', 'pickup:plan-a-pickup', 'delivered:plan-z-delivered',
    ]);

    const unmatchedRun = UNMATCHED_RUN;
    for (const timeMin of [930, 1500, 2160]) {
      const snapshot = snapshotAt(unmatchedRun, timeMin);
      expect(Object.values(snapshot.shipmentStatus)).toEqual(['unmatched', 'unmatched', 'unmatched']);
      expect(snapshot.markers).toEqual([]);
      expect(snapshot.packagePositions).toEqual({});
    }
  }, 30_000);
});

const DEMO_RUN = runForScenario(generateScenario({
  preset: 'demo', seed: 0, employees: 60, packages: 24, hubs: 6, maxExtraMin: 8,
}));
const UNMATCHED_RUN = runForScenario(generateScenario({
  preset: 'random', seed: 7, employees: 0, packages: 3, hubs: 0, maxExtraMin: 8,
}));
