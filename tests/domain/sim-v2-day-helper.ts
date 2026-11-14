import { createInitialRun } from '../../server/api/v2/initialRun.js';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';
import { encodePolyline } from '../../server/domain/v2/polyline.js';
import { straightLineM } from '../../server/geo/fakeProvider.js';
import {
  pairKey, TravelDataMissingError, type Employee, type Home, type LatLng, type NetworkBusiness,
  type Scenario, type Shipment, type TravelProvider,
} from '../../shared/v2/types.js';

// TEST DATA ONLY. A small hand-built day that reads no fixture file, so a retune of the NYC story cannot
// change it (DECISIONS pass 54, pass 57). Places sit on a made-up kilometre grid near Lower Manhattan; they are not
// geocodes, and the derived travel table must never be imported by app code.
//
//   y=6   dahlia (0,6) ------ elder (6,6) ------ fern (12,6)
//   y=0   alder  (0,0) ------ birch (6,0) ------ cedar (12,0)
//
// Travel is straight-line at 500 m per minute, so 1 km = 2 min. Every planned leg detours about 4 to 6 minutes
// (2 min handling at each of the two stops), under the 8 minute limit; every other route detours far more.
const ORIGIN: LatLng = { lat: 40.7, lng: -73.99 };
const KM_PER_DEG_LAT = 111.2;
const KM_PER_DEG_LNG = 84.3;
const point = (xKm: number, yKm: number): LatLng => ({
  lat: Number((ORIGIN.lat + yKm / KM_PER_DEG_LAT).toFixed(5)),
  lng: Number((ORIGIN.lng + xKm / KM_PER_DEG_LNG).toFixed(5)),
});

const BUSINESS_GRID: [slug: string, name: string, kind: NetworkBusiness['kind'], x: number, y: number][] = [
  ['alder-books', 'Alder Books', 'shop', 0, 0],
  ['birch-print', 'Birch Print', 'office', 6, 0],
  ['cedar-coffee', 'Cedar Coffee', 'cafe', 12, 0],
  ['dahlia-design', 'Dahlia Design', 'office', 0, 6],
  ['elder-labs', 'Elder Labs', 'office', 6, 6],
  ['fern-studio', 'Fern Studio', 'shop', 12, 6],
];

// [business slug, home x, home y, evening departure, morning departure]
const EMPLOYEE_GRID: [string, number, number, number, number][] = [
  ['alder-books', 6, 1, 1050, 1890],    // emp-1: relay carrier alder -> birch (eve), birch -> alder (morn)
  ['alder-books', -4, -3, 1040, 1880],  // emp-2: lives away from every route
  ['birch-print', 6, -4, 1030, 1900],   // emp-3
  ['birch-print', 3, -3, 1060, 1910],   // emp-4
  ['cedar-coffee', 6, -1, 1045, 1895],  // emp-5: relay carrier cedar -> birch (eve), birch -> cedar (morn)
  ['cedar-coffee', 16, -2, 1035, 1885], // emp-6
  ['dahlia-design', 9, 6, 1020, 1900],  // emp-7: direct dahlia -> elder (eve), elder -> dahlia (morn)
  ['dahlia-design', -3, 9, 1055, 1915], // emp-8
  ['elder-labs', 15, 6, 1065, 1880],    // emp-9: direct elder -> fern (eve), fern -> elder (morn)
  ['elder-labs', 6, 10, 1025, 1905],    // emp-10
  ['fern-studio', 12, 10, 1040, 1890],  // emp-11
  ['fern-studio', 15, 9, 1070, 1920],   // emp-12
];

// [sender slug, recipient slug, readyMin, deadlineMin, kind the sweep expects]
const SHIPMENT_GRID: [string, string, number, number, DayPlanKind][] = [
  ['dahlia-design', 'elder-labs', 960, 2040, 'direct'],
  ['fern-studio', 'elder-labs', 960, 2040, 'direct'],
  ['alder-books', 'cedar-coffee', 960, 2040, 'relay'],
  ['cedar-coffee', 'alder-books', 960, 2040, 'relay'],
  ['alder-books', 'fern-studio', 960, 2040, 'unmatched'],
  ['elder-labs', 'dahlia-design', 960, 2040, 'direct'],
  ['elder-labs', 'fern-studio', 960, 2040, 'direct'],
  ['birch-print', 'dahlia-design', 960, 2040, 'unmatched'],
];

export type DayPlanKind = 'direct' | 'relay' | 'unmatched';

/** What each package of the day scenario must become, by shipment ID. The sweep test asserts it. */
export const DAY_EXPECTED_OUTCOMES: Record<string, DayPlanKind> = Object.fromEntries(
  SHIPMENT_GRID.map(([, , , , kind], index) => [`shp-${index + 1}`, kind]),
);

/** Built in code, with deterministic IDs in the formats of shared/v2/types.ts. */
export function buildDayScenario(): Scenario {
  const businesses: NetworkBusiness[] = BUSINESS_GRID.map(([slug, name, kind, x, y]) => ({
    id: `biz-${slug}`, name, address: `${10 + x} Test Street`, neighborhood: 'Test Grid', borough: 'Manhattan',
    kind, ...point(x, y),
  }));
  const homes: Home[] = EMPLOYEE_GRID.map(([, x, y], index) => ({
    id: `home-${String(index + 1).padStart(3, '0')}`, neighborhood: 'Test Grid', ...point(x, y),
  }));
  const employees: Employee[] = EMPLOYEE_GRID.map(([slug, , , evening, morning], index) => ({
    id: `emp-${index + 1}`, name: `Day Tester ${index + 1}`, businessId: `biz-${slug}`, homeId: homes[index].id,
    eveningDepartureMin: evening, morningDepartureMin: morning, maxExtraMin: 8,
    availableEvening: true, availableMorning: true,
  }));
  const shipments: Shipment[] = SHIPMENT_GRID.map(([from, to, readyMin, deadlineMin], index) => ({
    id: `shp-${index + 1}`, clientRequestId: `day-${index + 1}`, label: `Day parcel ${index + 1}`,
    originBusinessId: `biz-${from}`, destinationBusinessId: `biz-${to}`, readyMin, deadlineMin,
    category: index % 2 === 0 ? 'envelope' : 'small_box', description: 'Test parcel for the simulated day.',
    weightGrams: 200 + index * 100, pickupInstructions: 'Reception.', dropoffInstructions: 'Reception.',
    createdSeq: index + 1,
  }));
  return {
    schemaVersion: 2, name: 'Simulated day test grid', preset: 'custom', seed: 42,
    businesses, homes, employees, shipments,
    settings: { ...DEFAULT_SETTINGS, defaultMaxExtraMin: 8 },
  };
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Pairs touching the relay point have no route line, so the sweep exercises the straight-line fallback. */
const NO_LINE_PLACE = 'biz-birch-print';

/** Build once per file (twice only for the independent-build determinism check). */
export function buildDay() {
  const scenario = buildDayScenario();
  const places = Object.fromEntries([...scenario.businesses, ...scenario.homes].map(
    ({ id, lat, lng }) => [id, { lat, lng }],
  ));
  const pairs: Record<string, { minutes: number; meters: number; line: string | null }> = {};
  let pairIndex = 0;
  for (const [from, a] of Object.entries(places)) {
    for (const [to, b] of Object.entries(places)) {
      if (from === to || (from.startsWith('home-') && to.startsWith('home-'))) continue;
      const meters = Math.round(straightLineM(a, b));
      const count = 100 + pairIndex++ % 201;
      // A slight curve makes route interpolation distinguishable from fallback.
      const line = from === NO_LINE_PLACE || to === NO_LINE_PLACE ? null : encodePolyline(
        Array.from({ length: count }, (_, i) => {
          const fraction = i / (count - 1);
          return {
            lat: a.lat + (b.lat - a.lat) * fraction + Math.sin(Math.PI * fraction) * 0.001,
            lng: a.lng + (b.lng - a.lng) * fraction,
          };
        }),
      );
      pairs[pairKey(from, to)] = { meters, minutes: Math.ceil(meters / 500), line };
    }
  }
  const travel = {
    pairs,
    durationMin(from: string, to: string) {
      if (from === to) return 0;
      const pair = this.pairs[pairKey(from, to)];
      if (!pair) throw new TravelDataMissingError(from, to);
      return pair.minutes;
    },
    distanceM(from: string, to: string) {
      if (from === to) return 0;
      const pair = this.pairs[pairKey(from, to)];
      if (!pair) throw new TravelDataMissingError(from, to);
      return pair.meters;
    },
    polyline(from: string, to: string) { return this.pairs[pairKey(from, to)]?.line ?? null; },
  } satisfies TravelProvider & { pairs: typeof pairs };
  const run = createInitialRun(scenario, { travel, buildEvents: buildTimeline });
  const direct = run.assignments.plans.filter(plan => plan.kind === 'direct').length;
  const relay = run.assignments.plans.filter(plan => plan.kind === 'relay').length;
  if (direct < 2 || relay < 2 || run.assignments.unmatched.length < 1) {
    throw new Error(`Day sweep requires at least 2 direct, 2 relay and 1 unmatched package; got ${direct} direct, `
      + `${relay} relay, ${run.assignments.unmatched.length} unmatched.`);
  }
  return { run, travel, places };
}
