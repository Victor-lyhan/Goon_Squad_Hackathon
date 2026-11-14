import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Job, Run, Shipment } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

const relayShipment: Shipment = {
  id: 'shp-relay', clientRequestId: 'request-relay', label: 'Relay package',
  originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 960, deadlineMin: 1980, category: 'small_box', description: '',
  weightGrams: 500, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
};

const directShipment: Shipment = {
  id: 'shp-direct', clientRequestId: 'request-direct', label: 'Direct package',
  originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 960, deadlineMin: 1200, category: 'envelope', description: '',
  weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 2,
};

const unmatchedShipment: Shipment = {
  id: 'shp-unmatched', clientRequestId: 'request-unmatched', label: 'Unmatched package',
  originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 960, deadlineMin: 1200, category: 'small_box', description: '',
  weightGrams: 500, pickupInstructions: '', dropoffInstructions: '', createdSeq: 3,
};

// The hand-built relay plan is the timeline from relay-spec §9: pickup,
// overnight hub deposit, morning collection, then final delivery.
const relayPlan: DeliveryPlan = {
  id: 'plan-shp-relay', shipmentId: relayShipment.id, kind: 'relay', hubId: 'hub-h',
  deliveryMin: 1961, customerPriceCents: 1000, platformContributionCents: 300,
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

const directPlan: DeliveryPlan = {
  id: 'plan-shp-direct', shipmentId: directShipment.id, kind: 'direct',
  deliveryMin: 1112, customerPriceCents: 1000, platformContributionCents: 650,
  legs: [{
    tripId: 'emp-3-eve', employeeId: 'emp-3', routeNodeIds: ['A', 'B'],
    stops: [
      { kind: 'pickup', nodeId: 'A', arrivalMin: 1100, serviceStartMin: 1100, serviceEndMin: 1102 },
      { kind: 'delivery', nodeId: 'B', arrivalMin: 1110, serviceStartMin: 1110, serviceEndMin: 1112 },
    ],
    finishMin: 1112, extraMin: 4, extraDistanceM: 400, rewardCents: 300,
  }],
};

function jobsFor(plan: DeliveryPlan): Job[] {
  return plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`, planId: plan.id, shipmentId: plan.shipmentId,
    employeeId: leg.employeeId, legIndex, tripId: leg.tripId,
    pickup: leg.stops[0], dropoff: leg.stops[leg.stops.length - 1], rewardCents: leg.rewardCents,
  }));
}

const jobs = [...jobsFor(relayPlan), ...jobsFor(directPlan)];
const run: Run = {
  runId: 'run-1', version: 4,
  scenario: {
    schemaVersion: 1, name: 'Snapshot test', preset: 'fixture', seed: 1,
    graph: { nodes: [], edges: [] }, businesses: [],
    hubs: [{ id: 'hub-h', name: 'Hub H', nodeId: 'H' }],
    employees: [
      { id: 'emp-1', name: 'Evening carrier', businessId: 'biz-a', homeNodeId: 'X', eveningDepartureMin: 1000, morningDepartureMin: 1900, maxExtraMin: 8, availableEvening: true, availableMorning: true, eveningViaNodeIds: [], morningViaNodeIds: [] },
      { id: 'emp-2', name: 'Morning carrier', businessId: 'biz-b', homeNodeId: 'Y', eveningDepartureMin: 1000, morningDepartureMin: 1900, maxExtraMin: 8, availableEvening: true, availableMorning: true, eveningViaNodeIds: [], morningViaNodeIds: [] },
      { id: 'emp-3', name: 'Direct carrier', businessId: 'biz-a', homeNodeId: 'Z', eveningDepartureMin: 1000, morningDepartureMin: 1900, maxExtraMin: 8, availableEvening: true, availableMorning: true, eveningViaNodeIds: [], morningViaNodeIds: [] },
    ],
    shipments: [relayShipment, directShipment, unmatchedShipment], settings: { ...DEFAULT_SETTINGS },
  },
  trips: [],
  assignments: {
    plans: [relayPlan, directPlan],
    unmatched: [{ shipmentId: unmatchedShipment.id, reason: 'No compatible commute' }],
    computeMs: 1,
  },
  jobs,
  notifications: [],
  events: buildTimeline([relayPlan, directPlan], jobs, [{ id: 'hub-h', name: 'Hub H', nodeId: 'H' }]),
  clock: { phase: 'locked', playing: false, timeMin: 930, speed: 30 },
};

describe('snapshotAt', () => {
  it('derives statuses and completed-leg earnings without retaining state after a rewind', () => {
    const atT2 = snapshotAt(run, 1961);
    const atT1 = snapshotAt(run, 1022);
    const atT2Again = snapshotAt(run, 1961);

    expect(atT2Again).toEqual(atT2);
    expect(atT2.shipmentStatus).toEqual({
      'shp-relay': 'delivered', 'shp-direct': 'delivered', 'shp-unmatched': 'unmatched',
    });
    expect(atT2.deliveredAtMin).toEqual({ 'shp-direct': 1112, 'shp-relay': 1961 });
    expect(atT2.jobStatus).toEqual({
      'plan-shp-relay-L0': 'completed', 'plan-shp-relay-L1': 'completed', 'plan-shp-direct-L0': 'completed',
    });
    expect(atT2.earningsCents).toEqual({ 'emp-1': 300, 'emp-2': 300, 'emp-3': 300 });
    expect(atT2.metrics.earnedRewardsCents).toBe(900);

    expect(atT1.shipmentStatus['shp-relay']).toBe('picked_up');
    expect(atT1.jobStatus['plan-shp-relay-L0']).toBe('in_progress');
    expect(atT1.earningsCents).toEqual({ 'emp-1': 0, 'emp-2': 0, 'emp-3': 0 });
    expect(atT1.metrics.earnedRewardsCents).toBe(0);
  });

  it('completes a relay first leg at hub drop while the shipment remains at the hub', () => {
    const snapshot = snapshotAt(run, 1034);

    expect(snapshot.occurredEvents.map((event) => event.kind)).toEqual(['pickup', 'hub_drop']);
    expect(snapshot.shipmentStatus['shp-relay']).toBe('at_hub');
    expect(snapshot.deliveredAtMin['shp-relay']).toBeUndefined();
    expect(snapshot.jobStatus).toMatchObject({
      'plan-shp-relay-L0': 'completed',
      'plan-shp-relay-L1': 'assigned',
      'plan-shp-direct-L0': 'assigned',
    });
    expect(snapshot.earningsCents).toEqual({ 'emp-1': 300, 'emp-2': 0, 'emp-3': 0 });
    expect(snapshot.metrics.earnedRewardsCents).toBe(300);
    expect(snapshot.markers).toEqual([]);
    expect(snapshot.packagePositions).toEqual({});
  });
});
