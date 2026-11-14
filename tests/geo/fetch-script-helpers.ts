// Shared by tests/geo/fetch-script-*.test.ts: temp folders holding copies of the three real fixtures/nyc files,
// a runner for `runFetchScript`, and a fake Google that describes a believable city.
// TEST DATA ONLY. Every coordinate, time, distance and route line here is made up. No network, no real key, no .env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairKey } from '../../shared/v2/types';
import type { AssignmentResult, LatLng, NycDemoStoryFile, Scenario } from '../../shared/v2/types';
import type { MatchContext } from '../../server/domain/v2/matching';
import { explainShipment, formatExplain } from '../../server/domain/v2/storyExplain';
import type { ExplainRow } from '../../server/domain/v2/storyExplain';
import { straightLineM } from '../../server/geo/cacheReport';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { matchDefaultScenario } from '../../server/geo/fetchRoutes';
import { BUSINESSES_FILE, NEIGHBORHOODS_FILE, STORY_FILE, runFetchScript } from '../../server/geo/fetchScript';
import { createCachedProvider } from '../../server/geo/providers';
import type { FetchClient } from '../../server/geo/fetchRunner';
import type { GeocodeResult, RouteMatrixResult, RoutePolyline } from '../../server/geo/googleClient';
import { BUSINESS_IDS, BUSINESS_POINTS, HOMES, KEY, KEY_ENCODED, fakeClient, repoRoot, storyFile } from './fetch-routes-helpers';
import type { Calls } from './fetch-routes-helpers';

export const FIXTURE_NAMES = [BUSINESSES_FILE, NEIGHBORHOODS_FILE, STORY_FILE];
const REAL_FIXTURES_DIR = path.join(repoRoot, 'fixtures/nyc');

// ---------- temp folders ----------

const tempDirs: string[] = [];

/** A new temp folder with copies of businesses.json, neighborhoods.json and demoStory.json. */
export function tempFixturesDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fetch-script-'));
  tempDirs.push(dir);
  for (const name of FIXTURE_NAMES) fs.copyFileSync(path.join(REAL_FIXTURES_DIR, name), path.join(dir, name));
  return dir;
}

/**
 * A new temp folder with the three fixture files and a copy of the two cache files of `seedDir` (a folder a
 * complete run was made on). One paid-for cache per test file, a fresh copy per test.
 */
export function tempDirWithCacheOf(seedDir: string): string {
  const dir = tempFixturesDir();
  for (const name of [MATRIX_FILE, POLYLINES_FILE]) fs.copyFileSync(path.join(seedDir, name), path.join(dir, name));
  return dir;
}

/** Call in `afterAll`. */
export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Every entry of the folder with its bytes (a sub-folder is listed as such), to compare before and after. */
export function snapshot(dir: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const target = path.join(dir, name);
    entries[name] = fs.statSync(target).isDirectory() ? '<folder>' : fs.readFileSync(target, 'utf8');
  }
  return entries;
}

/** The three fixture files as they are in the repo: what a temp folder holds before any run. */
export function fixturesOnly(): Record<string, string> {
  return Object.fromEntries([...FIXTURE_NAMES].sort().map((name) => [name, fs.readFileSync(path.join(REAL_FIXTURES_DIR, name), 'utf8')]));
}

/** Rewrites the folder's copy of demoStory.json and returns what it now holds. */
export function editStory(dir: string, change: (story: NycDemoStoryFile) => void): NycDemoStoryFile {
  const file = path.join(dir, STORY_FILE);
  const story = JSON.parse(fs.readFileSync(file, 'utf8')) as NycDemoStoryFile;
  change(story);
  fs.writeFileSync(file, `${JSON.stringify(story, null, 2)}\n`);
  return story;
}

// ---------- the explanation of a story row ----------

/** One package of a printed explanation: its line, the option lines under it and the "… more" line, if any. */
export interface ExplainedPackage {
  title: string;
  options: string[];
  more: string | null;
}

/**
 * The explanation a run or a dry run printed, without the indent: the `Why (` line and the packages under it.
 * `header` is null when nothing was explained.
 */
export function explanationOf(lines: readonly string[]): { header: string | null; packages: ExplainedPackage[] } {
  const start = lines.findIndex((line) => line.startsWith('  Why ('));
  if (start === -1) return { header: null, packages: [] };
  const packages: ExplainedPackage[] = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith('  '); i++) {
    const line = lines[i].slice(2);
    if (!line.startsWith('  ')) packages.push({ title: line, options: [], more: null });
    else if (line.startsWith('  … ')) packages[packages.length - 1].more = line.slice(2);
    else packages[packages.length - 1].options.push(line.slice(2));
  }
  return { header: lines[start].slice(2), packages };
}

/** An option line without what the script adds to it from the matcher's result. */
export const withoutOutcome = (option: string) => option.replace(/ — (the plan it got|not free: .*)$/, '');

/**
 * What the matcher and the explainer say on the folder's files, computed here and not by the script: the default
 * scenario's plans, and for one package every option as `formatExplain` prints it with no limit.
 */
export function explainerOn(dir: string): {
  scenario: Scenario;
  assignments: AssignmentResult;
  names: Record<string, string>;
  options: (shipmentId: string) => { rows: ExplainRow[]; lines: string[] };
} {
  const read = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as T;
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('fetch-script-helpers: no matrix.json');
  const matched = matchDefaultScenario(
    { files, businessesFile: read(BUSINESSES_FILE), neighborhoodsFile: read(NEIGHBORHOODS_FILE), storyFile: read(STORY_FILE) },
    files,
  );
  if (!matched.ok) throw new Error(`fetch-script-helpers: the matcher cannot run on this folder (${matched.reason})`);
  const { scenario, trips, assignments } = matched;
  const ctx: MatchContext = { travel: createCachedProvider(files), trips, employees: scenario.employees, businesses: scenario.businesses, settings: scenario.settings };
  const names = Object.fromEntries([...scenario.businesses, ...scenario.employees].map(({ id, name }) => [id, name]));
  return {
    scenario,
    assignments,
    names,
    options: (shipmentId) => {
      const shipment = scenario.shipments.find((candidate) => candidate.id === shipmentId);
      if (!shipment) throw new Error(`fetch-script-helpers: no package ${shipmentId}`);
      const rows = explainShipment(shipment, ctx);
      return { rows, lines: formatExplain(rows, names, rows.length + 1) };
    },
  };
}

// ---------- a believable city for the fake Google ----------

// The fake client of fetch-routes-helpers.ts puts all 18 businesses within a few meters of each other. That is
// fine for the fetch itself, but the cache report (rightly) flags businesses on the same point and the story's
// relay packages match as direct ones. The run that must exit 0 needs data a human would accept, so this layer
// spreads the businesses out: one made-up point per business on a 0.01-degree grid, roughly where its
// neighborhood is. Not geocoded, not Google data.
export const CITY_POINTS: Record<string, LatLng> = {
  'biz-penguin-random-house': { lat: 40.77, lng: -73.98 },
  'biz-mcgraw-hill': { lat: 40.76, lng: -73.98 },
  'biz-bh-photo': { lat: 40.75, lng: -74.0 },
  'biz-starbucks-reserve': { lat: 40.74, lng: -74.0 },
  'biz-century-21': { lat: 40.71, lng: -74.01 },
  'biz-blue-bottle-wall': { lat: 40.71, lng: -74.0 },
  'biz-zabars': { lat: 40.79, lng: -73.98 },
  'biz-levain-uws': { lat: 40.78, lng: -73.98 },
  'biz-etsy': { lat: 40.7, lng: -73.99 },
  'biz-powerhouse-arena': { lat: 40.7, lng: -73.98 },
  'biz-brooklyn-roasting': { lat: 40.7, lng: -73.97 },
  'biz-mast-brothers': { lat: 40.72, lng: -73.96 },
  'biz-community-bookstore': { lat: 40.67, lng: -73.98 },
  'biz-wework-montague': { lat: 40.69, lng: -73.99 },
  'biz-jetblue': { lat: 40.75, lng: -73.94 },
  'biz-sweetleaf': { lat: 40.74, lng: -73.95 },
  'biz-titan-foods': { lat: 40.77, lng: -73.92 },
  'biz-kinship-coffee': { lat: 40.76, lng: -73.92 },
};
for (const id of BUSINESS_IDS) if (!CITY_POINTS[id]) throw new Error(`fetch-script-helpers: add a made-up point for ${id}`);

export const CITY_SPEED_KMH = 40;
/**
 * The story's relay packages go between businesses where a direct drive is meant to be too long for every
 * carrier. A straight line at one speed does not know that, so those three stretches are this many times slower
 * (still a believable 6.7 km/h; the cache report only warns that the two directions differ).
 */
export const SLOW_STRETCH_FACTOR = 6;
const SLOW_STRETCHES = new Set(
  storyFile.shipments.filter((shipment) => shipment.expect === 'relay').map((shipment) => `${shipment.originBusinessId}|${shipment.destinationBusinessId}`),
);

const CITY_PLACES = new Map<string, LatLng>([...HOMES.map((home): [string, LatLng] => [home.id, home]), ...Object.entries(CITY_POINTS)]);

/** What the city's fake Google answers for a pair: the straight line at CITY_SPEED_KMH, raw seconds and meters. */
export function cityTravel(from: string, to: string) {
  const a = CITY_PLACES.get(from);
  const b = CITY_PLACES.get(to);
  if (!a || !b) throw new Error(`fetch-script-helpers: unknown place in ${from} -> ${to}`);
  const distanceM = Math.round(straightLineM(a, b));
  const durationS = Math.round(distanceM / (CITY_SPEED_KMH / 3.6)) * (SLOW_STRETCHES.has(`${from}|${to}`) ? SLOW_STRETCH_FACTOR : 1);
  return { durationS, distanceM };
}

/**
 * A copy of `files` with these homes the way a live commute save leaves them (a place, its pairs with every
 * business in both directions, the two route lines of a commute), with the city's numbers: the straight line at
 * CITY_SPEED_KMH. `withEnteredHomes` of cache-edit-helpers.ts has flat numbers that the cache report (rightly)
 * flags as shorter than the straight line, so a run on them cannot exit 0.
 */
export function withCityEnteredHomes(files: TravelFiles, homes: readonly { id: string; lat: number; lng: number }[]): TravelFiles {
  const out = structuredClone(files);
  for (const home of homes) {
    out.matrix.places[home.id] = { lat: home.lat, lng: home.lng };
    for (const [business, point] of Object.entries(CITY_POINTS)) {
      const distanceM = Math.round(straightLineM(home, point));
      const pair = { durationS: Math.round(distanceM / (CITY_SPEED_KMH / 3.6)), distanceM };
      out.matrix.pairs[pairKey(home.id, business)] = pair;
      out.matrix.pairs[pairKey(business, home.id)] = { ...pair };
    }
    out.polylines.polylines[pairKey(home.id, BUSINESS_IDS[0])] = 'line(entered>work)';
    out.polylines.polylines[pairKey(BUSINESS_IDS[0], home.id)] = 'line(work>entered)';
  }
  return out;
}

const pointKey = (point: LatLng) => `${point.lat},${point.lng}`;
const CLUSTER_ID_BY_POINT = new Map(Object.entries(BUSINESS_POINTS).map(([id, point]): [string, string] => [pointKey(point), id]));
const CITY_ID_BY_POINT = new Map(Object.entries(CITY_POINTS).map(([id, point]): [string, string] => [pointKey(point), id]));

export interface FakeGoogle {
  calls: Calls;
  client: FetchClient;
}

/**
 * The fake client of fetch-routes-helpers.ts (same call log, same refusal of a point it does not know), seen
 * through the city: a geocode answers with the business's city point, and every pair answers with `cityTravel`.
 * An override that returns a value replaces the answer; one that throws fails the request.
 */
export function cityClient(
  overrides: {
    geocode?: (businessId: string) => GeocodeResult[] | undefined;
    matrix?: (call: Calls['matrix'][number]) => RouteMatrixResult | undefined;
    polyline?: (from: string, to: string) => RoutePolyline | undefined;
  } = {},
): FakeGoogle {
  const fake = fakeClient({
    geocode: overrides.geocode,
    matrix: (call) =>
      overrides.matrix?.(call) ?? {
        elements: call.originIds.flatMap((from, originIndex) =>
          call.destinationIds.map((to, destinationIndex) => ({ originIndex, destinationIndex, ...cityTravel(from, to) })),
        ),
        failures: [],
      },
    polyline: (from, to) => overrides.polyline?.(from, to) ?? { encoded: `line(${from}>${to})`, ...cityTravel(from, to) },
  });
  // A business's city point back to the point the inner fake knows it by. Homes are the same in both.
  const inner = (point: LatLng): LatLng => {
    const id = CITY_ID_BY_POINT.get(pointKey(point));
    return id === undefined ? point : BUSINESS_POINTS[id];
  };
  const client: FetchClient = {
    async geocodeAddress(address) {
      const results = await fake.client.geocodeAddress(address);
      return results.map((result) => {
        const id = CLUSTER_ID_BY_POINT.get(pointKey(result));
        return id === undefined ? result : { ...result, ...CITY_POINTS[id] };
      });
    },
    computeRouteMatrix: (origins, destinations) => fake.client.computeRouteMatrix(origins.map(inner), destinations.map(inner)),
    computeRoutePolyline: (origin, destination) => fake.client.computeRoutePolyline(inner(origin), inner(destination)),
  };
  return { calls: fake.calls, client };
}

// ---------- running the script ----------

/** Every line any run of this test file printed; `leakedLines` is checked at the end of each file. */
const allLines: string[] = [];

export function leakedLines(): string[] {
  return allLines.filter((line) => line.includes(KEY) || line.includes(KEY_ENCODED));
}

export function printedLineCount(): number {
  return allLines.length;
}

/**
 * Runs the script on `dir`. By default the key is in the environment, there is no `.env`, and Google is the city.
 * `keys` lists every key `makeClient` was called with: empty means no client was ever built.
 */
export async function script(args: {
  dir: string;
  argv?: string[];
  /** Default: only the fake key. Pass `{}` for "no key anywhere". */
  env?: Record<string, string | undefined>;
  envPath?: string;
  google?: FakeGoogle;
}) {
  const google = args.google ?? cityClient();
  const lines: string[] = [];
  const keys: string[] = [];
  const code = await runFetchScript({
    argv: args.argv ?? [],
    env: args.env ?? { GOOGLE_MAPS_SERVER_KEY: KEY },
    fixturesDir: args.dir,
    envPath: args.envPath ?? path.join(args.dir, 'there-is-no.env'),
    makeClient: (key) => {
      keys.push(key);
      return google.client;
    },
    out: (line) => {
      lines.push(line);
      allLines.push(line);
    },
  });
  return { code, lines, keys, calls: google.calls };
}
