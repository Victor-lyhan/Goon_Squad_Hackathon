import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Hub } from '../../shared/types';
import { buildTimeline } from '../../server/domain/simulation';

const hub: Hub = { id: 'hub-h', name: 'Hub H', nodeId: 'H' };

const relayPlan: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', hubId: 'hub-h', deliveryMin: 1961,
  customerPriceCents: 1000, platformContributionCents: 300,
  legs: [
    {
      tripId: 'emp-1-eve', employeeId: 'emp-1', routeNodeIds: ['A', 'H', 'X'],
      stops: [
        { kind: 'pickup', nodeId: 'A', arrivalMin: 1020, serviceStartMin: 1020, serviceEndMin: 1022 },
        { kind: 'hub_drop', nodeId: 'H', arrivalMin: 1032, serviceStartMin: 1032, serviceEndMin: 1034 },
      ],
      finishMin: 1046, extraMin: 6, extraDistanceM: 700, rewardCents: 300,
    },
    {
      tripId: 'emp-2-morn', employeeId: 'emp-2', routeNodeIds: ['Y', 'H', 'B'],
      stops: [
        { kind: 'hub_pickup', nodeId: 'H', arrivalMin: 1945, serviceStartMin: 1945, serviceEndMin: 1947 },
        { kind: 'delivery', nodeId: 'B', arrivalMin: 1959, serviceStartMin: 1959, serviceEndMin: 1961 },
      ],
      finishMin: 1961, extraMin: 6, extraDistanceM: 700, rewardCents: 300,
    },
  ],
};

describe('buildTimeline', () => {
  it('creates the four custody events for the spec relay plan', () => {
    expect(buildTimeline([relayPlan], [], [hub])).toEqual([
      { id: 'evt-plan-shp-1-0', timeMin: 1022, shipmentId: 'shp-1', planId: 'plan-shp-1', jobId: 'plan-shp-1-L0', kind: 'pickup', employeeId: 'emp-1', seq: 0 },
      { id: 'evt-plan-shp-1-1', timeMin: 1034, shipmentId: 'shp-1', planId: 'plan-shp-1', jobId: 'plan-shp-1-L0', kind: 'hub_drop', employeeId: 'emp-1', hubId: 'hub-h', seq: 1 },
      { id: 'evt-plan-shp-1-2', timeMin: 1947, shipmentId: 'shp-1', planId: 'plan-shp-1', jobId: 'plan-shp-1-L1', kind: 'hub_pickup', employeeId: 'emp-2', hubId: 'hub-h', seq: 2 },
      { id: 'evt-plan-shp-1-3', timeMin: 1961, shipmentId: 'shp-1', planId: 'plan-shp-1', jobId: 'plan-shp-1-L1', kind: 'delivered', employeeId: 'emp-2', seq: 3 },
    ]);
  });

  it('places a hub drop before a hub pickup at the same minute', () => {
    const hubPickupPlan: DeliveryPlan = {
      ...relayPlan,
      id: 'plan-a', shipmentId: 'shp-a',
      legs: [{ ...relayPlan.legs[1], stops: [{ ...relayPlan.legs[1].stops[0], serviceEndMin: 2000 }] }],
    };
    const hubDropPlan: DeliveryPlan = {
      ...relayPlan,
      id: 'plan-z', shipmentId: 'shp-z',
      legs: [{ ...relayPlan.legs[0], stops: [{ ...relayPlan.legs[0].stops[1], serviceEndMin: 2000 }] }],
    };

    const events = buildTimeline([hubPickupPlan, hubDropPlan], [], [hub]);
    expect(events.map(({ kind, planId, seq }) => ({ kind, planId, seq }))).toEqual([
      { kind: 'hub_drop', planId: 'plan-z', seq: 0 },
      { kind: 'hub_pickup', planId: 'plan-a', seq: 1 },
    ]);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const plans = [relayPlan];
    const originalPlans = structuredClone(plans);
    const first = buildTimeline(plans, [], [hub]);

    expect(buildTimeline(plans, [], [hub])).toEqual(first);
    expect(plans).toEqual(originalPlans);
  });
});
