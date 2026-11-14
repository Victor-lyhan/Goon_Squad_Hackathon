// Harness for the PUT /api/v2/employees/:id/commute tests: the real app and the real v2 router, a real
// store on a temp file, the pipeline sample's hand-built city, a table-driven TravelProvider and a recording
// fake of the travel service. No network, no fixtures/nyc matrix, no key.
//
// The sample street (minutes), with the two places this file adds:
//
//   home-003   Print Shop   home-002   Corner Cafe   home-001   NEW_HOME   Agency
//      -5          0            5           10           15         20        30
//
// NEW_HOME is not in the scenario and not in the travel table. The fake `ensurePairs` plays Google:
// it adds a missing pair to the table when both ends are on the street, so a route that did not wait
// for it would fail with TravelDataMissingError.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { registerCommuteRoutes, type CommutePlaces } from '../../server/api/v2/commuteRoutes';
import type { PlacePair } from '../../server/api/v2/commutePlan';
import { createInitialRun } from '../../server/api/v2/initialRun';
import type { CommuteResponse } from '../../shared/v2/api';
import { pairKey, type LatLng, type Run, type Scenario } from '../../shared/v2/types';
import {
  AGENCY, CAFE, PRINT, sampleScenario, sampleTable, stubEvents, tableTravel, type TravelTable,
} from './v2-pipeline-sample';

export { AGENCY, CAFE, PRINT };

/** A point in Astoria that no home in the sample uses. */
export const NEW_POINT = { lat: 40.7642, lng: -73.9235 };
export const NEW_HOME_ID = 'home-c-40.76420_-73.92350';
/** The text forms of the new point. Only a 200 CommuteResponse may contain them. */
export const NEW_POINT_TEXT = ['40.7642', '73.9235'];

export const METERS_PER_MIN = 350;
// The same positions as in v2-pipeline-sample.ts, plus the new home.
const STREET_MIN: Record<string, number> = {
  'home-003': -5, [PRINT]: 0, 'home-002': 5, [CAFE]: 10, 'home-001': 15, [NEW_HOME_ID]: 20, [AGENCY]: 30,
};

export type PlacesCall =
  | { method: 'addPlaces'; places: Record<string, LatLng>; run: Run }
  | { method: 'ensurePairs' | 'ensurePolylines'; pairs: PlacePair[]; run: Run };

type AsyncMethod = 'ensurePairs' | 'ensurePolylines';

export type FakePlaces = CommutePlaces & {
  /** Every call in order, each with the store's run at that moment (the same object until a mutation commits). */
  calls: PlacesCall[];
  /** The next call of `method` rejects with `error` and adds nothing. */
  failNext(method: AsyncMethod | 'addPlaces', error: unknown): void;
  /** `ensurePairs` resolves without adding the missing pairs (Google gave no route). */
  skipFetch(): void;
  /** The next call of `method` waits. `reached` resolves when the route is inside the call. */
  hold(method: AsyncMethod): { reached: Promise<void>; release(): void };
};

function fakePlaces(table: TravelTable, currentRun: () => Run): FakePlaces {
  const calls: PlacesCall[] = [];
  const failures = new Map<string, unknown>();
  const holds = new Map<string, { enter(): void; wait: Promise<void> }>();
  let fetches = true;

  const before = async (method: AsyncMethod) => {
    const held = holds.get(method);
    if (held) {
      holds.delete(method);
      held.enter();
      await held.wait;
    }
    if (failures.has(method)) {
      const error = failures.get(method);
      failures.delete(method);
      throw error;
    }
  };

  return {
    calls,
    failNext: (method, error) => { failures.set(method, error); },
    skipFetch: () => { fetches = false; },
    hold(method) {
      let enter!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => { enter = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      holds.set(method, { enter, wait });
      return { reached, release };
    },
    addPlaces(places) {
      calls.push({ method: 'addPlaces', places: structuredClone(places), run: currentRun() });
      if (failures.has('addPlaces')) {
        const error = failures.get('addPlaces');
        failures.delete('addPlaces');
        throw error;
      }
    },
    async ensurePairs(pairs) {
      calls.push({ method: 'ensurePairs', pairs: structuredClone(pairs), run: currentRun() });
      await before('ensurePairs');
      if (!fetches) return { fetched: 0 };
      let fetched = 0;
      for (const { from, to } of pairs) {
        const key = pairKey(from, to);
        if (table[key] || !(from in STREET_MIN) || !(to in STREET_MIN)) continue;
        const minutes = Math.abs(STREET_MIN[from] - STREET_MIN[to]);
        table[key] = { durationMin: minutes, distanceM: minutes * METERS_PER_MIN };
        fetched++;
      }
      return { fetched };
    },
    async ensurePolylines(pairs) {
      calls.push({ method: 'ensurePolylines', pairs: structuredClone(pairs), run: currentRun() });
      await before('ensurePolylines');
      return { fetched: 0 };
    },
  };
}

export type CommuteApp = {
  base: string;
  store: Store<Run>;
  places: FakePlaces;
  /** The travel table behind the provider. The fake `ensurePairs` adds to it. */
  table: TravelTable;
  put(employeeId: string, body: unknown): Promise<{ status: number; text: string; body: Record<string, unknown> }>;
  close(): Promise<void>;
};

/**
 * Starts the app on a free port with the commute route registered through `createV2Router`'s `extraRoutes`.
 * The default city (v2-pipeline-sample.ts): shp-1 relay (emp-1 evening, emp-2 morning), shp-2 direct
 * (emp-3 evening), shp-3 Corner Cafe -> Print Shop unmatched.
 */
export async function startCommuteApp(opts: { scenario?: Scenario } = {}): Promise<CommuteApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-commute-route-'));
  const table = sampleTable();
  const travel = tableTravel(table);
  const store = createStore<Run>({
    filePath: path.join(dir, 'v2-state.json'),
    initial: () => createInitialRun(opts.scenario ?? sampleScenario(), { travel, buildEvents: stubEvents }),
  });
  const places = fakePlaces(table, () => store.get());

  const app = createApp({
    clientDist: path.join(dir, 'no-client'),
    v2: {
      travel, store,
      extraRoutes: (router) => registerCommuteRoutes(router, { store, travel, buildEvents: stubEvents, places }),
    },
  });
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base, store, places, table,
    async put(employeeId, body) {
      const res = await fetch(`${base}/api/v2/employees/${employeeId}/commute`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.flush();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A valid body for an employee of the sample; `overrides` replace whole fields. */
export function commuteBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    businessId: PRINT,
    home: { homeId: 'home-001' },
    eveningDepartureMin: 1020,
    morningDepartureMin: 1935,
    availableEvening: true,
    availableMorning: false,
    maxExtraMin: 8,
    ...overrides,
  };
}

export const NEW_HOME_BODY = { ...NEW_POINT, neighborhood: 'Astoria' };

// shared/v2 has no response schema (responses are types), so the tests check the 200 body against this
// strict copy of `CommuteResponse`: a key the contract does not have fails the parse.
export const CommuteResponseSchema = z.strictObject({
  employee: z.strictObject({
    id: z.string(), name: z.string(), businessId: z.string(), homeId: z.string(),
    eveningDepartureMin: z.number().int(), morningDepartureMin: z.number().int(), maxExtraMin: z.number().int(),
    availableEvening: z.boolean(), availableMorning: z.boolean(),
  }),
  home: z.strictObject({ id: z.string(), neighborhood: z.string(), lat: z.number(), lng: z.number() }),
  trips: z.array(z.strictObject({
    id: z.string(), employeeId: z.string(), direction: z.enum(['evening', 'morning']),
    originPlaceId: z.string(), destinationPlaceId: z.string(), departureMin: z.number().int(),
    baselineDurationMin: z.number().int(), baselineDistanceM: z.number(),
  })),
  rematchedShipmentIds: z.array(z.string()),
});
// Compile-time: the schema and the contract type describe the same object, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const schemaMatchesContract: Same<z.infer<typeof CommuteResponseSchema>, CommuteResponse> = true;

/** Console methods to spy on: nothing the route does may print the new home's coordinates. */
export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
