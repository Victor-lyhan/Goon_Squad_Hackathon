// Hand-built SimulatorResponse + MapResponse for the journey tests: one direct plan (shp-1), one
// relay plan (shp-2, overnight at Brooklyn Roasting), one unmatched shipment (shp-3).
import polyline from '@mapbox/polyline';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Metrics, Shipment, ShipmentProgress, SimEvent, Stop } from '../../shared/v2/types';

export const COORD: Record<string, [number, number]> = {
  'biz-dumbo': [40.7033, -73.9881],
  'biz-roast': [40.7041, -73.9867],
  'biz-etsy': [40.7008, -73.9893],
  'biz-other': [40.7580, -73.9855], // not in any journey
  'home-story-ana': [40.7644, -73.9235],
  'home-story-ben': [40.6710, -73.9814],
  'home-007': [40.6782, -73.9442],
  'home-099': [40.8448, -73.8648], // not in any journey
};

const biz = (id: string, name: string, neighborhood: string) => ({
  id, name, address: `${name} address`, neighborhood, borough: 'Brooklyn' as const, kind: 'office' as const,
  lat: COORD[id][0], lng: COORD[id][1],
});
const home = (id: string, neighborhood: string) => ({ id, neighborhood, lat: COORD[id][0], lng: COORD[id][1] });

// A small wiggle between two places so a path has more than two points.
const enc = (from: string, to: string) => {
  const [a, b] = [COORD[from], COORD[to]];
  const mid: [number, number] = [(a[0] + b[0]) / 2 + 0.001, (a[1] + b[1]) / 2 - 0.001];
  return polyline.encode([a, mid, b]);
};
const pl = (from: string, to: string, missing = false) => ({ from, to, encoded: missing ? null : enc(from, to) });

export const map: MapResponse = {
  runId: 'run-1',
  businesses: [
    biz('biz-dumbo', 'DUMBO Studio', 'DUMBO'),
    biz('biz-roast', 'Brooklyn Roasting', 'DUMBO'),
    biz('biz-etsy', 'Etsy', 'DUMBO'),
    biz('biz-other', 'Midtown Office', 'Midtown'),
  ],
  homes: [
    home('home-story-ana', 'Astoria'),
    home('home-story-ben', 'Park Slope'),
    home('home-007', 'Crown Heights'),
    home('home-099', 'Fordham'),
  ],
  employees: [
    { id: 'emp-1', name: 'Ana Ruiz', businessId: 'biz-dumbo', homeId: 'home-story-ana' },
    { id: 'emp-2', name: 'Ben Okafor', businessId: 'biz-etsy', homeId: 'home-story-ben' },
    { id: 'emp-3', name: 'Cy Lam', businessId: 'biz-dumbo', homeId: 'home-007' },
    { id: 'emp-9', name: 'Dee Park', businessId: 'biz-other', homeId: 'home-099' },
  ],
  polylines: [
    // direct, emp-1 evening: baseline dumbo → Ana's home; leg dumbo → etsy → home
    pl('biz-dumbo', 'home-story-ana'), pl('biz-dumbo', 'biz-etsy'), pl('biz-etsy', 'home-story-ana'),
    // relay leg 1, emp-3 evening: baseline dumbo → home-007; leg dumbo → roast → home-007
    pl('biz-dumbo', 'home-007'), pl('biz-dumbo', 'biz-roast'), pl('biz-roast', 'home-007'),
    // relay leg 2, emp-2 morning: baseline Ben's home → etsy; leg home → roast → etsy (roast → etsy NOT cached)
    pl('home-story-ben', 'biz-etsy'), pl('home-story-ben', 'biz-roast'), pl('biz-roast', 'biz-etsy', true),
    // unrelated
    pl('home-099', 'biz-other'),
  ],
};

const stop = (placeId: string, kind: Stop['kind'], arrivalMin: number): Stop => ({
  placeId, kind, arrivalMin, serviceStartMin: arrivalMin, serviceEndMin: arrivalMin + 2,
});

const ship = (n: number, label: string, from: string, to: string): Shipment => ({
  id: `shp-${n}`, clientRequestId: `req-${n}`, label, originBusinessId: from, destinationBusinessId: to,
  readyMin: 960, deadlineMin: 2160, category: 'envelope', description: 'Contracts', weightGrams: 300,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: n,
});

export const shipments: Shipment[] = [
  ship(1, 'Signed contracts', 'biz-dumbo', 'biz-etsy'),
  ship(2, 'Coffee samples', 'biz-dumbo', 'biz-etsy'),
  ship(3, 'Archive box', 'biz-other', 'biz-dumbo'),
];

// Direct: Day 1 17:30 pickup at DUMBO Studio, 17:50 delivered at Etsy.
const directPlan: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'direct', deliveryMin: 1072,
  customerPriceCents: 700, platformContributionCents: 350,
  legs: [{
    tripId: 'emp-1-eve', employeeId: 'emp-1', placeIds: ['biz-dumbo', 'biz-etsy', 'home-story-ana'],
    stops: [stop('biz-dumbo', 'pickup', 1050), stop('biz-etsy', 'delivery', 1070)],
    finishMin: 1110, extraMin: 6, extraDistanceM: 1800, rewardCents: 300,
  }],
};

// Relay: Day 1 17:20 pickup, 17:40 drop at Brooklyn Roasting; Day 2 8:30 pickup there, 8:55 delivered.
const relayPlan: DeliveryPlan = {
  id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'relay', relayBusinessId: 'biz-roast', deliveryMin: 1977,
  customerPriceCents: 1050, platformContributionCents: 350,
  legs: [
    {
      tripId: 'emp-3-eve', employeeId: 'emp-3', placeIds: ['biz-dumbo', 'biz-roast', 'home-007'],
      stops: [stop('biz-dumbo', 'pickup', 1040), stop('biz-roast', 'hub_drop', 1060)],
      finishMin: 1100, extraMin: 5, extraDistanceM: 900, rewardCents: 300,
    },
    {
      tripId: 'emp-2-morn', employeeId: 'emp-2', placeIds: ['home-story-ben', 'biz-roast', 'biz-etsy'],
      stops: [stop('biz-roast', 'hub_pickup', 1950), stop('biz-etsy', 'delivery', 1975)],
      finishMin: 1977, extraMin: 4, extraDistanceM: 700, rewardCents: 300,
    },
  ],
};

export const plans = [directPlan, relayPlan];

const KIND = { pickup: 'pickup', hub_drop: 'hub_drop', hub_pickup: 'hub_pickup', delivery: 'delivered' } as const;
const allEvents: SimEvent[] = plans.flatMap((p) =>
  p.legs.flatMap((leg, li) =>
    leg.stops.map((s, si) => ({
      id: `evt-${p.id}-${li * 2 + si}`, timeMin: s.serviceEndMin, shipmentId: p.shipmentId, planId: p.id,
      jobId: `${p.id}-L${li}`, kind: KIND[s.kind], employeeId: leg.employeeId,
      ...(p.relayBusinessId ? { relayBusinessId: p.relayBusinessId } : {}), seq: li * 2 + si,
    })),
  ),
);

const metrics: Metrics = {
  requested: 3, matched: 2, delivered: 0, direct: 1, relay: 1, unmatched: 1,
  avgExtraMinPerTrip: 5, maxExtraMin: 6, earnedRewardsCents: 0, projectedCustomerSavingsCents: 800,
  projectedCustomerSpendCents: 3400, projectedPlatformContributionCents: 950,
  earnedPlatformContributionCents: 0, extraDistanceM: 3400,
};

/** The simulator response at `timeMin`: events up to that minute, the given status for shp-2. */
export function simAt(timeMin: number, status: Partial<Record<string, ShipmentProgress>> = {}): SimulatorResponse {
  return {
    runId: 'run-1', version: 7,
    clock: { phase: 'locked', playing: false, timeMin, speed: 120 },
    snapshot: {
      runId: 'run-1', version: 7, timeMin,
      shipmentStatus: { 'shp-1': 'scheduled', 'shp-2': 'scheduled', 'shp-3': 'unmatched', ...status } as Record<string, ShipmentProgress>,
      deliveredAtMin: {},
      jobStatus: {},
      earningsCents: {},
      markers: [
        { employeeId: 'emp-3', lat: 40.7035, lng: -73.988, servicing: false, carryingShipmentId: 'shp-2' },
        { employeeId: 'emp-2', lat: 40.671, lng: -73.9814, servicing: false },
        { employeeId: 'emp-9', lat: 40.8448, lng: -73.8648, servicing: false },
      ],
      packagePositions: { 'shp-2': { lat: 40.7041, lng: -73.9867 }, 'shp-1': { lat: 40.7033, lng: -73.9881 } },
      occurredEvents: allEvents.filter((e) => e.timeMin <= timeMin),
      metrics,
    },
    plans, jobs: [], shipments,
    unmatched: [{ shipmentId: 'shp-3', reason: 'No commuter passes both businesses within their detour limit.' }],
    computeMs: 4,
    nextEventMin: null,
  };
}

/** Times used across the tests. */
export const T = { beforePickup: 1000, onLeg1: 1050, overnight: 1500, onLeg2: 1960, afterDelivery: 2000 };

export const decoded = (from: string, to: string): [number, number][] =>
  polyline.decode(enc(from, to)).map(([lat, lng]) => [lng, lat] as [number, number]);
