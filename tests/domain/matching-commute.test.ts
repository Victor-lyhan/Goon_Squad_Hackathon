import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import demo from '../../fixtures/demoScenario.json';
import type { AssignmentResult, Employee, Scenario, Shipment } from '../../shared/types';
import { assignShipments, type MatchContext, type MatchMode } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';

function fixtureInputs() {
  const employees: Employee[] = fixture.employees.map((employee, i) => ({
    ...employee, name: employee.id, homeNodeId: i === 0 ? 'X' : 'Y',
    eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
    availableEvening: i === 0, availableMorning: i === 1,
    eveningViaNodeIds: [], morningViaNodeIds: [],
  }));
  const ctx: MatchContext = {
    router: createRouter(fixture.graph), employees, businesses: structuredClone(fixture.businesses),
    hubs: structuredClone(fixture.hubs), settings: { ...DEFAULT_SETTINGS }, trips: [],
  };
  const shipment: Shipment = {
    ...fixture.shipment, clientRequestId: 'request-1', label: 'Commute test', category: 'envelope',
    description: '', weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  };
  return { ctx, shipments: [shipment] };
}

// Model saved Employee data, rebuilding derived trips on every call. These are
// full recomputes: passing `existing` would intentionally preserve reserved plans.
function match(shipments: Shipment[], ctx: MatchContext, mode: MatchMode) {
  const run = () => {
    ctx.trips = ctx.employees.flatMap(employee => buildTrips(employee, ctx.businesses, ctx.router));
    return assignShipments(shipments, ctx, { mode });
  };
  const result = run();
  const trips = structuredClone(ctx.trips);
  expect(run()).toEqual(result);
  expect(ctx.trips).toEqual(trips);
  for (const trip of ctx.trips) {
    expect(trip.id).toBe(`${trip.employeeId}-${trip.direction === 'evening' ? 'eve' : 'morn'}`);
  }
  for (const plan of result.plans) {
    expect(plan.id).toBe(`plan-${plan.shipmentId}`);
    for (const leg of plan.legs) {
      expect(ctx.trips.find(trip => trip.id === leg.tripId)?.employeeId).toBe(leg.employeeId);
    }
  }
  return result;
}

function expectUnmatched(result: AssignmentResult, shipmentId: string) {
  expect(result.plans.some(plan => plan.shipmentId === shipmentId)).toBe(false);
  expect(result.unmatched).toContainEqual({ shipmentId, reason: expect.stringMatching(/\S/) });
}

describe.each(['with_relay', 'direct_only'] as const)('saved commutes (%s, spec 10)', { timeout: 10_000 }, mode => {
  it.each([
    { index: 0, field: 'availableEvening', tripId: 'emp-1-eve' },
    { index: 1, field: 'availableMorning', tripId: 'emp-2-morn' },
  ] as const)('removes $tripId when $field is disabled and restores it when enabled', ({ index, field, tripId }) => {
    const { ctx, shipments } = fixtureInputs();
    const before = match(shipments, ctx, mode);
    if (mode === 'with_relay') {
      expect(before.plans).toHaveLength(1);
      expect(before.plans[0]).toMatchObject({ id: 'plan-shp-1', kind: 'relay' });
      expect(before.plans[0].legs.map(leg => leg.tripId)).toEqual(['emp-1-eve', 'emp-2-morn']);
    } else {
      // The unmodified fixture has no direct route, even with both trips enabled.
      expectUnmatched(before, 'shp-1');
    }
    ctx.employees[index][field] = false;
    const disabled = match(shipments, ctx, mode);
    expect(ctx.trips.map(trip => trip.id)).not.toContain(tripId);
    expect(disabled.plans.flatMap(plan => plan.legs).some(leg => leg.tripId === tripId)).toBe(false);
    expectUnmatched(disabled, 'shp-1');
    ctx.employees[index][field] = true;
    expect(match(shipments, ctx, mode)).toEqual(before);
  });

  it('adds a direct assignment when a saved morning waypoint passes the sender, then removes it', () => {
    const { ctx, shipments } = fixtureInputs();
    // Use the fixture roads with the sender at H: Y -> B takes 20 min,
    // Y -> H -> B takes 22. With a 5-min limit, only the saved route can
    // accommodate pickup and delivery (4 min handling, no extra driving).
    ctx.businesses[0].nodeId = 'H';
    const employee = ctx.employees[1];
    employee.maxExtraMin = 5;
    const before = match(shipments, ctx, mode);
    expectUnmatched(before, 'shp-1');
    expect(ctx.trips.find(trip => trip.id === 'emp-2-morn')?.baselineNodeIds).toEqual(['Y', 'B']);

    employee.morningViaNodeIds = ['H'];
    const via = match(shipments, ctx, mode);
    expect(ctx.trips.find(trip => trip.id === 'emp-2-morn')).toMatchObject({
      baselineNodeIds: ['Y', 'H', 'B'], baselineDurationMin: 22,
    });
    expect(via.unmatched).toEqual([]);
    expect(via.plans).toHaveLength(1);
    expect(via.plans[0]).toMatchObject({
      id: 'plan-shp-1', kind: 'direct', legs: [{
        employeeId: 'emp-2', tripId: 'emp-2-morn', routeNodeIds: ['Y', 'H', 'B'],
        extraMin: 4, extraDistanceM: 0,
      }],
    });

    employee.availableMorning = false;
    expectUnmatched(match(shipments, ctx, mode), 'shp-1');
    employee.availableMorning = true;
    expect(match(shipments, ctx, mode)).toEqual(via);

    employee.maxExtraMin = 4; // Equality is feasible; one minute below is not.
    expect(match(shipments, ctx, mode)).toEqual(via);
    employee.maxExtraMin = 3;
    expectUnmatched(match(shipments, ctx, mode), 'shp-1');
    employee.maxExtraMin = 5;
    employee.morningViaNodeIds = [];
    expect(match(shipments, ctx, mode)).toEqual(before);
  });

  it('reassigns or unmatches a Demo city package when its carrier lowers the added-time limit', () => {
    const scenario = structuredClone(demo) as Scenario;
    const ctx: MatchContext = { ...scenario, router: createRouter(scenario.graph), trips: [] };
    const before = match(scenario.shipments, ctx, mode);
    const plan = before.plans.find(candidate => candidate.kind === 'direct');
    expect(plan).toBeDefined();
    const leg = plan!.legs[0];
    const employee = ctx.employees.find(candidate => candidate.id === leg.employeeId)!;
    const savedLimit = employee.maxExtraMin;
    expect(leg.extraMin).toBeGreaterThan(0);
    employee.maxExtraMin = leg.extraMin;
    expect(match(scenario.shipments, ctx, mode)).toEqual(before);
    employee.maxExtraMin = leg.extraMin - 1;
    const reduced = match(scenario.shipments, ctx, mode);
    const replacement = reduced.plans.find(candidate => candidate.shipmentId === plan!.shipmentId);
    if (replacement) {
      expect(replacement.id).toBe(plan!.id);
      expect(replacement.legs.map(candidate => candidate.tripId)).not.toContain(leg.tripId);
    } else {
      expectUnmatched(reduced, plan!.shipmentId);
    }
    for (const assigned of reduced.plans.flatMap(candidate => candidate.legs)) {
      if (assigned.employeeId === employee.id) expect(assigned.extraMin).toBeLessThanOrEqual(employee.maxExtraMin);
    }
    employee.maxExtraMin = savedLimit;
    expect(match(scenario.shipments, ctx, mode)).toEqual(before);
  });
});

it.each([0, 1])('rejects the fixture relay when carrier %i lowers the limit below its added minutes', index => {
  const { ctx, shipments } = fixtureInputs();
  const before = match(shipments, ctx, 'with_relay');
  expect(before.plans).toHaveLength(1);
  const leg = before.plans[0].legs[index];
  expect(leg.extraMin).toBe(6);
  ctx.employees[index].maxExtraMin = leg.extraMin;
  expect(match(shipments, ctx, 'with_relay')).toEqual(before);
  ctx.employees[index].maxExtraMin = leg.extraMin - 1;
  expectUnmatched(match(shipments, ctx, 'with_relay'), 'shp-1');
  ctx.employees[index].maxExtraMin = 8;
  expect(match(shipments, ctx, 'with_relay')).toEqual(before);
});
