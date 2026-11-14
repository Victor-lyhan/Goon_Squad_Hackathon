// Helper for the map route-line tests (tests/api/v2-map-lines-*.test.ts, issue #536): a made-up run with more
// missing route lines than one map request may ask for, a travel lookup over a table the test can write to,
// and a recording fake of `ensureLegPolylines`. No network, no fixtures/nyc, no key.
import { pairKey, tripId, type DeliveryPlan, type Employee, type Home, type Run, type TravelProvider, type Trip } from '../../shared/v2/types';
import type { EnsureLegPolylines } from '../../server/api/v2/mapLines';
import { sampleRun } from './v2-sample';

export type Pair = [from: string, to: string];
export const keyOf = ([from, to]: Pair) => pairKey(from, to);

const WORK = 'biz-studio';
const id3 = (i: number) => String(i).padStart(3, '0');

/**
 * `carriers` employees who each carry one direct package on the evening commute (Studio -> their own stop
 * `biz-x<i>` -> home), then `idle` employees with commutes and no plan. All work at the Studio.
 * Only the fields GET /map reads are made up; the rest is the sample run's.
 */
export function bigRun(carriers: number, idle: number) {
  const employees: Employee[] = [];
  const homes: Home[] = [];
  const trips: Trip[] = [];
  const plans: DeliveryPlan[] = [];
  /** In fetch order: the leg pairs of every plan, then the commute pairs of every carrier. */
  const legPairs: Pair[] = [];
  const carrierCommutes: Pair[] = [];
  const idleCommutes: Pair[] = [];

  for (let i = 1; i <= carriers + idle; i++) {
    const employee: Employee = {
      ...sampleRun.scenario.employees[0], id: `emp-${i}`, name: `Employee ${i}`, businessId: WORK, homeId: `home-${id3(i)}`,
    };
    employees.push(employee);
    homes.push({ id: employee.homeId, neighborhood: 'Astoria', lat: 40.76 + i / 10_000, lng: -73.92 });
    const eve: Trip = {
      id: tripId(employee.id, 'eve'), employeeId: employee.id, direction: 'evening',
      originPlaceId: WORK, destinationPlaceId: employee.homeId, departureMin: 1050, baselineDurationMin: 30, baselineDistanceM: 8000,
    };
    const morn: Trip = {
      ...eve, id: tripId(employee.id, 'morn'), direction: 'morning', originPlaceId: employee.homeId, destinationPlaceId: WORK, departureMin: 1920,
    };
    trips.push(eve, morn);
    const commutes: Pair[] = [[WORK, employee.homeId], [employee.homeId, WORK]];
    if (i > carriers) {
      idleCommutes.push(...commutes);
      continue;
    }
    carrierCommutes.push(...commutes);
    const stop = `biz-x${id3(i)}`;
    legPairs.push([WORK, stop], [stop, employee.homeId]);
    plans.push({
      ...sampleRun.assignments.plans[1], id: `plan-shp-${i}`, shipmentId: `shp-${i}`,
      legs: [{ ...sampleRun.assignments.plans[1].legs[0], tripId: eve.id, employeeId: employee.id, placeIds: [WORK, stop, employee.homeId] }],
    });
  }

  const run: Run = {
    ...sampleRun,
    runId: 'run-big',
    scenario: { ...sampleRun.scenario, employees, homes },
    trips,
    assignments: { ...sampleRun.assignments, plans, unmatched: [] },
  };
  return { run, legPairs, carrierCommutes, idleCommutes, wanted: [...legPairs, ...carrierCommutes] };
}

/** A travel provider for GET /map only: `polyline` reads `lines` on every call, so a line added later is seen. */
export function lineTravel(lines: Record<string, string> = {}) {
  const travel: TravelProvider = {
    durationMin: () => { throw new Error('GET /map asks for no travel time'); },
    distanceM: () => { throw new Error('GET /map asks for no distance'); },
    polyline: (from, to) => lines[pairKey(from, to)] ?? null,
  };
  return { travel, lines };
}

/** What the fake line of a pair looks like once the fake has "fetched" it. */
export const fakeLine = (pair: Pair) => `line:${keyOf(pair)}`;

/**
 * How the fake `ensureLegPolylines` behaves:
 * - `fetch`: writes a line for every pair into `lines`, then resolves;
 * - `fail`: resolves and writes nothing (what the real one does when Google cannot route a pair);
 * - `reject`: rejects with an error whose message holds `SECRET`;
 * - `throw`: throws that error before it returns a promise;
 * - `hang`: stays pending until the test calls `release()`, then resolves and writes nothing.
 */
export type LinesMode = 'fetch' | 'fail' | 'reject' | 'throw' | 'hang';

export const SECRET = 'FAKE-server-key-536';

export function fakeEnsure(lines: Record<string, string>, initial: LinesMode = 'fetch') {
  /** One entry per call: the pairs it was given, in order. */
  const calls: Pair[][] = [];
  const shapes: number[][] = [];
  let mode = initial;
  let pending: (() => void)[] = [];
  const ensureLegPolylines: EnsureLegPolylines = (legs) => {
    shapes.push(legs.map((leg) => leg.placeIds.length));
    const pairs = legs.map((leg): Pair => [leg.placeIds[0], leg.placeIds[1]]);
    calls.push(pairs);
    if (mode === 'throw') throw new Error(`upstream said no (key=${SECRET})`);
    if (mode === 'reject') return Promise.reject(new Error(`upstream said no (key=${SECRET})`));
    if (mode === 'hang') return new Promise<void>((resolve) => { pending.push(resolve); });
    if (mode === 'fetch') for (const pair of pairs) lines[keyOf(pair)] = fakeLine(pair);
    return Promise.resolve({ fetched: mode === 'fetch' ? pairs.length : 0, failed: mode === 'fetch' ? 0 : pairs.length });
  };
  return {
    ensureLegPolylines,
    calls,
    /** The number of places of every leg of every call: all 2 when the pairs come as two-place legs. */
    shapes,
    setMode: (next: LinesMode) => { mode = next; },
    /** Settles every hanging call and lets the route's own bookkeeping run. */
    release: async () => {
      for (const resolve of pending) resolve();
      pending = [];
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
