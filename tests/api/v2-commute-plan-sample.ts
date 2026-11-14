// Hand-built MVP II run for the commute-plan tests: 3 businesses, 2 homes, 3 employees and a
// table-driven TravelProvider (no fixtures, no network, no keys).
//
// The places sit on one street, minutes apart:
//
//   home-001   Studio   Cafe   home-002   Agency   NEW_HOME (not in the scenario, not in the table)
//      -5         0      10       15        30        40
//
// emp-1 lives alone in home-001; emp-2 and emp-3 share home-002.
import {
  pairKey, TravelDataMissingError,
  type Employee, type Home, type NetworkBusiness, type Run, type TravelProvider,
} from '../../shared/v2/types';
import { PutCommuteRequest } from '../../shared/v2/schemas';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips } from '../../server/domain/v2/trips';

export const STUDIO = 'biz-studio';
export const CAFE = 'biz-cafe';
export const AGENCY = 'biz-agency';
export const HOME_1 = 'home-001';
export const HOME_2 = 'home-002';

/** A point in Astoria that no home in the sample uses. */
export const NEW_POINT = { lat: 40.7642, lng: -73.9235 };
export const NEW_HOME_ID = 'home-c-40.76420_-73.92350';

/** Street addresses in the sample; no result or error of the commute plan may contain one. */
export const STREET_ADDRESSES = ['1 Bedford Ave', '1 Water St', '1 W 42nd St'];

const POSITION_MIN: Record<string, number> = {
  [HOME_1]: -5, [STUDIO]: 0, [CAFE]: 10, [HOME_2]: 15, [AGENCY]: 30,
};
export const METERS_PER_MIN = 350;

export type TravelTable = Record<string, { durationMin: number; distanceM: number }>;

/** Every ordered pair of the sample's places, plus `extra` places at the given minute positions. */
export function sampleTable(extra: Record<string, number> = {}): TravelTable {
  const positions = { ...POSITION_MIN, ...extra };
  const table: TravelTable = {};
  for (const [from, x] of Object.entries(positions)) {
    for (const [to, y] of Object.entries(positions)) {
      if (from === to) continue;
      table[pairKey(from, to)] = { durationMin: Math.abs(x - y), distanceM: Math.abs(x - y) * METERS_PER_MIN };
    }
  }
  return table;
}

/** The sample table with the new home at minute 40, as after a live fetch. */
export const tableWithNewHome = (): TravelTable => sampleTable({ [NEW_HOME_ID]: 40 });

/** Table lookups only: an unknown pair throws, nothing is estimated. */
export function tableTravel(table: TravelTable = sampleTable()): TravelProvider {
  const get = (from: string, to: string) => {
    if (from === to) return { durationMin: 0, distanceM: 0 };
    const pair = table[pairKey(from, to)];
    if (!pair) throw new TravelDataMissingError(from, to);
    return pair;
  };
  return {
    durationMin: (from, to) => get(from, to).durationMin,
    distanceM: (from, to) => get(from, to).distanceM,
    polyline: () => null,
  };
}

const businesses: NetworkBusiness[] = [
  { id: STUDIO, name: 'Studio', address: '1 Bedford Ave, Brooklyn, NY', neighborhood: 'Williamsburg', borough: 'Brooklyn', kind: 'office', lat: 40.7195, lng: -73.9565 },
  { id: CAFE, name: 'Cafe', address: '1 Water St, Brooklyn, NY', neighborhood: 'DUMBO', borough: 'Brooklyn', kind: 'cafe', lat: 40.7033, lng: -73.9903 },
  { id: AGENCY, name: 'Agency', address: '1 W 42nd St, New York, NY', neighborhood: 'Midtown', borough: 'Manhattan', kind: 'office', lat: 40.7536, lng: -73.9822 },
];

const homes: Home[] = [
  { id: HOME_1, neighborhood: 'Park Slope', lat: 40.6722, lng: -73.9772 },
  { id: HOME_2, neighborhood: 'Harlem', lat: 40.8116, lng: -73.9465 },
];

const employee = (id: string, name: string, businessId: string, homeId: string): Employee => ({
  id, name, businessId, homeId, eveningDepartureMin: 1050, morningDepartureMin: 1920, maxExtraMin: 8,
  availableEvening: true, availableMorning: true,
});

/** A fresh run in the planning phase with no shipments and no plans. Tests may change it freely. */
export function sampleRun(): Run {
  const employees = [
    employee('emp-1', 'Sam', STUDIO, HOME_1),
    employee('emp-2', 'Ana', AGENCY, HOME_2),
    employee('emp-3', 'Lee', CAFE, HOME_2),
  ];
  const travel = tableTravel();
  return structuredClone({
    runId: 'run-1',
    version: 7,
    scenario: {
      schemaVersion: 2 as const, name: 'Commute plan test city', preset: 'custom' as const, seed: 42,
      businesses, homes, employees, shipments: [], settings: DEFAULT_SETTINGS,
    },
    trips: employees.flatMap((e) => buildTrips(e, travel)),
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [],
    notifications: [],
    events: [],
    clock: { phase: 'planning' as const, playing: false, timeMin: 930, speed: 30 as const },
  });
}

/** A request body as the route hands it over: already parsed by `PutCommuteRequest`. */
export function commuteBody(overrides: Record<string, unknown> = {}): PutCommuteRequest {
  return PutCommuteRequest.parse({
    businessId: STUDIO,
    home: { homeId: HOME_1 },
    eveningDepartureMin: 1050,
    morningDepartureMin: 1920,
    availableEvening: true,
    availableMorning: true,
    maxExtraMin: 8,
    ...overrides,
  });
}
