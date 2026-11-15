import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import { buildTrips } from '../../server/domain/v2/trips';
import { assignShipments, type MatchContext } from '../../server/domain/v2/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { business, employee, shipment } from './matching-v2-helpers';
import { relayFixtureTravel } from './matching-v2-grid-helper';

// Shortest paths on the fixture's one-way roads. The fixture explicitly has no
// other roads: Infinity is the known shortest path distance for unreachable
// pairs, not missing/estimated travel data.
const travel = relayFixtureTravel();
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
      // #861: two legs at 300 + relay fee 50 + platform fee 400 (window 960 to 1980, under 18 h); 1050 - 600 - 50 - 50 = 350.
      customerPriceCents: 1050, platformContributionCents: 350 });
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
