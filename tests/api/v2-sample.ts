// A small hand-built MVP II Run + Snapshots for the v2 view tests. No matcher, generator or timeline:
// every number below is typed by hand, so the tests can state the expected sums.
//
// City: Studio (Williamsburg) and Agency (Midtown) trade packages; Cafe (DUMBO) is the relay point.
//   shp-1  Studio -> Agency  relay via Cafe: emp-1 evening (Studio -> Cafe -> home), emp-2 morning (home -> Cafe -> Agency)
//   shp-2  Agency -> Studio  direct:         emp-2 evening (Agency -> Studio -> home)
//   shp-3  Studio -> Agency  unmatched
// emp-3 has trips but no job. home-003 belongs to nobody.
import {
  jobIdFor, pairKey, planIdFor, tripId,
  type DeliveryPlan, type Employee, type Home, type Job, type Metrics, type NetworkBusiness, type Notification,
  type Run, type Settings, type Shipment, type SimEvent, type Snapshot, type Stop, type TravelProvider, type Trip,
} from '../../shared/v2/types';

/** Freezes the whole tree, so a view that mutates its input throws instead of passing silently. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Paths of every `undefined` inside a value (object properties and array items), e.g. `plan.relayBusinessId`. */
export function undefinedPaths(value: unknown, path = '$'): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== 'object') return [];
  return Array.isArray(value)
    ? value.flatMap((item, i) => undefinedPaths(item, `${path}[${i}]`))
    : Object.entries(value).flatMap(([key, child]) => undefinedPaths(child, `${path}.${key}`));
}

// ---------- Places and people ----------
export const studio: NetworkBusiness = {
  id: 'biz-studio', name: 'Studio', address: '1 Bedford Ave, Brooklyn, NY', neighborhood: 'Williamsburg',
  borough: 'Brooklyn', kind: 'office', lat: 40.7195, lng: -73.9565,
};
export const agency: NetworkBusiness = {
  id: 'biz-agency', name: 'Agency', address: '1 W 42nd St, New York, NY', neighborhood: 'Midtown',
  borough: 'Manhattan', kind: 'office', lat: 40.7536, lng: -73.9822,
};
export const cafe: NetworkBusiness = {
  id: 'biz-cafe', name: 'Cafe', address: '1 Water St, Brooklyn, NY', neighborhood: 'DUMBO',
  borough: 'Brooklyn', kind: 'cafe', lat: 40.7033, lng: -73.9903,
};

export const homeSam: Home = { id: 'home-001', neighborhood: 'Park Slope', lat: 40.6722, lng: -73.9772 };
export const homeAna: Home = { id: 'home-story-ana', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 };
export const homeLee: Home = { id: 'home-002', neighborhood: 'Bushwick', lat: 40.6944, lng: -73.9213 };
export const homeUnused: Home = { id: 'home-003', neighborhood: 'Harlem', lat: 40.8116, lng: -73.9465 };

const commute = { maxExtraMin: 8, availableEvening: true, availableMorning: true };
export const sam: Employee = { id: 'emp-1', name: 'Sam', businessId: 'biz-studio', homeId: 'home-001', eveningDepartureMin: 1050, morningDepartureMin: 1920, ...commute };
export const ana: Employee = { id: 'emp-2', name: 'Ana', businessId: 'biz-agency', homeId: 'home-story-ana', eveningDepartureMin: 1080, morningDepartureMin: 1900, ...commute };
export const lee: Employee = { id: 'emp-3', name: 'Lee', businessId: 'biz-studio', homeId: 'home-002', eveningDepartureMin: 1040, morningDepartureMin: 1890, ...commute };

const trip = (
  employee: Employee, dir: 'eve' | 'morn', baselineDurationMin: number, baselineDistanceM: number,
): Trip => ({
  id: tripId(employee.id, dir), employeeId: employee.id, direction: dir === 'eve' ? 'evening' : 'morning',
  originPlaceId: dir === 'eve' ? employee.businessId : employee.homeId,
  destinationPlaceId: dir === 'eve' ? employee.homeId : employee.businessId,
  departureMin: dir === 'eve' ? employee.eveningDepartureMin : employee.morningDepartureMin,
  baselineDurationMin, baselineDistanceM,
});
export const samEve = trip(sam, 'eve', 30, 8200);
export const samMorn = trip(sam, 'morn', 32, 8400);
export const anaEve = trip(ana, 'eve', 40, 9800);
export const anaMorn = trip(ana, 'morn', 44, 10100);
export const leeEve = trip(lee, 'eve', 16, 4100);
export const leeMorn = trip(lee, 'morn', 18, 4300);

// ---------- Packages ----------
const pkg = { category: 'envelope', weightGrams: 300, pickupInstructions: 'Front desk', dropoffInstructions: 'Reception' } as const;
export const shp1: Shipment = {
  id: 'shp-1', clientRequestId: 'req-1', label: 'Printed proofs', description: 'Proofs for sign-off',
  originBusinessId: 'biz-studio', destinationBusinessId: 'biz-agency', readyMin: 960, deadlineMin: 1980, createdSeq: 1, ...pkg,
};
export const shp2: Shipment = {
  id: 'shp-2', clientRequestId: 'req-2', label: 'Signed contract', description: 'Countersigned copy',
  originBusinessId: 'biz-agency', destinationBusinessId: 'biz-studio', readyMin: 1000, deadlineMin: 1200, createdSeq: 2, ...pkg,
};
export const shp3: Shipment = {
  id: 'shp-3', clientRequestId: 'req-3', label: 'Colour samples', description: 'Swatch book',
  originBusinessId: 'biz-studio', destinationBusinessId: 'biz-agency', readyMin: 1100, deadlineMin: 1140, createdSeq: 3, ...pkg,
};
export const UNMATCHED_REASON = 'No commute can carry this package before its deadline';

// ---------- Plans (handling = 2 min per stop) ----------
const stop = (placeId: string, kind: Stop['kind'], arrivalMin: number): Stop =>
  ({ placeId, kind, arrivalMin, serviceStartMin: arrivalMin, serviceEndMin: arrivalMin + 2 });

// shp-1 leg 0: Sam leaves Studio 1050, picks up, 18 min to Cafe, drops, 14 min home. 18 + 14 + 4 - 30 = 6 extra.
const relayPickup = stop('biz-studio', 'pickup', 1050);
const relayDrop = stop('biz-cafe', 'hub_drop', 1070);
// shp-1 leg 1: Ana leaves home 1900, 28 min to Cafe, picks up, 20 min to Agency, delivers. 28 + 20 + 4 - 44 = 8 extra.
const relayCollect = stop('biz-cafe', 'hub_pickup', 1928);
const relayDeliver = stop('biz-agency', 'delivery', 1950);
// shp-2: Ana leaves Agency 1080, picks up, 24 min to Studio, delivers, 20 min home. 24 + 20 + 4 - 40 = 8 extra.
const directPickup = stop('biz-agency', 'pickup', 1080);
const directDeliver = stop('biz-studio', 'delivery', 1106);

export const relayPlan: DeliveryPlan = {
  id: planIdFor('shp-1'), shipmentId: 'shp-1', kind: 'relay', relayBusinessId: 'biz-cafe', deliveryMin: 1952,
  customerPriceCents: 1050, platformContributionCents: 350, // price 2 x 300 + 50 relay point + 400 platform fee (window under 18 h: no discount); 1050 - 600 - 50 - 50 variable
  legs: [
    { tripId: samEve.id, employeeId: 'emp-1', placeIds: ['biz-studio', 'biz-cafe', 'home-001'], stops: [relayPickup, relayDrop], finishMin: 1086, extraMin: 6, extraDistanceM: 900, rewardCents: 300 },
    { tripId: anaMorn.id, employeeId: 'emp-2', placeIds: ['home-story-ana', 'biz-cafe', 'biz-agency'], stops: [relayCollect, relayDeliver], finishMin: 1952, extraMin: 8, extraDistanceM: 1500, rewardCents: 300 },
  ],
};
export const directPlan: DeliveryPlan = {
  id: planIdFor('shp-2'), shipmentId: 'shp-2', kind: 'direct', deliveryMin: 1108,
  customerPriceCents: 700, platformContributionCents: 350, // price 300 + 400 platform fee (window under 18 h: no discount); 700 - 300 - 50 variable
  legs: [
    { tripId: anaEve.id, employeeId: 'emp-2', placeIds: ['biz-agency', 'biz-studio', 'home-story-ana'], stops: [directPickup, directDeliver], finishMin: 1128, extraMin: 8, extraDistanceM: 2100, rewardCents: 300 },
  ],
};

const job = (plan: DeliveryPlan, legIndex: number): Job => {
  const leg = plan.legs[legIndex];
  return {
    id: jobIdFor(plan.id, legIndex), planId: plan.id, shipmentId: plan.shipmentId, employeeId: leg.employeeId,
    legIndex, tripId: leg.tripId, pickup: leg.stops[0], dropoff: leg.stops[leg.stops.length - 1], rewardCents: leg.rewardCents,
  };
};
export const relayJob0 = job(relayPlan, 0); // plan-shp-1-L0, Sam, evening
export const relayJob1 = job(relayPlan, 1); // plan-shp-1-L1, Ana, morning
export const directJob = job(directPlan, 0); // plan-shp-2-L0, Ana, evening

// ---------- Notifications (createdSeq = order they were written) ----------
const bizNote = (plan: DeliveryPlan, businessId: string, createdSeq: number): Notification => ({
  id: `ntf-${plan.id}-${businessId}`, audience: 'business', audienceId: businessId, kind: 'delivery_matched',
  shipmentId: plan.shipmentId, planId: plan.id, message: 'Delivery arranged', createdSeq,
});
const jobNote = (j: Job, createdSeq: number): Notification => ({
  id: `ntf-${j.id}`, audience: 'employee', audienceId: j.employeeId, kind: 'job_assigned',
  shipmentId: j.shipmentId, planId: j.planId, jobId: j.id, message: 'New delivery job', createdSeq,
});
export const noteStudioSent = bizNote(relayPlan, 'biz-studio', 1);
export const noteAgencyIncoming = bizNote(relayPlan, 'biz-agency', 2);
export const noteSamJob = jobNote(relayJob0, 3);
export const noteAnaRelayJob = jobNote(relayJob1, 4);
export const noteAgencySent = bizNote(directPlan, 'biz-agency', 5);
export const noteStudioIncoming = bizNote(directPlan, 'biz-studio', 6);
export const noteAnaDirectJob = jobNote(directJob, 7);

// ---------- Timeline (an event happens when its stop's handling ends) ----------
const event = (
  j: Job, stopIndex: number, kind: SimEvent['kind'], timeMin: number, seq: number, relayBusinessId?: string,
): SimEvent => ({
  id: `evt-${j.planId}-${stopIndex}`, timeMin, shipmentId: j.shipmentId, planId: j.planId, jobId: j.id,
  kind, employeeId: j.employeeId, seq, ...(relayBusinessId ? { relayBusinessId } : {}),
});
export const events: SimEvent[] = [
  event(relayJob0, 0, 'pickup', 1052, 0),
  event(relayJob0, 1, 'hub_drop', 1072, 1, 'biz-cafe'),
  event(directJob, 0, 'pickup', 1082, 2),
  event(directJob, 1, 'delivered', 1108, 3),
  event(relayJob1, 2, 'hub_pickup', 1930, 4, 'biz-cafe'),
  event(relayJob1, 3, 'delivered', 1952, 5),
];

export const settings: Settings = {
  handlingMin: 2, defaultMaxExtraMin: 8, legRewardCents: 300, hubCostCents: 50, platformFeeCents: 400, flexDiscountCents: 100, flexWindowMin: 1080,
  platformVariableCostCents: 50, courierPriceCents: 1400, simStartMin: 930, simEndMin: 2160, allowRelay: true,
};

/** Clock at 1110 (Day 1 18:30): the direct package is delivered, the relay package waits at the Cafe overnight. */
export const sampleRun: Run = deepFreeze({
  runId: 'run-3', version: 12,
  scenario: {
    schemaVersion: 2, name: 'View test city', preset: 'custom', seed: 7,
    businesses: [studio, agency, cafe],
    homes: [homeSam, homeAna, homeLee, homeUnused],
    employees: [sam, ana, lee],
    shipments: [shp1, shp2, shp3],
    settings,
  },
  trips: [samEve, samMorn, anaEve, anaMorn, leeEve, leeMorn],
  assignments: {
    plans: [relayPlan, directPlan],
    unmatched: [{ shipmentId: 'shp-3', reason: UNMATCHED_REASON }],
    computeMs: 3,
  },
  jobs: [relayJob0, relayJob1, directJob],
  notifications: [
    noteStudioSent, noteAgencyIncoming, noteSamJob, noteAnaRelayJob, noteAgencySent, noteStudioIncoming, noteAnaDirectJob,
  ],
  events,
  clock: { phase: 'locked', playing: false, timeMin: 1110, speed: 120 },
});

// ---------- Snapshots (what snapshotAt would return; typed by hand) ----------
const metrics = (delivered: number, earnedRewardsCents: number, earnedPlatformContributionCents: number): Metrics => ({
  requested: 3, matched: 2, delivered, direct: 1, relay: 1, unmatched: 1,
  avgExtraMinPerTrip: (6 + 8 + 8) / 3, maxExtraMin: 8,
  earnedRewardsCents,
  projectedCustomerSavingsCents: 1050,        // (1400 - 1050) + (1400 - 700)
  projectedCustomerSpendCents: 3150,          // 1050 + 700 + 1 unmatched x 1400
  projectedPlatformContributionCents: 700,    // 350 + 350
  earnedPlatformContributionCents,
  extraDistanceM: 4500,                       // 900 + 1500 + 2100
});

/** t = 930, before anything happens. Its status records are left EMPTY on purpose: the views must fall back. */
export const snapshotStart: Snapshot = deepFreeze({
  runId: 'run-3', version: 12, timeMin: 930,
  shipmentStatus: {}, deliveredAtMin: {}, jobStatus: {}, earningsCents: {},
  markers: [], packagePositions: {}, occurredEvents: [],
  metrics: metrics(0, 0, 0),
});

/** t = 1110: shp-2 delivered at 1108, shp-1 at the relay point, Ana still driving home (until 1128). */
export const snapshotEvening: Snapshot = deepFreeze({
  runId: 'run-3', version: 12, timeMin: 1110,
  shipmentStatus: { 'shp-1': 'at_hub', 'shp-2': 'delivered', 'shp-3': 'unmatched' },
  deliveredAtMin: { 'shp-2': 1108 },
  jobStatus: { 'plan-shp-1-L0': 'completed', 'plan-shp-1-L1': 'assigned', 'plan-shp-2-L0': 'completed' },
  earningsCents: { 'emp-1': 300, 'emp-2': 300 }, // emp-3 has no entry
  markers: [{ employeeId: 'emp-2', lat: 40.7242, lng: -73.9531, servicing: false }],
  packagePositions: { 'shp-1': { lat: cafe.lat, lng: cafe.lng }, 'shp-2': { lat: studio.lat, lng: studio.lng } },
  occurredEvents: events.slice(0, 4),
  metrics: metrics(1, 600, 350),
});

/** t = 2160, end of the run: both matched packages delivered. */
export const snapshotEnd: Snapshot = deepFreeze({
  runId: 'run-3', version: 12, timeMin: 2160,
  shipmentStatus: { 'shp-1': 'delivered', 'shp-2': 'delivered', 'shp-3': 'unmatched' },
  deliveredAtMin: { 'shp-1': 1952, 'shp-2': 1108 },
  jobStatus: { 'plan-shp-1-L0': 'completed', 'plan-shp-1-L1': 'completed', 'plan-shp-2-L0': 'completed' },
  earningsCents: { 'emp-1': 300, 'emp-2': 600 },
  markers: [],
  packagePositions: { 'shp-1': { lat: agency.lat, lng: agency.lng }, 'shp-2': { lat: studio.lat, lng: studio.lng } },
  occurredEvents: events,
  metrics: metrics(2, 900, 700),
});

// ---------- Travel ----------
// The 12 ordered pairs the sample needs: 6 baseline commutes and 6 leg pairs. Two are NOT cached.
export const cachedPolylines: Record<string, string> = {
  // baseline commutes
  [pairKey('biz-studio', 'home-001')]: 'ywpwFh`rbMfBpA~FnD',
  [pairKey('home-001', 'biz-studio')]: 'cdgwFjqvbMgBqA_GoD',
  [pairKey('biz-agency', 'home-story-ana')]: 'wmwwFtqwbMmAwGcBoJ',
  [pairKey('home-story-ana', 'biz-agency')]: 'gpywFtalbMlAvGbBnJ',
  [pairKey('biz-studio', 'home-002')]: 'ywpwFh`rbMxCsE`AoD',
  // (home-002 -> biz-studio is not cached)
  // plan legs
  [pairKey('biz-studio', 'biz-cafe')]: 'ywpwFh`rbMlBfH`@~C',
  [pairKey('biz-cafe', 'home-001')]: 'ctmwFlsxbMxEaAnFwB',
  [pairKey('home-story-ana', 'biz-cafe')]: 'gpywFtalbMpJfLxDrG',
  [pairKey('biz-cafe', 'biz-agency')]: 'ctmwFlsxbMyHcAuGoA',
  [pairKey('biz-agency', 'biz-studio')]: 'wmwwFtqwbMzEqDvCuF',
  // (biz-studio -> home-story-ana is not cached)
};
export const UNCACHED_PAIRS = [pairKey('home-002', 'biz-studio'), pairKey('biz-studio', 'home-story-ana')];

/** Fake travel lookup for mapResponse; `calls` records every pair that was asked for. */
export function sampleTravel(polylines: Record<string, string> = cachedPolylines) {
  const calls: string[] = [];
  const travel: Pick<TravelProvider, 'polyline'> = {
    polyline(from, to) {
      calls.push(pairKey(from, to));
      return polylines[pairKey(from, to)] ?? null;
    },
  };
  return { travel, calls };
}
