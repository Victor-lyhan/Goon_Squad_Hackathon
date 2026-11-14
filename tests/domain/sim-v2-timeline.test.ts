import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Job } from '../../shared/v2/types.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';

const direct: DeliveryPlan = {
  id: 'plan-direct', shipmentId: 'shp-direct', kind: 'direct', deliveryMin: 110,
  customerPriceCents: 1000, platformContributionCents: 650,
  legs: [{
    tripId: 'emp-direct-eve', employeeId: 'emp-direct', placeIds: ['biz-a', 'biz-b', 'home-a'],
    stops: [
      { placeId: 'biz-a', kind: 'pickup', arrivalMin: 98, serviceStartMin: 98, serviceEndMin: 100 },
      { placeId: 'biz-b', kind: 'delivery', arrivalMin: 108, serviceStartMin: 108, serviceEndMin: 110 },
    ],
    finishMin: 115, extraMin: 4, extraDistanceM: 400, rewardCents: 300,
  }],
};

const relay: DeliveryPlan = {
  id: 'plan-relay', shipmentId: 'shp-relay', kind: 'relay', relayBusinessId: 'biz-relay', deliveryMin: 210,
  customerPriceCents: 1000, platformContributionCents: 300,
  legs: [
    {
      tripId: 'emp-evening-eve', employeeId: 'emp-evening', placeIds: ['biz-a', 'biz-relay', 'home-a'],
      stops: [
        { placeId: 'biz-a', kind: 'pickup', arrivalMin: 118, serviceStartMin: 118, serviceEndMin: 120 },
        { placeId: 'biz-relay', kind: 'hub_drop', arrivalMin: 128, serviceStartMin: 128, serviceEndMin: 130 },
      ],
      finishMin: 135, extraMin: 5, extraDistanceM: 500, rewardCents: 300,
    },
    {
      tripId: 'emp-morning-morn', employeeId: 'emp-morning', placeIds: ['home-b', 'biz-relay', 'biz-b'],
      stops: [
        { placeId: 'biz-relay', kind: 'hub_pickup', arrivalMin: 198, serviceStartMin: 198, serviceEndMin: 200 },
        { placeId: 'biz-b', kind: 'delivery', arrivalMin: 208, serviceStartMin: 208, serviceEndMin: 210 },
      ],
      finishMin: 210, extraMin: 6, extraDistanceM: 600, rewardCents: 300,
    },
  ],
};

function jobsFor(plan: DeliveryPlan): Job[] {
  return plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`, planId: plan.id, shipmentId: plan.shipmentId,
    employeeId: leg.employeeId, legIndex, tripId: leg.tripId,
    pickup: leg.stops[0]!, dropoff: leg.stops.at(-1)!, rewardCents: leg.rewardCents,
  }));
}

describe('v2 buildTimeline', () => {
  it('emits direct and relay custody events with relay business IDs only at relay points', () => {
    const events = buildTimeline([direct, relay], [...jobsFor(direct), ...jobsFor(relay)]);

    expect(events.map((event) => [event.kind, event.timeMin, event.relayBusinessId])).toEqual([
      ['pickup', 100, undefined], ['delivered', 110, undefined], ['pickup', 120, undefined],
      ['hub_drop', 130, 'biz-relay'], ['hub_pickup', 200, 'biz-relay'], ['delivered', 210, undefined],
    ]);
    expect(events.map((event) => event.id)).toEqual([
      'evt-plan-direct-0', 'evt-plan-direct-1', 'evt-plan-relay-0',
      'evt-plan-relay-1', 'evt-plan-relay-2', 'evt-plan-relay-3',
    ]);
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('uses event kind then plan ID for equal-minute ties and is independent of plan input order', () => {
    const tiedDirect = { ...direct, id: 'plan-z', shipmentId: 'shp-z', legs: [{
      ...direct.legs[0]!, stops: direct.legs[0]!.stops.map((stop) => ({ ...stop, serviceEndMin: 300 })),
    }] };
    const tiedRelay = { ...relay, id: 'plan-a', shipmentId: 'shp-a', legs: relay.legs.map((leg) => ({
      ...leg, stops: leg.stops.map((stop) => ({ ...stop, serviceEndMin: 300 })),
    })) };
    const forward = buildTimeline([tiedDirect, tiedRelay], []);
    const reversed = buildTimeline([tiedRelay, tiedDirect], []);

    expect(forward).toEqual(reversed);
    expect(forward.map((event) => `${event.kind}:${event.planId}:${event.seq}`)).toEqual([
      'hub_drop:plan-a:0', 'hub_pickup:plan-a:1', 'pickup:plan-a:2',
      'pickup:plan-z:3', 'delivered:plan-a:4', 'delivered:plan-z:5',
    ]);
  });
});
