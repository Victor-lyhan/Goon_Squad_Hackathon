import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/schemas';
import type { Employee, Graph, Shipment } from '../../shared/types';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, generateCandidates, type MatchContext, type MatchMode } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';

function inputs() {
  const graph: Graph = {
    nodes: ['A', 'B', 'C', 'isolated'].map((id, x) => ({ id, x, y: 0 })),
    edges: [['A', 'B'], ['B', 'C']].flatMap(([from, to]) => [
      { from, to, durationMin: 5, distanceM: 500 },
      { from: to, to: from, durationMin: 5, distanceM: 500 },
    ]),
  };
  const employees: Employee[] = ['biz-a', 'biz-b'].map((businessId, index) => ({
    id: `emp-${index + 1}`, name: 'Carrier', businessId, homeNodeId: index === 0 ? 'C' : 'A',
    eveningDepartureMin: 1020, morningDepartureMin: 1920, maxExtraMin: 8,
    availableEvening: true, availableMorning: true, eveningViaNodeIds: [], morningViaNodeIds: [],
  }));
  const ctx: MatchContext = {
    router: createRouter(graph), employees, trips: [], settings: { ...DEFAULT_SETTINGS },
    businesses: [
      { id: 'biz-a', name: 'Sender', nodeId: 'A', district: 'Central' },
      { id: 'biz-b', name: 'Recipient', nodeId: 'C', district: 'Central' },
    ],
    hubs: [{ id: 'hub-a', name: 'Hub', nodeId: 'A' }],
  };
  const shipment: Shipment = {
    id: 'shp-1', clientRequestId: 'request-1', label: 'Documents', category: 'envelope',
    originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 2040,
    description: '', weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  };
  return { ctx, shipment };
}

function allocate(shipments: Shipment[], ctx: MatchContext, mode: MatchMode) {
  ctx.trips = ctx.employees.flatMap(employee => buildTrips(employee, ctx.businesses, ctx.router));
  const before = JSON.stringify({ shipments, ctx });
  const result = assignShipments(shipments, ctx, { mode });
  expect(assignShipments(shipments, ctx, { mode })).toEqual(result);
  expect(JSON.stringify({ shipments, ctx })).toBe(before);
  expect(result.computeMs).toBe(0);
  expect([...result.plans, ...result.unmatched].map(item => item.shipmentId).sort())
    .toEqual(shipments.map(shipment => shipment.id).sort());
  for (const item of result.unmatched) {
    expect(item.reason).not.toBe('No commute can carry this package within its times and added-time limits');
    expect(item.reason.trim()).not.toBe('');
  }
  const usedTrips = result.plans.flatMap(plan => plan.legs.map(leg => leg.tripId));
  expect(new Set(usedTrips).size).toBe(usedTrips.length);
  for (const plan of result.plans) {
    expect(plan.id).toBe(`plan-${plan.shipmentId}`);
    if (mode === 'direct_only') expect(plan.kind).toBe('direct');
    const shipment = shipments.find(item => item.id === plan.shipmentId)!;
    expect(plan.legs[0].stops[0].serviceStartMin).toBeGreaterThanOrEqual(shipment.readyMin);
    expect(plan.deliveryMin).toBeLessThanOrEqual(shipment.deadlineMin);
    for (const leg of plan.legs) {
      const trip = ctx.trips.find(item => item.id === leg.tripId)!;
      expect(leg.tripId).toBe(`${leg.employeeId}-${trip.direction === 'evening' ? 'eve' : 'morn'}`);
      expect(leg.extraMin).toBe(leg.finishMin - trip.departureMin - trip.baselineDurationMin);
      expect(leg.extraMin).toBeLessThanOrEqual(ctx.employees.find(item => item.id === leg.employeeId)!.maxExtraMin);
      expect(leg.stops[1].serviceStartMin).toBeGreaterThanOrEqual(leg.stops[0].serviceEndMin);
      expect(Number.isFinite(leg.finishMin)).toBe(true);
    }
  }
  return result;
}

const reasons = {
  employees: 'No employees are available to carry packages',
  unavailable: 'No commute is available after the package is ready',
  limit: "Every route would exceed the employees' added-time limit",
  window: 'The delivery window is too short for pickup and delivery handling',
  disconnected: 'No road route connects the sender to the recipient',
};

// Reuse generated data across modes; each allocation still gets its own router.
const cities = [1, 42, 93].map(seed => ({
  seed, scenario: generateScenario(GenerateScenarioRequest.parse({ preset: 'random', seed, hubs: 0 })),
}));

describe.each(['with_relay', 'direct_only'] as const)('matcher edge cases: %s', mode => {
  it.each(cities)('supports a generated zero-hub city, seed $seed', ({ scenario }) => {
    expect(scenario.hubs).toEqual([]);
    const result = allocate(scenario.shipments, { ...scenario, router: createRouter(scenario.graph), trips: [] }, mode);
    expect(result.plans.length).toBeGreaterThan(0);
    expect(result.plans.every(plan => plan.kind === 'direct')).toBe(true);
  }, 10_000);

  it.each(['evening', 'morning'] as const)('uses the other direction when every employee is unavailable in the %s', direction => {
    const { ctx, shipment } = inputs();
    for (const employee of ctx.employees) {
      if (direction === 'evening') employee.availableEvening = false;
      else employee.availableMorning = false;
    }
    const result = allocate([shipment], ctx, mode);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].legs).toHaveLength(1);
    expect(result.plans[0].legs[0].tripId).toBe(direction === 'evening' ? 'emp-2-morn' : 'emp-1-eve');
  });

  it.each(['employees', 'unavailable', 'limit', 'window', 'disconnected'] as const)('explains %s and accounts for every shipment', edge => {
    const { ctx, shipment } = inputs();
    if (edge === 'employees') ctx.employees = [];
    if (edge === 'unavailable') ctx.employees.forEach(employee => {
      employee.availableEvening = false;
      employee.availableMorning = false;
    });
    if (edge === 'limit') ctx.employees.forEach(employee => { employee.maxExtraMin = 0; });
    if (edge === 'window') shipment.readyMin = shipment.deadlineMin;
    if (edge === 'disconnected') ctx.businesses[1].nodeId = 'isolated';
    const result = allocate([shipment], ctx, mode);
    expect(result.plans).toEqual([]);
    expect(result.unmatched).toEqual([{ shipmentId: shipment.id, reason: reasons[edge] }]);
  });

  it('explains available trips belonging to the wrong business and direction', () => {
    const { ctx, shipment } = inputs();
    ctx.employees[0].availableEvening = false;
    ctx.employees[1].availableMorning = false;
    expect(allocate([shipment], ctx, mode).unmatched).toEqual([{
      shipmentId: shipment.id, reason: 'No sender evening commute or recipient morning commute is available',
    }]);
  });

  it('explains simultaneous deadline and added-time failures', () => {
    const { ctx, shipment } = inputs();
    ctx.employees.forEach(employee => { employee.maxExtraMin = 0; });
    shipment.deadlineMin = 1021;
    expect(allocate([shipment], ctx, mode).unmatched).toEqual([{
      shipmentId: shipment.id, reason: 'Delivery requires both a later deadline and a larger added-time limit',
    }]);
  });

  it.each(['A', 'C'] as const)('handles a hub at commute endpoint %s', nodeId => {
    const { ctx, shipment } = inputs();
    ctx.hubs[0].nodeId = nodeId;
    expect(allocate([shipment], ctx, mode).plans).toHaveLength(1);
    const candidates = generateCandidates(shipment, ctx, mode);
    expect(candidates.filter(plan => plan.kind === 'relay')).toHaveLength(mode === 'with_relay' ? 1 : 0);
    for (const plan of candidates) {
      for (const leg of plan.legs) {
        expect(leg.extraMin).toBe(4);
        expect(leg.extraDistanceM).toBe(0);
        expect(leg.stops.map(stop => stop.serviceEndMin - stop.serviceStartMin)).toEqual([2, 2]);
      }
    }
  });

  it('handles sender, recipient, hub and both commute endpoints sharing one node', () => {
    const { ctx, shipment } = inputs();
    ctx.businesses[1].nodeId = 'A';
    ctx.employees.forEach(employee => { employee.homeNodeId = 'A'; });
    const result = allocate([shipment], ctx, mode);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].legs[0]).toMatchObject({ routeNodeIds: ['A'], extraMin: 4, extraDistanceM: 0 });
    expect(result.plans[0].deliveryMin).toBe(1024);
    for (const plan of generateCandidates(shipment, ctx, mode)) {
      for (const leg of plan.legs) {
        expect(leg.stops[1].serviceStartMin).toBe(leg.stops[0].serviceEndMin);
      }
    }
  });
});
