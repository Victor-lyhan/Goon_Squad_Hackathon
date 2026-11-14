import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Shipment, Trip } from '../../shared/types';
import { assignShipments, compareAssignments, generateCandidates, type MatchContext } from '../../server/domain/matching';
import { DEMO_SCENARIO_OPTIONS, generateScenario } from '../../server/domain/generator';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';

function fixtureInputs(): { shipment: Shipment; ctx: MatchContext } {
  const router = createRouter(fixture.graph);
  const employees: Employee[] = fixture.employees.map((employee, i) => ({
    ...employee, name: employee.id, homeNodeId: i === 0 ? 'X' : 'Y',
    eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
    availableEvening: i === 0, availableMorning: i === 1,
    eveningViaNodeIds: [], morningViaNodeIds: [],
  }));
  const trips: Trip[] = fixture.trips.map(trip => {
    const route = router.shortestPath(trip.originNodeId, trip.destinationNodeId)!;
    return { ...trip, direction: trip.direction as Trip['direction'], baselineNodeIds: route.nodeIds,
      baselineDurationMin: route.durationMin, baselineDistanceM: route.distanceM };
  });
  return {
    shipment: { ...fixture.shipment, clientRequestId: 'request-1', label: 'Test', category: 'envelope',
      description: '', weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1 },
    ctx: { router, employees, trips, businesses: fixture.businesses, hubs: fixture.hubs, settings: { ...DEFAULT_SETTINGS } },
  };
}

function demoInputs(): { shipments: Shipment[]; ctx: MatchContext } {
  const scenario = generateScenario(DEMO_SCENARIO_OPTIONS);
  const router = createRouter(scenario.graph);
  return {
    shipments: scenario.shipments,
    ctx: {
      router,
      trips: scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router)),
      employees: scenario.employees, businesses: scenario.businesses,
      hubs: scenario.hubs, settings: scenario.settings,
    },
  };
}

describe('matching modes', () => {
  it('defaults to relay-enabled matching and skips relay candidates in direct-only mode', () => {
    const { shipment, ctx } = fixtureInputs();
    expect(generateCandidates(shipment, ctx, 'direct_only')).toEqual([]);
    expect(generateCandidates(shipment, ctx, 'with_relay')).toEqual(generateCandidates(shipment, ctx));
    expect(assignShipments([shipment], ctx, { mode: 'with_relay' })).toEqual(assignShipments([shipment], ctx));
    expect(assignShipments([shipment], ctx).plans).toHaveLength(1);
    expect(assignShipments([shipment], ctx, { mode: 'direct_only' }).plans).toEqual([]);
  });

  it('continues to respect the scenario relay setting', () => {
    const { shipment, ctx } = fixtureInputs();
    ctx.settings.allowRelay = false;
    const result = compareAssignments([shipment], ctx);
    expect(result.withRelay.plans).toEqual([]);
    expect(result.withRelay).toEqual(result.directOnly);
  });
});

describe('compareAssignments', () => {
  it('matches the spec fixture only when relay is enabled', () => {
    const { shipment, ctx } = fixtureInputs();
    const { directOnly, withRelay } = compareAssignments([shipment], ctx);
    expect(directOnly.plans).toEqual([]);
    expect(directOnly.unmatched).toEqual([{ shipmentId: shipment.id, reason: expect.any(String) }]);
    expect(withRelay.unmatched).toEqual([]);
    expect(withRelay.plans).toHaveLength(1);
    expect(withRelay.plans[0]).toMatchObject({ id: 'plan-shp-1', kind: 'relay', hubId: 'hub-h', deliveryMin: 1961 });
    expect(directOnly.computeMs).toBe(0);
    expect(withRelay.computeMs).toBe(0);
  });

  it('matches at least as many demo shipments with relay and allocates each side independently', () => {
    const { shipments, ctx } = demoInputs();
    const { directOnly, withRelay } = compareAssignments(shipments, ctx);
    expect(directOnly.plans.length).toBeGreaterThan(0);
    expect(directOnly.plans.every(plan => plan.kind === 'direct')).toBe(true);
    expect(withRelay.plans.length).toBeGreaterThanOrEqual(directOnly.plans.length);
    expect(directOnly).toEqual(assignShipments(shipments, ctx, { mode: 'direct_only' }));
    expect(withRelay).toEqual(assignShipments(shipments, ctx));
    expect(directOnly.computeMs).toBe(0);
    expect(withRelay.computeMs).toBe(0);
  });

  it.each(['fixture', 'demo'] as const)('preserves %s inputs and returns identical results on repeated calls', source => {
    const { shipments, ctx } = source === 'demo' ? demoInputs() : (() => {
      const { shipment, ctx } = fixtureInputs();
      return { shipments: [shipment], ctx };
    })();
    // The router exposes a function with a private cache; clone all input data
    // and separately retain its public function identity for the equality check.
    const { router, ...data } = ctx;
    const before = { ...structuredClone({ shipments, ctx: data }), router: { ...router } };
    const first = compareAssignments(shipments, ctx);
    expect(compareAssignments(shipments, ctx)).toEqual(first);
    const { router: afterRouter, ...afterData } = ctx;
    expect({ shipments, ctx: afterData, router: afterRouter }).toEqual(before);
  });
});
