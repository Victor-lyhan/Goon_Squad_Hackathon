import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Shipment, Trip } from '../../shared/types';
import { generateCandidates, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { createRouter } from '../../server/domain/routing';

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

describe('generateCandidates', () => {
  it('reproduces the exact spec relay schedule, distance, IDs and pricing (spec 1)', () => {
    const { shipment, ctx } = fixtureInputs();
    const plans = generateCandidates(shipment, ctx);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({
      id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', hubId: 'hub-h',
      deliveryMin: 1961, customerPriceCents: 1000, platformContributionCents: 300,
      legs: fixture.expected.legs.map((leg, i) => ({
        tripId: leg.tripId, employeeId: ctx.trips[i].employeeId,
        routeNodeIds: i === 0 ? ['A', 'H', 'X'] : ['Y', 'H', 'B'],
        stops: leg.stops.map(stop => ({ arrivalMin: stop.serviceStartMin, ...stop })),
        finishMin: leg.finishMin, extraMin: leg.extraMin,
        extraDistanceM: leg.extraDistanceM, rewardCents: leg.rewardCents,
      })),
    });
  });

  it('rejects either leg over its employee limit (spec 2)', () => {
    for (const index of [0, 1]) {
      const { shipment, ctx } = fixtureInputs();
      ctx.employees[index].maxExtraMin = 5;
      expect(generateCandidates(shipment, ctx)).toEqual([]);
    }
  });

  it('requires delivery handling to complete by the deadline (spec 3)', () => {
    const { shipment, ctx } = fixtureInputs();
    expect(generateCandidates({ ...shipment, deadlineMin: 1960 }, ctx)).toEqual([]);
    expect(generateCandidates({ ...shipment, deadlineMin: 1961 }, ctx)).toHaveLength(1);
  });

  it('waits for readiness and hub deposit, counting both waits (spec 5)', () => {
    const { shipment, ctx } = fixtureInputs();
    shipment.readyMin = 1022;
    shipment.deadlineMin = 1100;
    ctx.trips[1].departureMin = 1025;
    const [plan] = generateCandidates(shipment, ctx);
    expect(plan.legs[0].stops[0]).toMatchObject({ arrivalMin: 1020, serviceStartMin: 1022, serviceEndMin: 1024 });
    expect(plan.legs[0].stops[1].serviceEndMin).toBe(1036);
    expect(plan.legs[0].extraMin).toBe(8);
    expect(plan.legs[1].stops[0]).toMatchObject({ arrivalMin: 1035, serviceStartMin: 1036, serviceEndMin: 1038 });
    expect(plan.legs[1].extraMin).toBe(7);
    ctx.employees[1].maxExtraMin = 6;
    expect(generateCandidates(shipment, ctx)).toEqual([]);
  });

  it('uses only supplied trips and respects the relay setting and employers', () => {
    const { shipment, ctx } = fixtureInputs();
    expect(generateCandidates(shipment, { ...ctx, trips: ctx.trips.slice(0, 1) })).toEqual([]);
    expect(generateCandidates(shipment, { ...ctx, settings: { ...ctx.settings, allowRelay: false } })).toEqual([]);
    ctx.employees[0].businessId = 'biz-b';
    expect(generateCandidates(shipment, ctx)).toEqual([]);
  });

  it('disallows a relay carried by the same employee', () => {
    const { shipment, ctx } = fixtureInputs();
    // Co-located employers let one employee qualify for both directions.
    shipment.destinationBusinessId = shipment.originBusinessId;
    ctx.trips[1].employeeId = ctx.employees[0].id;
    ctx.businesses = ctx.businesses.map(b => b.id === 'biz-a' ? { ...b, nodeId: 'B' } : b);
    expect(generateCandidates(shipment, ctx).filter(plan => plan.kind === 'relay')).toEqual([]);
  });

  it.each(['evening', 'morning'] as const)('schedules %s direct with endpoint handling and custom pricing', direction => {
    const { shipment, ctx } = fixtureInputs();
    // The business stop is already on the baseline, so only handling is added.
    const trip = ctx.trips[direction === 'evening' ? 0 : 1];
    ctx.trips = [trip];
    ctx.settings = { ...ctx.settings, handlingMin: 3, legRewardCents: 250, priceCents: 1100 };
    if (direction === 'evening') {
      ctx.businesses = ctx.businesses.map(b => b.id === 'biz-b' ? { ...b, nodeId: 'X' } : b);
    } else {
      ctx.businesses = ctx.businesses.map(b => b.id === 'biz-a' ? { ...b, nodeId: 'Y' } : b);
      shipment.readyMin = trip.departureMin + 2;
    }
    const [plan] = generateCandidates(shipment, ctx);
    expect(plan).toMatchObject({ kind: 'direct', customerPriceCents: 1100, platformContributionCents: 800 });
    expect(plan.hubId).toBeUndefined();
    expect(plan.legs[0]).toMatchObject({ extraMin: direction === 'evening' ? 6 : 8, extraDistanceM: 0, rewardCents: 250 });
    expect(plan.legs[0].stops.map(stop => stop.serviceEndMin - stop.serviceStartMin)).toEqual([3, 3]);
    expect(plan.deliveryMin).toBe(plan.legs[0].finishMin);
  });

  it('tries later route occurrences when earlier pickup waiting exceeds the limit', () => {
    const { shipment, ctx } = fixtureInputs();
    ctx.router = createRouter({ nodes: ['Y', 'A', 'C', 'B'].map(id => ({ id, x: 0, y: 0 })), edges: [
      { from: 'Y', to: 'A', durationMin: 1, distanceM: 100 },
      { from: 'A', to: 'C', durationMin: 5, distanceM: 500 },
      { from: 'C', to: 'A', durationMin: 5, distanceM: 500 },
      { from: 'A', to: 'B', durationMin: 1, distanceM: 100 },
    ] });
    ctx.trips = [{ ...ctx.trips[1], baselineNodeIds: ['Y', 'A', 'C', 'A', 'B'], baselineDurationMin: 12, baselineDistanceM: 1200 }];
    shipment.readyMin = 1946;
    const [plan] = generateCandidates(shipment, ctx);
    expect(plan.legs[0].routeNodeIds).toEqual(['Y', 'A', 'C', 'A', 'B']);
    expect(plan.legs[0].stops[0].arrivalMin).toBe(1946);
    expect(plan.legs[0].extraMin).toBe(4);
  });

  it('sorts by kind, trip IDs and hub ID independently of input order, without mutation', () => {
    const { shipment, ctx } = fixtureInputs();
    ctx.hubs.push({ ...ctx.hubs[0], id: 'hub-a' });
    const before = JSON.stringify({ shipment, ctx });
    const expected = generateCandidates(shipment, ctx);
    expect(expected.map(plan => plan.hubId)).toEqual(['hub-a', 'hub-h']);
    expect(generateCandidates(shipment, { ...ctx, trips: [...ctx.trips].reverse(), hubs: [...ctx.hubs].reverse() })).toEqual(expected);
    expect(JSON.stringify({ shipment, ctx })).toBe(before);
  });
});
