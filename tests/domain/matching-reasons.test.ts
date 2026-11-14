import { describe, expect, it } from 'vitest';
import type { Employee, Graph, Shipment } from '../../shared/types';
import { assignShipments, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';

function inputs(direction: 'evening' | 'morning' = 'evening') {
  // Both businesses lie along a ten-minute commute; handling adds four minutes.
  const graph: Graph = {
    nodes: ['A', 'B', 'C'].map((id, x) => ({ id, x, y: 0 })),
    edges: [['A', 'B'], ['B', 'C']].flatMap(([from, to]) => [
      { from, to, durationMin: 5, distanceM: 500 },
      { from: to, to: from, durationMin: 5, distanceM: 500 },
    ]),
  };
  const employee: Employee = {
    id: 'emp-1', name: 'Alex', businessId: direction === 'evening' ? 'biz-a' : 'biz-b',
    homeNodeId: direction === 'evening' ? 'C' : 'A',
    eveningDepartureMin: 1020, morningDepartureMin: 1920, maxExtraMin: 8,
    availableEvening: direction === 'evening', availableMorning: direction === 'morning',
    eveningViaNodeIds: [], morningViaNodeIds: [],
  };
  const ctx: MatchContext = {
    router: createRouter(graph), employees: [employee], trips: [], hubs: [],
    businesses: [
      { id: 'biz-a', name: 'Sender', nodeId: 'A', district: 'Central' },
      { id: 'biz-b', name: 'Recipient', nodeId: 'B', district: 'Central' },
    ],
    settings: { ...DEFAULT_SETTINGS },
  };
  ctx.trips = buildTrips(employee, ctx.businesses, ctx.router);
  const shipment: Shipment = {
    id: 'shp-1', clientRequestId: 'request-1', label: 'Documents', category: 'envelope',
    originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 2040,
    description: '', weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  };
  return { ctx, shipment };
}

function expectReason(shipment: Shipment, ctx: MatchContext, reason: string) {
  const before = JSON.stringify({ shipment, employees: ctx.employees, trips: ctx.trips });
  expect(assignShipments([shipment], ctx)).toEqual({
    plans: [], unmatched: [{ shipmentId: shipment.id, reason }], computeMs: 0,
  });
  expect(JSON.stringify({ shipment, employees: ctx.employees, trips: ctx.trips })).toBe(before);
}

describe('user-facing unmatched reasons', () => {
  it.each(['evening', 'morning'] as const)('explains readiness beyond the %s commute waiting allowance', direction => {
    const { ctx, shipment } = inputs(direction);
    shipment.readyMin = ctx.trips[0].departureMin + 5;
    expectReason(shipment, ctx, 'No commute is available after the package is ready');
    // Departing before readiness is still valid when waiting fits the allowance.
    shipment.readyMin -= 1;
    expect(assignShipments([shipment], ctx).plans).toHaveLength(1);
  });

  it('explains unavailable commutes', () => {
    const { ctx, shipment } = inputs();
    ctx.trips = [];
    expectReason(shipment, ctx, 'No commute is available after the package is ready');
  });

  it('explains a deadline before delivery handling finishes', () => {
    const { ctx, shipment } = inputs();
    shipment.deadlineMin = 1028;
    expectReason(shipment, ctx, 'No commute can arrive before the deadline');
    shipment.deadlineMin = 1029;
    expect(assignShipments([shipment], ctx).plans).toHaveLength(1);
  });

  it('explains an added-time limit below the required handling time', () => {
    const { ctx, shipment } = inputs();
    ctx.employees[0].maxExtraMin = 3;
    expectReason(shipment, ctx, "Every route would exceed the employees' added-time limit");
    ctx.employees[0].maxExtraMin = 4;
    expect(assignShipments([shipment], ctx).plans).toHaveLength(1);
  });

  it('explains occupied trips, including preserved existing assignments', () => {
    const { ctx, shipment } = inputs();
    const second = { ...shipment, id: 'shp-2', clientRequestId: 'request-2', createdSeq: 2 };
    const expected = [{ shipmentId: second.id, reason: 'Every matching commute is already carrying a package' }];
    const first = assignShipments([shipment], ctx);
    expect(assignShipments([shipment, second], ctx).unmatched).toEqual(expected);
    expect(assignShipments([second], ctx, { existing: first.plans }).unmatched).toEqual(expected);
  });

  it('keeps a general explanation for an unreachable destination', () => {
    const { ctx, shipment } = inputs();
    ctx.businesses[1].nodeId = 'disconnected';
    expectReason(shipment, ctx, 'No commute can carry this package within its times and added-time limits');
  });
});
