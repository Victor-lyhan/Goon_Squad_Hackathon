// Hand-built SimulatorResponse + MapResponse for the inspector tests (#381):
// 3 businesses, 3 employees, one direct plan, one relay plan, one unmatched shipment.
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Job, Leg, Shipment, Stop } from '../../shared/v2/types';

const D2 = 1440;

export const BIZ = { sender: 'biz-dumbo-print', recipient: 'biz-harlem-bakery', relay: 'biz-lic-books' } as const;
export const EMP = { maya: 'emp-1', jordan: 'emp-2', avery: 'emp-3' } as const;

const stop = (placeId: string, kind: Stop['kind'], t: number): Stop =>
  ({ placeId, kind, arrivalMin: t - 1, serviceStartMin: t, serviceEndMin: t + 2 });

const shipment = (n: number, label: string, from: string, to: string): Shipment => ({
  id: `shp-${n}`, clientRequestId: `req-${n}`, label,
  originBusinessId: from, destinationBusinessId: to,
  readyMin: 990, deadlineMin: D2 + 600, category: 'envelope', description: '', weightGrams: 300,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: n,
});

export const SHIPMENTS: Shipment[] = [
  shipment(1, 'Menu proofs', BIZ.sender, BIZ.recipient),
  shipment(2, 'Author galleys', BIZ.sender, BIZ.recipient),
  shipment(3, 'Spare keys', BIZ.recipient, BIZ.sender),
];

const directLeg: Leg = {
  tripId: 'emp-1-eve', employeeId: EMP.maya, placeIds: [BIZ.sender, BIZ.recipient, 'home-001'],
  stops: [stop(BIZ.sender, 'pickup', 1050), stop(BIZ.recipient, 'delivery', 1080)],
  finishMin: 1110, extraMin: 6, extraDistanceM: 1200, rewardCents: 450,
};
const relayLeg1: Leg = {
  tripId: 'emp-2-eve', employeeId: EMP.jordan, placeIds: [BIZ.sender, BIZ.relay, 'home-002'],
  stops: [stop(BIZ.sender, 'pickup', 1060), stop(BIZ.relay, 'hub_drop', 1085)],
  finishMin: 1120, extraMin: 4, extraDistanceM: 900, rewardCents: 380,
};
const relayLeg2: Leg = {
  tripId: 'emp-1-morn', employeeId: EMP.maya, placeIds: ['home-001', BIZ.relay, BIZ.recipient],
  stops: [stop(BIZ.relay, 'hub_pickup', D2 + 460), stop(BIZ.recipient, 'delivery', D2 + 490)],
  finishMin: D2 + 495, extraMin: 7, extraDistanceM: 1500, rewardCents: 520,
};

export const PLANS: DeliveryPlan[] = [
  { id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'direct', legs: [directLeg], deliveryMin: 1082,
    customerPriceCents: 900, platformContributionCents: 0 },
  { id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'relay', legs: [relayLeg1, relayLeg2],
    relayBusinessId: BIZ.relay, deliveryMin: D2 + 492, customerPriceCents: 1200, platformContributionCents: 100 },
];

export const JOBS: Job[] = PLANS.flatMap((p) => p.legs.map((l, i) => ({
  id: `${p.id}-L${i}`, planId: p.id, shipmentId: p.shipmentId, employeeId: l.employeeId,
  legIndex: i, tripId: l.tripId, pickup: l.stops[0], dropoff: l.stops[1], rewardCents: l.rewardCents,
})));

export const UNMATCHED_REASON = 'No commuter passes both businesses within their detour limit';

export function makeSim(): SimulatorResponse {
  return {
    runId: 'run-1', version: 7,
    clock: { phase: 'locked', playing: false, timeMin: D2, speed: 120 },
    snapshot: {
      runId: 'run-1', version: 7, timeMin: D2,
      shipmentStatus: { 'shp-1': 'delivered', 'shp-2': 'at_hub', 'shp-3': 'unmatched' },
      deliveredAtMin: { 'shp-1': 1082 },
      jobStatus: { 'plan-shp-1-L0': 'completed', 'plan-shp-2-L0': 'completed', 'plan-shp-2-L1': 'assigned' },
      earningsCents: { [EMP.maya]: 450, [EMP.jordan]: 380 },
      markers: [], packagePositions: { 'shp-2': { lat: 40.74711, lng: -73.94123 } }, occurredEvents: [],
      metrics: {
        requested: 3, matched: 2, delivered: 1, direct: 1, relay: 1, unmatched: 1,
        avgExtraMinPerTrip: 5.7, maxExtraMin: 7, earnedRewardsCents: 830,
        projectedCustomerSavingsCents: 0, projectedCustomerSpendCents: 0,
        projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 3600,
      },
    },
    plans: PLANS, jobs: JOBS, shipments: SHIPMENTS,
    unmatched: [{ shipmentId: 'shp-3', reason: UNMATCHED_REASON }],
    computeMs: 3, nextEventMin: D2 + 460,
  };
}

export function makeMap(): MapResponse {
  return {
    runId: 'run-1',
    businesses: [
      { id: BIZ.sender, name: 'Dumbo Print Studio', address: '55 Water St, Brooklyn, NY', neighborhood: 'DUMBO',
        borough: 'Brooklyn', kind: 'office', lat: 40.70331, lng: -73.98977 },
      { id: BIZ.recipient, name: 'Harlem Bakery', address: '2100 Frederick Douglass Blvd, New York, NY',
        neighborhood: 'Harlem', borough: 'Manhattan', kind: 'cafe', lat: 40.80512, lng: -73.95443 },
      { id: BIZ.relay, name: 'LIC Bookshop', address: '10-11 Jackson Ave, Queens, NY', neighborhood: 'Long Island City',
        borough: 'Queens', kind: 'shop', lat: 40.74711, lng: -73.94123 },
    ],
    homes: [
      { id: 'home-001', neighborhood: 'Astoria', lat: 40.76420, lng: -73.92350 },
      { id: 'home-002', neighborhood: 'Park Slope', lat: 40.67180, lng: -73.97770 },
      { id: 'home-story-harlem-1', neighborhood: 'Harlem', lat: 40.81420, lng: -73.94520 },
    ],
    employees: [
      { id: EMP.maya, name: 'Maya Ortiz', businessId: BIZ.sender, homeId: 'home-001' },
      { id: EMP.jordan, name: 'Jordan Lee', businessId: BIZ.relay, homeId: 'home-002' },
      { id: EMP.avery, name: 'Avery Brooks', businessId: BIZ.sender, homeId: 'home-story-harlem-1' },
    ],
    polylines: [],
  };
}

/** Deterministic permutation (reverse, then rotate by one) of every input array. */
export function shuffled(sim: SimulatorResponse, map: MapResponse): [SimulatorResponse, MapResponse] {
  const mix = <T,>(xs: T[]): T[] => {
    const r = [...xs].reverse();
    return r.length > 1 ? [...r.slice(1), r[0]] : r;
  };
  return [
    { ...sim, plans: mix(sim.plans), jobs: mix(sim.jobs), shipments: mix(sim.shipments), unmatched: mix(sim.unmatched) },
    { ...map, businesses: mix(map.businesses), homes: mix(map.homes), employees: mix(map.employees) },
  ];
}
