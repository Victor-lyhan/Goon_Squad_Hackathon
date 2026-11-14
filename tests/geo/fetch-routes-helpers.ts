// Shared by tests/geo/fetch-routes-*.test.ts: the real fixtures/nyc/*.json as input and a fake Google client.
// Every coordinate, time, distance and route line here is made up by the test. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile } from '../../shared/v2/types';
import { generateHomePool } from '../../server/domain/v2/generator';
import { emptyTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { runFetchRoutes } from '../../server/geo/fetchRoutes';
import type { FetchRoutesInput } from '../../server/geo/fetchRoutes';
import type { FetchClient } from '../../server/geo/fetchRunner';
import type { GeocodeResult, LatLng, RouteMatrixResult, RoutePolyline } from '../../server/geo/googleClient';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
export const KEY = 'FAKE_key-123+/=';
export const KEY_ENCODED = 'FAKE_key-123%2B%2F%3D';

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'fixtures/nyc', name), 'utf8')) as T;
}

export const businessesFile = readFixture<NycBusinessesFile>('businesses.json');
export const neighborhoodsFile = readFixture<NycNeighborhoodsFile>('neighborhoods.json');
export const storyFile = readFixture<NycDemoStoryFile>('demoStory.json');

export const BUSINESS_IDS = businessesFile.businesses.map((business) => business.id);
/** The 120-home pool plus the story's featured homes: what the fetch caches against every business. */
export const HOMES = [...generateHomePool(neighborhoodsFile.neighborhoods), ...storyFile.featuredEmployees.map((employee) => employee.home)];
export const HOME_IDS = HOMES.map((home) => home.id);

/**
 * Where the fake geocoder puts each business: a tight invented cluster, in file order.
 * Tight on purpose, so a detour past another business costs a commuter a minute or two and the matcher finds plans.
 */
export const BUSINESS_POINTS: Record<string, LatLng> = Object.fromEntries(
  businessesFile.businesses.map((business, index) => [business.id, { lat: 40.74 + index * 0.0002, lng: -73.99 + (index % 3) * 0.0002 }]),
);

const pointKey = (point: LatLng) => `${point.lat},${point.lng}`;
const ID_BY_POINT = new Map<string, string>([
  ...Object.entries(BUSINESS_POINTS).map(([id, point]): [string, string] => [pointKey(point), id]),
  ...HOMES.map((home): [string, string] => [pointKey(home), home.id]),
]);
if (ID_BY_POINT.size !== BUSINESS_IDS.length + HOMES.length) throw new Error('two test places share a point');

/** The place a fake request was about. Throws on a point that is no known place: nothing may be asked about a guess. */
export function idOf(point: LatLng): string {
  const id = ID_BY_POINT.get(pointKey(point));
  if (id === undefined) throw new Error(`the client was asked about an unknown point ${pointKey(point)}`);
  return id;
}

/** What the fake Google answers for a pair: raw seconds that grow with the span, different in each direction. */
export function travel(origin: LatLng, destination: LatLng) {
  const span = Math.abs(origin.lat - destination.lat) + Math.abs(origin.lng - destination.lng);
  const durationS = 61 + Math.round(span * 30_000) + (origin.lat > destination.lat ? 13 : 0);
  return { durationS, distanceM: durationS * 9 + 5 };
}

export interface Calls {
  /** Addresses, in call order. */
  geocode: string[];
  /** One entry per computeRouteMatrix request, as place IDs. */
  matrix: { originIds: string[]; destinationIds: string[] }[];
  /** One "<from>|<to>" per computeRoutePolyline request. */
  polyline: string[];
}

export const totalCalls = (calls: Calls) => calls.geocode.length + calls.matrix.length + calls.polyline.length;

/** Every "<from>|<to>" the matrix requests asked for, duplicates included. */
export function matrixPairsRequested(calls: Calls): string[] {
  return calls.matrix.flatMap((call) => call.originIds.flatMap((from) => call.destinationIds.map((to) => `${from}|${to}`)));
}

/** Every ordered pair the app can need between these businesses and all homes. */
export function neededPairs(businessIds: readonly string[] = BUSINESS_IDS): string[] {
  const pairs: string[] = [];
  for (const from of businessIds) for (const to of businessIds) if (from !== to) pairs.push(`${from}|${to}`);
  for (const home of HOME_IDS) for (const business of businessIds) pairs.push(`${home}|${business}`, `${business}|${home}`);
  return pairs;
}

/** A client that geocodes every business to its test point and answers every pair, unless a test overrides a call. */
export function fakeClient(
  overrides: {
    geocode?: (businessId: string) => GeocodeResult[] | undefined;
    matrix?: (call: Calls['matrix'][number]) => RouteMatrixResult | undefined;
    polyline?: (from: string, to: string) => RoutePolyline | undefined;
  } = {},
) {
  const calls: Calls = { geocode: [], matrix: [], polyline: [] };
  const client: FetchClient = {
    async geocodeAddress(address) {
      calls.geocode.push(address);
      const business = businessesFile.businesses.find((candidate) => candidate.address === address);
      if (!business) throw new Error(`the client was asked to geocode an unknown address`);
      const override = overrides.geocode?.(business.id);
      return override ?? [{ ...BUSINESS_POINTS[business.id], formattedAddress: `${business.name}, New York, NY`, neighborhood: null }];
    },
    async computeRouteMatrix(origins, destinations) {
      const call = { originIds: origins.map(idOf), destinationIds: destinations.map(idOf) };
      calls.matrix.push(call);
      const override = overrides.matrix?.(call);
      if (override) return override;
      const elements = origins.flatMap((origin, originIndex) =>
        destinations.map((destination, destinationIndex) => ({ originIndex, destinationIndex, ...travel(origin, destination) })),
      );
      return { elements, failures: [] };
    },
    async computeRoutePolyline(origin, destination) {
      const from = idOf(origin);
      const to = idOf(destination);
      calls.polyline.push(`${from}|${to}`);
      return overrides.polyline?.(from, to) ?? { encoded: `line(${from}>${to})`, ...travel(origin, destination) };
    },
  };
  return { calls, client };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Every line any run of this test file logged; `leakedLines` is checked at the end of each file. */
const allLogLines: string[] = [];

export function leakedLines(): string[] {
  return allLogLines.filter((line) => line.includes(KEY) || line.includes(KEY_ENCODED));
}

export function loggedLineCount(): number {
  return allLogLines.length;
}

export function input(files: TravelFiles = emptyTravelFiles()): FetchRoutesInput {
  return { files, businessesFile, neighborhoodsFile, storyFile };
}

/** Runs the fetch on `files` (frozen, so a mutation of the input throws) and records the calls, the log and every save. */
export async function run(files: TravelFiles = emptyTravelFiles(), fake = fakeClient()) {
  const lines: string[] = [];
  const saves: TravelFiles[] = [];
  const result = await runFetchRoutes({
    ...input(deepFreeze(structuredClone(files))),
    client: fake.client,
    log: (line) => {
      lines.push(line);
      allLogLines.push(line);
    },
    save: (saved) => void saves.push(structuredClone(saved)),
  });
  return { result, calls: fake.calls, lines, saves };
}

let first: ReturnType<typeof run> | undefined;

/** One complete run on empty files, shared by the tests of a file. */
export function firstRun() {
  first ??= run();
  return first;
}
