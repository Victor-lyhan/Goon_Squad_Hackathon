// Hand-built MVP II responses for the network view model tests (not a test file itself).
// 3 businesses, 3 employees (+1 unused home), one direct plan, one relay plan, one unmatched
// shipment and one null polyline (Sam's morning commute).
import polyline from '@mapbox/polyline';
import type { MapResponse, SimulatorResponse, RoutePolyline } from '../../shared/v2/api';
import type { DeliveryPlan, Home, Leg, Metrics, NetworkBusiness, Shipment, Snapshot } from '../../shared/v2/types';

const biz = (id: string, name: string, neighborhood: string, borough: NetworkBusiness['borough'], lat: number, lng: number): NetworkBusiness => ({
  id, name, address: `${lat} Test St`, neighborhood, borough, kind: 'shop', lat, lng,
});

export const BUSINESSES: NetworkBusiness[] = [
  biz('biz-etsy', 'Etsy', 'DUMBO', 'Brooklyn', 40.7033, -73.9881),
  biz('biz-bakery', 'Sunrise Bakery', 'Astoria', 'Queens', 40.7644, -73.9235),
  biz('biz-studio', 'Chelsea Print Studio', 'Chelsea', 'Manhattan', 40.7465, -74.0014),
];

export const HOMES: Home[] = [
  { id: 'home-001', neighborhood: 'Astoria', lat: 40.769, lng: -73.915 },
  { id: 'home-002', neighborhood: 'Park Slope', lat: 40.671, lng: -73.9814 },
  { id: 'home-story-sam', neighborhood: 'Long Island City', lat: 40.7447, lng: -73.9485 },
  { id: 'home-003', neighborhood: 'Harlem', lat: 40.8116, lng: -73.9465 }, // nobody lives here
];

export const EMPLOYEES: MapResponse['employees'] = [
  { id: 'emp-1', name: 'Maya Ortiz', businessId: 'biz-studio', homeId: 'home-001' },
  { id: 'emp-2', name: 'Li Chen', businessId: 'biz-etsy', homeId: 'home-002' },
  { id: 'emp-3', name: 'Sam Rivera', businessId: 'biz-bakery', homeId: 'home-story-sam' },
];

const coords = new Map<string, [number, number]>([
  ...BUSINESSES.map((b) => [b.id, [b.lat, b.lng]] as [string, [number, number]]),
  ...HOMES.map((h) => [h.id, [h.lat, h.lng]] as [string, [number, number]]),
]);

/** A straight encoded line from one place to another, with `steps` intermediate points. */
export function encodeBetween(from: [number, number], to: [number, number], steps = 1): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return polyline.encode(pts);
}

const line = (from: string, to: string): RoutePolyline => ({ from, to, encoded: encodeBetween(coords.get(from)!, coords.get(to)!) });

export const POLYLINES: RoutePolyline[] = [
  // baselines
  line('biz-studio', 'home-001'), line('home-001', 'biz-studio'),
  line('biz-etsy', 'home-002'), line('home-002', 'biz-etsy'),
  line('biz-bakery', 'home-story-sam'),
  { from: 'home-story-sam', to: 'biz-bakery', encoded: null }, // the null polyline
  // plan legs
  line('biz-studio', 'biz-bakery'), line('biz-bakery', 'home-001'),
  line('biz-bakery', 'biz-etsy'), line('biz-etsy', 'home-story-sam'),
  line('biz-etsy', 'biz-studio'), line('biz-studio', 'biz-etsy'),
];

const ship = (id: string, label: string, from: string, to: string, seq: number): Shipment => ({
  id, clientRequestId: `req-${id}`, label, originBusinessId: from, destinationBusinessId: to,
  readyMin: 960, deadlineMin: 2400, category: 'envelope', description: label, weightGrams: 400,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: seq,
});

export const SHIPMENTS: Shipment[] = [
  ship('shp-1', 'Astoria product proofs', 'biz-studio', 'biz-bakery', 1),
  ship('shp-2', 'Ceramic samples', 'biz-bakery', 'biz-studio', 2),
  ship('shp-3', 'Spare keys', 'biz-etsy', 'biz-bakery', 3),
];

const leg = (employeeId: string, dir: 'eve' | 'morn', placeIds: string[], stops: [string, Leg['stops'][number]['kind']][], t: number): Leg => ({
  tripId: `${employeeId}-${dir}`, employeeId, placeIds,
  stops: stops.map(([placeId, kind], i) => ({ placeId, kind, arrivalMin: t + i * 20, serviceStartMin: t + i * 20, serviceEndMin: t + i * 20 + 2 })),
  finishMin: t + 60, extraMin: 9, extraDistanceM: 2100, rewardCents: 450,
});

export const PLANS: DeliveryPlan[] = [
  {
    id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'direct', deliveryMin: 1100,
    legs: [leg('emp-1', 'eve', ['biz-studio', 'biz-bakery', 'home-001'], [['biz-studio', 'pickup'], ['biz-bakery', 'delivery']], 1080)],
    customerPriceCents: 900, platformContributionCents: 200,
  },
  {
    id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'relay', relayBusinessId: 'biz-etsy', deliveryMin: 1980,
    legs: [
      leg('emp-3', 'eve', ['biz-bakery', 'biz-etsy', 'home-story-sam'], [['biz-bakery', 'pickup'], ['biz-etsy', 'hub_drop']], 1050),
      leg('emp-2', 'morn', ['home-002', 'biz-etsy', 'biz-studio', 'biz-etsy'], [['biz-etsy', 'hub_pickup'], ['biz-studio', 'delivery']], 1950),
    ],
    customerPriceCents: 1200, platformContributionCents: 250,
  },
];

const METRICS: Metrics = {
  requested: 3, matched: 2, delivered: 0, direct: 1, relay: 1, unmatched: 1,
  avgExtraMinPerTrip: 9, maxExtraMin: 9, earnedRewardsCents: 0,
  projectedCustomerSavingsCents: 0, projectedCustomerSpendCents: 0,
  projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 0,
};

export const SNAPSHOT: Snapshot = {
  runId: 'run-1', version: 7, timeMin: 1090,
  shipmentStatus: { 'shp-1': 'picked_up', 'shp-2': 'picked_up', 'shp-3': 'unmatched' },
  deliveredAtMin: {},
  jobStatus: { 'plan-shp-1-L0': 'in_progress', 'plan-shp-2-L0': 'in_progress', 'plan-shp-2-L1': 'assigned' },
  earningsCents: {},
  markers: [
    { employeeId: 'emp-1', lat: 40.755, lng: -73.96, carryingShipmentId: 'shp-1', servicing: false },
    { employeeId: 'emp-3', lat: 40.73, lng: -73.95, carryingShipmentId: 'shp-2', servicing: false },
  ],
  packagePositions: {
    'shp-1': { lat: 40.755, lng: -73.96 },
    'shp-2': { lat: 40.73, lng: -73.95 },
    'shp-3': { lat: 40.7033, lng: -73.9881 },
  },
  occurredEvents: [],
  metrics: METRICS,
};

export function makeMap(): MapResponse {
  return {
    runId: 'run-1',
    businesses: BUSINESSES.map((b) => ({ ...b })),
    homes: HOMES.map((h) => ({ ...h })),
    employees: EMPLOYEES.map((e) => ({ ...e })),
    polylines: POLYLINES.map((p) => ({ ...p })),
  };
}

export function makeSim(): SimulatorResponse {
  return {
    runId: 'run-1', version: 7,
    clock: { phase: 'locked', playing: true, timeMin: 1090, speed: 120 },
    snapshot: structuredClone(SNAPSHOT),
    plans: structuredClone(PLANS),
    jobs: [],
    shipments: SHIPMENTS.map((s) => ({ ...s })),
    unmatched: [{ shipmentId: 'shp-3', reason: 'No commute passes both businesses in time.' }],
    computeMs: 4,
    nextEventMin: 1100,
  };
}

/** Deterministic shuffle (tests only). */
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A 60-employee, 18-business sample with 30 plans (every third one a relay) for the timing test. */
export function makeLargeSample(): { map: MapResponse; sim: SimulatorResponse } {
  const businesses: NetworkBusiness[] = Array.from({ length: 18 }, (_, i) =>
    biz(`biz-b${String(i).padStart(2, '0')}`, `Business ${String.fromCharCode(65 + i)}`, 'Midtown', 'Manhattan', 40.70 + i * 0.006, -74.01 + i * 0.004));
  const homes: Home[] = Array.from({ length: 60 }, (_, i) => ({
    id: `home-${String(i + 1).padStart(3, '0')}`, neighborhood: 'Astoria', lat: 40.65 + i * 0.003, lng: -73.99 + (i % 7) * 0.01,
  }));
  const employees: MapResponse['employees'] = homes.map((h, i) => ({
    id: `emp-${i + 1}`, name: `Employee ${i + 1}`, businessId: businesses[i % 18].id, homeId: h.id,
  }));
  const pos = new Map<string, [number, number]>([
    ...businesses.map((b) => [b.id, [b.lat, b.lng]] as [string, [number, number]]),
    ...homes.map((h) => [h.id, [h.lat, h.lng]] as [string, [number, number]]),
  ]);
  const polylines = new Map<string, RoutePolyline>();
  const add = (from: string, to: string) => {
    const key = `${from}|${to}`;
    if (!polylines.has(key)) polylines.set(key, { from, to, encoded: encodeBetween(pos.get(from)!, pos.get(to)!, 60) });
  };
  for (const e of employees) {
    add(e.businessId, e.homeId);
    add(e.homeId, e.businessId);
  }
  const shipments: Shipment[] = [];
  const plans: DeliveryPlan[] = [];
  const markers: Snapshot['markers'] = [];
  const packagePositions: Snapshot['packagePositions'] = {};
  for (let i = 0; i < 40; i++) {
    const from = businesses[i % 18].id;
    const to = businesses[(i + 5) % 18].id;
    const s = ship(`shp-${i + 1}`, `Package ${i + 1}`, from, to, i + 1);
    shipments.push(s);
    packagePositions[s.id] = { lat: 40.7 + i * 0.001, lng: -73.98 };
    if (i >= 30) continue; // 10 unmatched
    const a = employees[i];
    if (i % 3 === 2) {
      const relay = businesses[(i + 9) % 18].id;
      const b = employees[(i + 30) % 60];
      const p0 = [a.businessId, from, relay, a.homeId].filter((p, k, arr) => k === 0 || arr[k - 1] !== p);
      const p1 = [b.homeId, relay, to, b.businessId].filter((p, k, arr) => k === 0 || arr[k - 1] !== p);
      for (const ps of [p0, p1]) for (let k = 0; k + 1 < ps.length; k++) add(ps[k], ps[k + 1]);
      plans.push({
        id: `plan-${s.id}`, shipmentId: s.id, kind: 'relay', relayBusinessId: relay, deliveryMin: 1980,
        legs: [leg(a.id, 'eve', p0, [[from, 'pickup'], [relay, 'hub_drop']], 1050), leg(b.id, 'morn', p1, [[relay, 'hub_pickup'], [to, 'delivery']], 1950)],
        customerPriceCents: 1200, platformContributionCents: 250,
      });
    } else {
      const p0 = [a.businessId, from, to, a.homeId].filter((p, k, arr) => k === 0 || arr[k - 1] !== p);
      for (let k = 0; k + 1 < p0.length; k++) add(p0[k], p0[k + 1]);
      plans.push({
        id: `plan-${s.id}`, shipmentId: s.id, kind: 'direct', deliveryMin: 1100,
        legs: [leg(a.id, 'eve', p0, [[from, 'pickup'], [to, 'delivery']], 1080)],
        customerPriceCents: 900, platformContributionCents: 200,
      });
    }
    markers.push({ employeeId: a.id, lat: 40.7 + i * 0.001, lng: -73.97, carryingShipmentId: s.id, servicing: false });
  }
  const map: MapResponse = { runId: 'run-big', businesses, homes, employees, polylines: [...polylines.values()] };
  const sim: SimulatorResponse = {
    ...makeSim(),
    runId: 'run-big',
    snapshot: { ...structuredClone(SNAPSHOT), runId: 'run-big', markers, packagePositions, shipmentStatus: {} },
    plans, shipments, unmatched: [],
  };
  return { map, sim };
}
