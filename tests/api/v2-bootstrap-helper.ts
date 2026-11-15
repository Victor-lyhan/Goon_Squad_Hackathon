// Helper for the v2 bootstrap tests (tests/api/v2-bootstrap-*.test.ts).
// Starts the real app the way server/index.ts does: `createV2Runtime` on a temp folder, then
// `createApp({ v2: runtime.deps })`. The temp folder holds copies of the three committed NYC fixture
// files and, for the "sample" cache, the made-up travel cache of v2-boot-sample.ts written as matrix.json
// and polylines.json. Nothing touches fixtures/nyc/, data/ or .env. No network beyond localhost, no real key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import polyline from '@mapbox/polyline';
import { createApp } from '../../server/index';
import { createV2Runtime, type V2Runtime, type V2RuntimeOptions } from '../../server/api/v2/bootstrap';
import { writeTravelFiles } from '../../server/geo/cache';
import { GEOCODE_URL, ROUTES_URL, ROUTE_MATRIX_URL, type FetchLike } from '../../server/geo/googleClient';
import type { Run as RunV2 } from '../../shared/v2/types';
import { bootSample, FIXTURES_DIR } from './v2-boot-sample';

export const T = 20_000; // every test here builds the default NYC run or talks to a real HTTP server (DECISIONS pass 19)

export const NYC_FILES = ['businesses.json', 'neighborhoods.json', 'demoStory.json'] as const;

/** Not a real key. Tests look for it in every body and log line to prove it never leaks. */
export const FAKE_KEY = 'FAKE-server-key-9f3a';

export type CacheKind = 'sample' | 'empty';

/**
 * A temp folder laid out like the repo: `<root>/fixtures/nyc` and `<root>/data/state-v2.json` (not created).
 * `sample`: the three NYC files and the sample travel cache. `empty`: the three NYC files and no cache.
 */
export function tempRepo(cache: CacheKind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bootstrap-'));
  const fixturesDir = path.join(root, 'fixtures', 'nyc');
  fs.mkdirSync(fixturesDir, { recursive: true });
  for (const name of NYC_FILES) fs.copyFileSync(path.join(FIXTURES_DIR, name), path.join(fixturesDir, name));
  if (cache === 'sample') writeTravelFiles(fixturesDir, bootSample().files);
  return {
    root,
    fixturesDir,
    statePath: path.join(root, 'data', 'state-v2.json'),
    /** Where the MVP 1 state file used to be. Nothing writes it any more; tests assert it stays absent. */
    mvp1StatePath: path.join(root, 'data', 'state.json'),
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export type TempRepo = ReturnType<typeof tempRepo>;

/** A `fetch` that fails the test if anything calls it, and counts the calls. */
export function noNetwork(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      throw new Error('the bootstrap tests must not reach the network');
    },
  };
}

type Waypoint = { waypoint: { location: { latLng: { latitude: number; longitude: number } } } };

/** What the fake Google answers to every address search: a point in Astoria, with no neighborhood component. */
export const GEOCODED = { label: '30-01 Example St, Queens, NY 11102, USA', lat: 40.7642, lng: -73.9235 };

/**
 * A `fetch` that answers Google's Routes endpoints and the Geocoding endpoint with made-up data (TEST DATA
 * ONLY): every pair takes `seconds` and `meters`, a route line is the straight line between the two points,
 * encoded, and every address search finds `GEOCODED`. `urls` holds each request's URL without its query.
 */
export function fakeGoogle(seconds = 900, meters = 6000) {
  const urls: string[] = [];
  const reply = (body: unknown) => ({ status: 200, text: async () => JSON.stringify(body) });
  const fetchImpl: FetchLike = async (fullUrl, init) => {
    const url = fullUrl.split('?')[0];
    urls.push(url);
    if (url === GEOCODE_URL) {
      return reply({
        status: 'OK',
        // The county places the result in Queens (#602: only the five boroughs); there is still no neighborhood component.
        results: [{
          formatted_address: GEOCODED.label,
          geometry: { location: { lat: GEOCODED.lat, lng: GEOCODED.lng } },
          address_components: [{ long_name: 'Queens County', short_name: 'Queens County', types: ['administrative_area_level_2', 'political'] }],
        }],
      });
    }
    const body = JSON.parse(init?.body ?? '{}');
    if (url === ROUTE_MATRIX_URL) {
      return reply((body.origins as Waypoint[]).flatMap((_o, originIndex) =>
        (body.destinations as Waypoint[]).map((_d, destinationIndex) => ({
          originIndex, destinationIndex, duration: `${seconds}s`, distanceMeters: meters, condition: 'ROUTE_EXISTS', status: {},
        }))));
    }
    if (url === ROUTES_URL) {
      const from = (body.origin as Waypoint['waypoint']).location.latLng;
      const to = (body.destination as Waypoint['waypoint']).location.latLng;
      const encodedPolyline = polyline.encode([[from.latitude, from.longitude], [to.latitude, to.longitude]]);
      return reply({ routes: [{ duration: `${seconds}s`, distanceMeters: meters, polyline: { encodedPolyline } }] });
    }
    throw new Error(`the fake Google does not know ${url}`);
  };
  const count = (wanted: string) => urls.filter((url) => url === wanted).length;
  return {
    fetch: fetchImpl,
    urls,
    matrixCalls: () => count(ROUTE_MATRIX_URL),
    lineCalls: () => count(ROUTES_URL),
    geocodeCalls: () => count(GEOCODE_URL),
  };
}

export type Answer = { status: number; headers: Headers; body: Record<string, any> };

export type BootstrapApiOptions = {
  cache: CacheKind;
  key?: string | null;
  fetch?: FetchLike;
  /** Gemini for POST /parse-request (a fake key and a fake `fetch`). Left out: every sentence is parsed offline. */
  gemini?: V2RuntimeOptions['gemini'];
  /** Use an existing temp repo (a "restart" on the same files). It is then not removed by `close`. */
  repo?: TempRepo;
};

export type BootstrapApi = Awaited<ReturnType<typeof startBootstrapApi>>;

/** The whole server on a free port, with /api/v2 from `createV2Runtime`. */
export async function startBootstrapApi(opts: BootstrapApiOptions) {
  const repo = opts.repo ?? tempRepo(opts.cache);
  const runtime: V2Runtime = createV2Runtime({
    fixturesDir: repo.fixturesDir,
    statePath: repo.statePath,
    key: opts.key ?? null,
    fetch: opts.fetch ?? noNetwork().fetch,
    gemini: opts.gemini,
  });

  const app = createApp({ clientDist: path.join(repo.root, 'no-dist'), v2: runtime.deps });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** `url` starts at the server root, e.g. `/api/v2/simulator` or `/api/simulator`. */
  const call = async (method: string, url: string, body?: unknown): Promise<Answer> => {
    const res = await fetch(origin + url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
  };

  return {
    repo,
    runtime,
    /** The v2 store, or null while /api/v2 is not loaded. */
    store: runtime.deps.store,
    call,
    /** Calls under /api/v2: `v2.get('/simulator')`. */
    v2: {
      get: (url: string) => call('GET', `/api/v2${url}`),
      post: (url: string, body?: unknown) => call('POST', `/api/v2${url}`, body),
      put: (url: string, body?: unknown) => call('PUT', `/api/v2${url}`, body),
      patch: (url: string, body?: unknown) => call('PATCH', `/api/v2${url}`, body),
    },
    /** The v2 run in the state file, or null when the file was never written. */
    savedRun: async (): Promise<RunV2 | null> => {
      await runtime.deps.store?.flush();
      return fs.existsSync(repo.statePath) ? (JSON.parse(fs.readFileSync(repo.statePath, 'utf8')).run as RunV2) : null;
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await runtime.shutdown();
      if (!opts.repo) repo.remove();
    },
  };
}

/**
 * Replaces the run by the demo with only the story's 60 employees (`POST /scenario/generate` with the
 * contract's default count), which is the run the server started with before #966, and returns it. For tests
 * of what a business sees when it has no free commute left: the default run's 60 added employees are there
 * to prevent exactly that.
 */
export async function useStoryOnlyRun(api: BootstrapApi): Promise<RunV2> {
  const answer = await api.v2.post('/scenario/generate', { preset: 'demo' });
  if (answer.status !== 200 || !api.store) throw new Error(`The story-only run was not built (HTTP ${answer.status})`);
  return api.store.get();
}
