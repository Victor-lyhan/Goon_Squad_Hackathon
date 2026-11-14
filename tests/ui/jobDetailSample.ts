import fixture from '../../fixtures/relayFixture.json';
import type { JobResponse, MapResponse } from '../../shared/api';
import type { DeliveryPlan, Leg, Shipment, Stop, StopKind, Trip } from '../../shared/types';

const fx = fixture as any;
const stop = (nodeId: string, kind: StopKind, t: number): Stop =>
  ({ nodeId, kind, arrivalMin: t - 1, serviceStartMin: t, serviceEndMin: t + 2 });
const leg = (i: number, route: string[], a: Stop, b: Stop, extra: number): Leg => ({
  tripId: fx.trips[i].id, employeeId: fx.trips[i].employeeId, routeNodeIds: route, stops: [a, b],
  finishMin: b.serviceEndMin, extraMin: extra, extraDistanceM: 0, rewardCents: 300,
});
const shipment: Shipment = {
  id: fx.shipment.id, clientRequestId: 'c1', label: 'Contracts', originBusinessId: fx.shipment.originBusinessId,
  destinationBusinessId: fx.shipment.destinationBusinessId, readyMin: fx.shipment.readyMin,
  deadlineMin: fx.shipment.deadlineMin, category: 'envelope', description: '', weightGrams: 300,
  pickupInstructions: 'Ask for desk', dropoffInstructions: 'Leave at dock', createdSeq: 1,
};
const relay: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: shipment.id, kind: 'relay', hubId: fx.hubs[0].id, deliveryMin: 1100,
  customerPriceCents: 1000, platformContributionCents: 0,
  legs: [
    leg(0, ['A', 'H'], stop('A', 'pickup', 1020), stop('H', 'hub_drop', 1040), 6),
    leg(1, ['H', 'B'], stop('H', 'hub_pickup', 1060), stop('B', 'delivery', 1090), 4),
  ],
};
const direct: DeliveryPlan = {
  ...relay, id: 'plan-shp-2', kind: 'direct', hubId: undefined,
  legs: [leg(0, ['A', 'B'], stop('A', 'pickup', 1020), stop('B', 'delivery', 1090), 5)],
};
const mkTrip = (i: number): Trip => ({
  id: fx.trips[i].id, employeeId: fx.trips[i].employeeId, direction: fx.trips[i].direction,
  originNodeId: fx.trips[i].originNodeId, destinationNodeId: fx.trips[i].destinationNodeId,
  departureMin: fx.trips[i].departureMin, baselineNodeIds: i === 0 ? ['A', 'X'] : ['Y', 'B'],
  baselineDurationMin: 10, baselineDistanceM: 1000,
});
const mk = (plan: DeliveryPlan, i: number): JobResponse => ({
  job: {
    id: `${plan.id}-L${i}`, planId: plan.id, shipmentId: shipment.id, employeeId: plan.legs[i].employeeId,
    legIndex: i, tripId: plan.legs[i].tripId, pickup: plan.legs[i].stops[0], dropoff: plan.legs[i].stops[1], rewardCents: 300,
  },
  status: 'assigned', shipment, plan, trip: mkTrip(i),
});

export const sampleJob = {
  businesses: fx.businesses, hubs: fx.hubs,
  map: { runId: 'r', graph: fx.graph, businesses: fx.businesses, hubs: fx.hubs, homes: [] } as MapResponse,
  at: (i: number) => mk(relay, i),
  direct: () => mk(direct, 0),
};
