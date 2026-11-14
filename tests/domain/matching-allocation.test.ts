import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Shipment } from '../../shared/types';
import { assignShipments, generateCandidates, type MatchContext } from '../../server/domain/matching';
import { generateScenario } from '../../server/domain/generator';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';

const noCommute = 'No commute can carry this package within its times and added-time limits';
const occupied = 'Every matching commute is already carrying a package';
function inputs() {
  const employees: Employee[] = fixture.employees.map((employee, i) => ({
    ...employee, name: employee.id, homeNodeId: i === 0 ? 'X' : 'Y',
    eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
    availableEvening: i === 0, availableMorning: i === 1,
    eveningViaNodeIds: [], morningViaNodeIds: [],
  }));
  const ctx: MatchContext = {
    router: createRouter(fixture.graph), employees, businesses: fixture.businesses,
    hubs: fixture.hubs, settings: { ...DEFAULT_SETTINGS }, trips: [],
  };
  rebuild(ctx);
  const shipment: Shipment = {
    ...fixture.shipment, clientRequestId: 'request-1', label: 'Test', category: 'envelope',
    description: '', weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  };
  return { ctx, shipment };
}
function rebuild(ctx: MatchContext) {
  ctx.trips = ctx.employees.flatMap(employee => buildTrips(employee, ctx.businesses, ctx.router));
}
function copy(shipment: Shipment, n: number): Shipment {
  return { ...shipment, id: `shp-${n}`, clientRequestId: `request-${n}`, createdSeq: n };
}

describe('assignShipments', () => {
  it('ranks carrier-plus-hub cost before extra time', () => {
    const { shipment, ctx } = inputs();
    ctx.router = createRouter({ ...fixture.graph, edges: [...fixture.graph.edges,
      { from: 'X', to: 'B', durationMin: 10, distanceM: 3500 },
      { from: 'B', to: 'X', durationMin: 10, distanceM: 3500 },
    ] });
    ctx.employees[0].maxExtraMin = 30;
    rebuild(ctx);
    const candidates = generateCandidates(shipment, ctx);
    expect(candidates.map(plan => plan.kind)).toEqual(['direct', 'relay']);
    expect(assignShipments([shipment], ctx).plans[0].kind).toBe('direct');
    // Zero rewards isolate hub cost: free relay wins on time only when its hub is free.
    ctx.settings.legRewardCents = 0;
    expect(assignShipments([shipment], ctx).plans[0].kind).toBe('direct');
    ctx.settings.hubCostCents = 0;
    expect(assignShipments([shipment], ctx).plans[0].kind).toBe('relay');
  });

  it('ranks total extra time, then delivery time, then the stable candidate order', () => {
    const { shipment, ctx } = inputs();
    ctx.employees[0].maxExtraMin = 12;
    ctx.employees.push({ ...ctx.employees[0], id: 'emp-3', eveningDepartureMin: 1024 });
    shipment.readyMin = 1025;
    rebuild(ctx);
    expect(assignShipments([shipment], ctx).plans[0].legs[0].tripId).toBe('emp-3-eve');
    shipment.readyMin = 960;
    ctx.employees.push({ ...ctx.employees[1], id: 'emp-4', morningDepartureMin: 1930 });
    ctx.hubs = [{ ...ctx.hubs[0], id: 'hub-z' }, { ...ctx.hubs[0], id: 'hub-a' }];
    rebuild(ctx);
    const [plan] = assignShipments([shipment], ctx).plans;
    expect(plan.legs.map(leg => leg.tripId)).toEqual(['emp-1-eve', 'emp-4-morn']);
    expect(plan.hubId).toBe('hub-a');
  });

  it('reserves both fixture trips for only one identical package, breaking ties by ID (spec 4)', () => {
    const { shipment, ctx } = inputs();
    const result = assignShipments([copy(shipment, 2), shipment], ctx);
    expect(result.plans).toEqual(generateCandidates(shipment, ctx));
    expect(result.unmatched).toEqual([{ shipmentId: 'shp-2', reason: occupied }]);
    expect(result.computeMs).toBe(0);
  });

  it('prioritizes the earliest deadline when candidate counts tie', () => {
    const { shipment, ctx } = inputs();
    const urgent = { ...copy(shipment, 2), deadlineMin: 1961 };
    expect(assignShipments([shipment, urgent], ctx).plans[0].shipmentId).toBe(urgent.id);
  });

  it('prioritizes fewer candidates before deadline, then falls back to an unused candidate', () => {
    const { shipment, ctx } = inputs();
    ctx.employees.push({ ...ctx.employees[0], id: 'emp-3', eveningDepartureMin: 1024 });
    rebuild(ctx);
    const constrained = { ...copy(shipment, 2), readyMin: 1025, deadlineMin: 2000 };
    expect(generateCandidates(shipment, ctx)).toHaveLength(2);
    expect(generateCandidates(constrained, ctx)).toHaveLength(1);
    expect(assignShipments([shipment, constrained], ctx).plans[0].shipmentId).toBe(constrained.id);
    // Provide a second morning trip so both packages can use different relay pairs.
    ctx.employees.push({ ...ctx.employees[1], id: 'emp-4' });
    rebuild(ctx);
    const result = assignShipments([shipment, constrained], ctx);
    expect(result.plans.map(plan => plan.shipmentId)).toEqual(['shp-1', 'shp-2']);
    const trips = result.plans.flatMap(plan => plan.legs.map(leg => leg.tripId));
    expect(new Set(trips).size).toBe(4);
  });

  it('preserves existing plans, skips replanning them, and never mutates inputs', () => {
    const { shipment, ctx } = inputs();
    const existing = generateCandidates(shipment, ctx);
    const shipments = [copy(shipment, 2), { ...shipment, deadlineMin: 0 }];
    const before = JSON.stringify({ existing, shipments, trips: ctx.trips, employees: ctx.employees });
    const result = assignShipments(shipments, ctx, { existing });
    expect(result.plans).toEqual(existing);
    expect(result.plans[0]).toBe(existing[0]);
    expect(result.unmatched).toEqual([{ shipmentId: 'shp-2', reason: occupied }]);
    expect(JSON.stringify({ existing, shipments, trips: ctx.trips, employees: ctx.employees })).toBe(before);
    expect(assignShipments([copy(shipment, 2)], ctx, { existing }).plans).toEqual(existing);
  });

  it('orders existing and new plans by creation sequence, then ID', () => {
    const { shipment, ctx } = inputs();
    const second = copy(shipment, 2);
    const tenth = copy(shipment, 10);
    const existing = generateCandidates(tenth, ctx);
    ctx.employees = ctx.employees.map(employee => ({ ...employee, id: `${employee.id}-new` }));
    rebuild(ctx);
    expect(assignShipments([tenth, second], ctx, { existing }).plans.map(plan => plan.shipmentId))
      .toEqual(['shp-2', 'shp-10']);
    expect(assignShipments([tenth, { ...second, createdSeq: 10 }], ctx, { existing }).plans.map(plan => plan.shipmentId))
      .toEqual(['shp-10', 'shp-2']);
  });

  it.each(['same', 'unknown-origin', 'unknown-destination', 'deadline'])('reports no feasible commute for %s', kind => {
    const { shipment, ctx } = inputs();
    if (kind === 'same') shipment.destinationBusinessId = shipment.originBusinessId;
    if (kind === 'unknown-origin') shipment.originBusinessId = 'missing';
    if (kind === 'unknown-destination') shipment.destinationBusinessId = 'missing';
    if (kind === 'deadline') shipment.deadlineMin = 1960;
    expect(assignShipments([shipment], ctx)).toEqual({ plans: [], unmatched: [{ shipmentId: shipment.id, reason: noCommute }], computeMs: 0 });
  });

  it('honors disabled evening availability after rebuilding trips (spec 10)', () => {
    const { shipment, ctx } = inputs();
    expect(assignShipments([shipment], ctx).plans).toHaveLength(1);
    ctx.employees[0].availableEvening = false;
    rebuild(ctx);
    expect(assignShipments([shipment], ctx).unmatched).toEqual([{ shipmentId: shipment.id, reason: noCommute }]);
  });

  it('honors a saved waypoint that makes the hub detour exceed the limit (spec 10)', () => {
    const { shipment, ctx } = inputs();
    ctx.router = createRouter({ nodes: [...fixture.graph.nodes, { id: 'W', x: 3, y: 3 }], edges: [
      ...fixture.graph.edges,
      { from: 'A', to: 'W', durationMin: 10, distanceM: 3500 },
      { from: 'W', to: 'X', durationMin: 10, distanceM: 3500 },
      { from: 'H', to: 'W', durationMin: 20, distanceM: 7000 },
      { from: 'W', to: 'H', durationMin: 20, distanceM: 7000 },
    ] });
    rebuild(ctx);
    expect(assignShipments([shipment], ctx).plans).toHaveLength(1);
    ctx.employees[0].eveningViaNodeIds = ['W'];
    rebuild(ctx);
    expect(ctx.trips[0].baselineNodeIds).toEqual(['A', 'W', 'X']);
    expect(assignShipments([shipment], ctx).plans).toEqual([]);
    ctx.employees[0].maxExtraMin = 24;
    expect(generateCandidates(shipment, ctx)[0].legs[0].extraMin).toBe(24);
  });

  it('returns identical assignments for scenarios generated with identical options (spec 7)', () => {
    const allocate = () => {
      const scenario = generateScenario({ seed: 42, employees: 60, packages: 24, hubs: 6, maxExtraMin: 8, preset: 'demo' });
      const ctx: MatchContext = { ...scenario, router: createRouter(scenario.graph), trips: [] };
      rebuild(ctx);
      return assignShipments(scenario.shipments, ctx);
    };
    const result = allocate();
    expect(result.plans.length).toBeGreaterThan(0);
    expect(allocate()).toEqual(result);
  });
});
