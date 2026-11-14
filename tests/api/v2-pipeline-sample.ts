// Hand-built MVP II scenario for the v2 pipeline tests: 2 businesses + 1 relay business,
// 3 employees and a table-driven TravelProvider (no fixtures, no network, no keys).
//
// The places sit on one street, minutes apart:
//
//   home-003   Print Shop   home-002   Corner Cafe   home-001   Agency
//      -5          0            5           10           15        30
//
// So with the default 8 min added-time limit:
//   shp-1 Print Shop → Agency   relay: emp-1 drops at the cafe on the way home (evening),
//                               emp-2 collects it on the way to work (morning). Neither can do it alone (+34, +14).
//   shp-2 Agency → Print Shop   direct: emp-3 passes the Print Shop on the way home.
//   shp-3 Corner Cafe → Print Shop   unmatched: nobody works at the cafe, nobody commutes to the Print Shop in the morning.
// emp-2's evening trip stays free for shipments added later.
import {
  pairKey, TravelDataMissingError,
  type Employee, type Home, type NetworkBusiness, type Scenario, type Shipment, type SimEvent, type TravelProvider,
} from '../../shared/v2/types';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import type { PipelineDeps } from '../../server/api/v2/pipeline';

export const PRINT = 'biz-print-shop';
export const AGENCY = 'biz-agency';
export const CAFE = 'biz-cafe';

const POSITION_MIN: Record<string, number> = {
  'home-003': -5, [PRINT]: 0, 'home-002': 5, [CAFE]: 10, 'home-001': 15, [AGENCY]: 30,
};
const METERS_PER_MIN = 350;

export type TravelTable = Record<string, { durationMin: number; distanceM: number }>;

/** A fresh, complete table of every ordered pair. Tests delete pairs from it. */
export function sampleTable(): TravelTable {
  const table: TravelTable = {};
  for (const [from, x] of Object.entries(POSITION_MIN)) {
    for (const [to, y] of Object.entries(POSITION_MIN)) {
      if (from === to) continue;
      table[pairKey(from, to)] = { durationMin: Math.abs(x - y), distanceM: Math.abs(x - y) * METERS_PER_MIN };
    }
  }
  return table;
}

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

/** Stand-in for `buildTimeline` (#340): one event per job, at the end of its drop-off. */
export const stubEvents: PipelineDeps['buildEvents'] = (_plans, jobs) =>
  jobs.map((job, seq): SimEvent => ({
    id: `evt-${job.id}`, timeMin: job.dropoff.serviceEndMin, shipmentId: job.shipmentId,
    planId: job.planId, jobId: job.id, employeeId: job.employeeId, seq,
    kind: job.dropoff.kind === 'hub_drop' ? 'hub_drop' : 'delivered',
  }));

export const sampleDeps = (table: TravelTable = sampleTable()): PipelineDeps => ({
  travel: tableTravel(table), buildEvents: stubEvents,
});

const business = (id: string, name: string, kind: NetworkBusiness['kind']): NetworkBusiness => ({
  id, name, kind, address: '1 Test St, New York, NY', neighborhood: 'Testville', borough: 'Queens', lat: 40.75, lng: -73.95,
});
const home = (id: string): Home => ({ id, neighborhood: 'Testville', lat: 40.76, lng: -73.94 });
const employee = (id: string, name: string, businessId: string, homeId: string, overrides: Partial<Employee>): Employee => ({
  id, name, businessId, homeId, eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
  availableEvening: true, availableMorning: true, ...overrides,
});

export const sampleShipment = (n: number, label: string, originBusinessId: string, destinationBusinessId: string): Shipment => ({
  id: `shp-${n}`, clientRequestId: `sample-${n}`, label, originBusinessId, destinationBusinessId,
  readyMin: 960, deadlineMin: 1980, category: 'envelope', description: '', weightGrams: 200,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: n,
});

/** A fresh scenario on every call, so a test may mutate its run freely. */
export function sampleScenario(): Scenario {
  return {
    schemaVersion: 2,
    name: 'Pipeline sample',
    preset: 'custom',
    seed: 0,
    businesses: [
      business(PRINT, 'Northside Print Shop', 'shop'),
      business(AGENCY, 'Midtown Agency', 'office'),
      business(CAFE, 'Corner Cafe', 'cafe'),
    ],
    homes: [home('home-001'), home('home-002'), home('home-003')],
    employees: [
      employee('emp-1', 'Ada', PRINT, 'home-001', { availableMorning: false }),
      // Leaves later in the evening than emp-3, so emp-3 would win a tie-break if it were free.
      employee('emp-2', 'Ben', AGENCY, 'home-002', { eveningDepartureMin: 1030 }),
      employee('emp-3', 'Cy', AGENCY, 'home-003', { availableMorning: false }),
    ],
    shipments: [
      sampleShipment(1, 'Poster proofs', PRINT, AGENCY),
      sampleShipment(2, 'Signed contract', AGENCY, PRINT),
      sampleShipment(3, 'Pastry box', CAFE, PRINT),
    ],
    settings: { ...DEFAULT_SETTINGS },
  };
}
