import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Job, Shipment } from '../../shared/v2/types.js';
import { buildTimeline, progressAt } from '../../server/domain/v2/timeline.js';

const shipment = (id: string): Shipment => ({
  id, clientRequestId: `req-${id}`, label: id, originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 0, deadlineMin: 300, category: 'small_box', description: '', weightGrams: 100,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
});

const relay: DeliveryPlan = {
  id: 'plan-relay', shipmentId: 'shp-relay', kind: 'relay', relayBusinessId: 'biz-relay', deliveryMin: 40,
  customerPriceCents: 1000, platformContributionCents: 300,
  legs: [
    { tripId: 'eve', employeeId: 'emp-a', placeIds: [], stops: [
      { placeId: 'biz-a', kind: 'pickup', arrivalMin: 8, serviceStartMin: 8, serviceEndMin: 10 },
      { placeId: 'biz-relay', kind: 'hub_drop', arrivalMin: 18, serviceStartMin: 18, serviceEndMin: 20 },
    ], finishMin: 20, extraMin: 4, extraDistanceM: 400, rewardCents: 300 },
    { tripId: 'morn', employeeId: 'emp-b', placeIds: [], stops: [
      { placeId: 'biz-relay', kind: 'hub_pickup', arrivalMin: 28, serviceStartMin: 28, serviceEndMin: 30 },
      { placeId: 'biz-b', kind: 'delivery', arrivalMin: 38, serviceStartMin: 38, serviceEndMin: 40 },
    ], finishMin: 40, extraMin: 5, extraDistanceM: 500, rewardCents: 300 },
  ],
};

const jobs: Job[] = relay.legs.map((leg, legIndex) => ({
  id: `plan-relay-L${legIndex}`, planId: relay.id, shipmentId: relay.shipmentId, employeeId: leg.employeeId,
  legIndex, tripId: leg.tripId, pickup: leg.stops[0]!, dropoff: leg.stops.at(-1)!, rewardCents: leg.rewardCents,
}));
const input = { shipments: [shipment('shp-relay'), shipment('shp-unmatched')], plans: [relay], jobs, events: buildTimeline([relay], jobs) };

describe('v2 progressAt', () => {
  it('derives status, jobs, delivery time and wallets before, between and after events', () => {
    const before = progressAt(input, 9);
    const pickedUp = progressAt(input, 10);
    const atRelay = progressAt(input, 20);
    const outForDelivery = progressAt(input, 30);
    const delivered = progressAt(input, 40);

    expect(before.shipmentStatus).toEqual({ 'shp-relay': 'scheduled', 'shp-unmatched': 'unmatched' });
    expect(before.jobStatus).toEqual({ 'plan-relay-L0': 'assigned', 'plan-relay-L1': 'assigned' });
    expect(before.earningsCents).toEqual({ 'emp-a': 0, 'emp-b': 0 });
    expect(pickedUp.shipmentStatus['shp-relay']).toBe('picked_up');
    expect(pickedUp.jobStatus['plan-relay-L0']).toBe('in_progress');
    expect(atRelay.shipmentStatus['shp-relay']).toBe('at_hub');
    expect(atRelay.jobStatus).toEqual({ 'plan-relay-L0': 'completed', 'plan-relay-L1': 'assigned' });
    expect(atRelay.earningsCents).toEqual({ 'emp-a': 300, 'emp-b': 0 });
    expect(outForDelivery.shipmentStatus['shp-relay']).toBe('out_for_delivery');
    expect(outForDelivery.jobStatus['plan-relay-L1']).toBe('in_progress');
    expect(delivered.shipmentStatus['shp-relay']).toBe('delivered');
    expect(delivered.deliveredAtMin).toEqual({ 'shp-relay': 40 });
    expect(delivered.jobStatus).toEqual({ 'plan-relay-L0': 'completed', 'plan-relay-L1': 'completed' });
    expect(delivered.earningsCents).toEqual({ 'emp-a': 300, 'emp-b': 300 });
    expect(delivered.occurredEvents).toHaveLength(4);
  });
});
