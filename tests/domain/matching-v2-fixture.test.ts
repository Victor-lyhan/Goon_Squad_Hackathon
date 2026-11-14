import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import { createRouter } from '../../server/domain/routing';
import { buildTrips } from '../../server/domain/v2/trips';
import { assignShipments, type MatchContext } from '../../server/domain/v2/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { pairKey } from '../../shared/v2/types';
import { business, employee, shipment, TableTravel } from './matching-v2-helpers';

const router = createRouter(fixture.graph);
const places = { 'biz-a': 'A', 'biz-b': 'B', 'biz-h': 'H', 'home-x': 'X', 'home-y': 'Y' };
const travel = new TableTravel();
for (const [from, nodeFrom] of Object.entries(places)) {
  for (const [to, nodeTo] of Object.entries(places)) {
    const route = router.shortestPath(nodeFrom, nodeTo);
    // The fixture explicitly has no other roads. Infinity is the known shortest
    // path distance for unreachable pairs, not missing/estimated travel data.
    travel.pairs[pairKey(from, to)] = {
      durationMin: route?.durationMin ?? Infinity, distanceM: route?.distanceM ?? Infinity,
    };
  }
}
const employees = [
  employee('emp-1', 'biz-a', { homeId: 'home-x', availableMorning: false }),
  employee('emp-2', 'biz-b', { homeId: 'home-y', availableEvening: false }),
];
const ctx: MatchContext = { travel, employees, trips: employees.flatMap(e => buildTrips(e, travel)),
  businesses: ['biz-a', 'biz-b', 'biz-h'].map(business), settings: { ...DEFAULT_SETTINGS } };

describe('v2 spec §9 on a shortest-path table', () => {
  it('preserves the carriers, stop times, detours and prices', () => {
    const result = assignShipments([shipment()], ctx);
    expect(result.unmatched).toEqual([]);
    expect(result.computeMs).toBe(0);
    expect(result.plans).toHaveLength(1);
    const plan = result.plans[0];
    expect(plan).toMatchObject({ kind: 'relay', relayBusinessId: 'biz-h', deliveryMin: 1961,
      customerPriceCents: 1000, platformContributionCents: 300 });
    expect(plan.legs.map(l => l.employeeId)).toEqual(['emp-1', 'emp-2']);
    expect(plan.legs.map(l => l.placeIds)).toEqual([['biz-a', 'biz-h', 'home-x'], ['home-y', 'biz-h', 'biz-b']]);
    for (const [i, expected] of fixture.expected.legs.entries()) {
      expect(plan.legs[i]).toMatchObject({ tripId: expected.tripId, finishMin: expected.finishMin,
        extraMin: expected.extraMin, extraDistanceM: expected.extraDistanceM, rewardCents: expected.rewardCents });
      expect(plan.legs[i].stops.map(({ placeId, ...stop }) => stop)).toMatchObject(
        expected.stops.map(({ nodeId, ...stop }) => stop));
    }
    expect(plan.legs.map(l => l.stops.map(s => s.arrivalMin))).toEqual([[1020, 1032], [1945, 1959]]);
  });
  it.each([0, 1])('fails when carrier %i has only five extra minutes', index => {
    expect(assignShipments([shipment()], { ...ctx, employees: employees.map((e, i) =>
      ({ ...e, maxExtraMin: i === index ? 5 : 8 })) }).plans).toEqual([]);
  });
});
