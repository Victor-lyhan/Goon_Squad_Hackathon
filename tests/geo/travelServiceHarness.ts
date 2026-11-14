// Shared by tests/geo/travel-service-*.test.ts: a seeded cache in a temp directory, a fake Google `fetch`
// (no network, no real key, no .env) and a watch that collects every error and every line of output of a
// suite, so the suite can prove the key is in none of them.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { pairKey } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import { emptyTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { FetchInitLike, FetchLike } from '../../server/geo/googleClient';

/**
 * Explicit per-test limit for tests/geo/travel-service-*.test.ts, set at the top of each file with `vi.setConfig`
 * (DECISIONS pass 17 and 19). The slowest of these tests takes about 20 ms locally (temp directories, a fake fetch).
 */
export const TRAVEL_SERVICE_TEST_TIMEOUT_MS = 10_000;

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
export const KEY = 'FAKE_key-123+/=';
export const KEY_FORMS = [KEY, 'FAKE_key-123%2B%2F%3D', encodeURIComponent(KEY)];

/** A commute-editor home that is not in the seeded cache. */
export const NEW_HOME = 'home-c-40.76420_-73.92350';
export const NEW_HOME_POINT: LatLng = { lat: 40.7642, lng: -73.9235 };

/** Every point the fake Google knows. The seeded cache holds all of them except NEW_HOME. */
export const POINTS: Record<string, LatLng> = {
  'biz-a': { lat: 40.7484, lng: -73.9857 },
  'biz-b': { lat: 40.7033, lng: -73.9881 },
  'biz-c': { lat: 40.7447, lng: -73.9485 },
  'home-001': { lat: 40.6712, lng: -73.9772 },
  'home-story-ana': { lat: 40.8116, lng: -73.9465 },
  [NEW_HOME]: NEW_HOME_POINT,
};
export const BUSINESSES = ['biz-a', 'biz-b', 'biz-c'];

/** Deterministic made-up Google answers, different per direction. */
export const secondsFor = (from: string, to: string) => 601 + from.length * 61 + to.charCodeAt(to.length - 1);
export const metersFor = (from: string, to: string) => 4000 + from.charCodeAt(from.length - 1) * 10 + to.length;
export const lineFor = (from: string, to: string) => `line:${from}>${to}`;

/**
 * The cache the tests start from: every place except NEW_HOME, every pair among the businesses and between
 * `home-001` and each business, and three route lines. `home-story-ana` has coordinates but no pairs.
 */
export function seedFiles(): TravelFiles {
  const files = emptyTravelFiles();
  for (const [id, point] of Object.entries(POINTS)) if (id !== NEW_HOME) files.matrix.places[id] = { ...point };
  files.matrix.places['biz-a'].formattedAddress = '350 5th Ave, New York, NY 10118, USA';
  const add = (from: string, to: string) => {
    files.matrix.pairs[pairKey(from, to)] = { durationS: secondsFor(from, to), distanceM: metersFor(from, to) };
  };
  for (const from of BUSINESSES) {
    for (const to of BUSINESSES) if (from !== to) add(from, to);
    add('home-001', from);
    add(from, 'home-001');
  }
  for (const [from, to] of [['home-001', 'biz-a'], ['biz-a', 'home-001'], ['biz-a', 'biz-b']]) {
    files.polylines.polylines[pairKey(from, to)] = lineFor(from, to);
  }
  return files;
}

/** Temp directories, removed after each test. `seeded()` holds the seed cache; `empty()` does not exist yet. */
export function tempDirs() {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const root = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-travel-service-'));
    made.push(dir);
    return dir;
  };
  return {
    empty: () => path.join(root(), 'nyc'),
    seeded: () => {
      const dir = path.join(root(), 'nyc');
      writeTravelFiles(dir, seedFiles());
      return dir;
    },
  };
}

export interface GoogleCall {
  url: string;
  init?: FetchInitLike;
  /** The ordered pairs this request asks for, as "from|to". */
  pairs: string[];
}
export type GoogleReply = { status: number; body: unknown };

const idOf = (waypoint: { location: { latLng: { latitude: number; longitude: number } } }) => {
  const { latitude, longitude } = waypoint.location.latLng;
  return Object.keys(POINTS).find((id) => POINTS[id].lat === latitude && POINTS[id].lng === longitude) ?? '?';
};

export const google500: GoogleReply = { status: 500, body: { error: { code: 500, message: `backend error for key ${KEY}`, status: 'INTERNAL' } } };

/**
 * A `fetch` that answers the two Routes endpoints like Google does, from `secondsFor` / `metersFor` / `lineFor`.
 * `override` may answer a call itself (e.g. `google500`); `null` gives the normal answer.
 * `maxInFlight` is the largest number of requests that were ever open at the same time.
 */
export function fakeGoogle(override: (call: GoogleCall, index: number) => GoogleReply | null = () => null) {
  const calls: GoogleCall[] = [];
  const state = { inFlight: 0, maxInFlight: 0 };
  const fetchImpl: FetchLike = async (url, init) => {
    const body = JSON.parse(init?.body ?? '{}');
    const matrix = url === ROUTE_MATRIX_URL;
    if (!matrix && url !== ROUTES_URL) throw new Error(`the fake Google does not know ${url}`);
    const origins: string[] = matrix ? body.origins.map((o: { waypoint: never }) => idOf(o.waypoint)) : [idOf(body.origin)];
    const destinations: string[] = matrix ? body.destinations.map((d: { waypoint: never }) => idOf(d.waypoint)) : [idOf(body.destination)];
    const call: GoogleCall = { url, init, pairs: origins.flatMap((from) => destinations.map((to) => pairKey(from, to))) };
    calls.push(call);

    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1)); // a real request takes time; overlaps would show here
    state.inFlight -= 1;

    const reply = override(call, calls.length - 1) ?? {
      status: 200,
      body: matrix
        ? origins.flatMap((from, originIndex) =>
            destinations.map((to, destinationIndex) => ({
              originIndex,
              destinationIndex,
              duration: `${secondsFor(from, to)}s`,
              distanceMeters: metersFor(from, to),
              condition: 'ROUTE_EXISTS',
              status: {},
            })),
          )
        : {
            routes: [
              {
                duration: `${secondsFor(origins[0], destinations[0])}s`,
                distanceMeters: metersFor(origins[0], destinations[0]),
                polyline: { encodedPolyline: lineFor(origins[0], destinations[0]) },
              },
            ],
          },
    };
    return { status: reply.status, text: async () => JSON.stringify(reply.body) };
  };
  return {
    fetch: fetchImpl,
    calls,
    matrixCalls: () => calls.filter((call) => call.url === ROUTE_MATRIX_URL),
    lineCalls: () => calls.filter((call) => call.url === ROUTES_URL),
    maxInFlight: () => state.maxInFlight,
  };
}

export const noSleep = async () => {};

/** Everything a caller could print or serialize from a thrown value. */
function viewsOf(thrown: unknown): string[] {
  const views = [String(thrown), inspect(thrown, { depth: 10, showHidden: true })];
  try {
    views.push(JSON.stringify(thrown) ?? '');
  } catch {
    // not serializable: nothing to leak that way
  }
  if (thrown instanceof Error) views.push(thrown.message, thrown.stack ?? '');
  return views;
}

/**
 * Call once at the top of a suite. It records every console call and every write to stdout / stderr while
 * the suite runs, and every error that goes through `thrownBy` / `thrownBySync`. `expectNoLeak()` is the
 * suite's last test: nothing recorded holds the key, and the code under test printed nothing at all.
 */
export function watchSuite() {
  const errors: unknown[] = [];
  const output: string[] = [];

  beforeAll(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 10, showHidden: true }))).join(' '));
      });
    }
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        output.push(String(chunk));
        return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write);
    }
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  return {
    errors,
    output,
    /** The value `run` rejects with. It is recorded for the leak scan. */
    async thrownBy(run: () => Promise<unknown>): Promise<unknown> {
      try {
        await run();
      } catch (err) {
        errors.push(err);
        return err;
      }
      throw new Error('expected the call to reject');
    },
    /** The value `run` throws. It is recorded for the leak scan. */
    thrownBySync(run: () => unknown): unknown {
      try {
        run();
      } catch (err) {
        errors.push(err);
        return err;
      }
      throw new Error('expected the call to throw');
    },
    expectNoLeak(minErrors: number) {
      expect(errors.length).toBeGreaterThanOrEqual(minErrors); // the scan below really had something to look at
      const views = [...errors.flatMap(viewsOf), ...output];
      for (const view of views) for (const form of KEY_FORMS) expect(view).not.toContain(form);
      expect(output).toEqual([]); // the travel service logs nothing
    },
  };
}

/** A latitude or longitude as it could show up in text: 40.8116, -73.9465. */
export const coordinateTexts = (point: LatLng) => [String(point.lat), String(point.lng)];

export function expectNoText(thrown: unknown, texts: string[]) {
  for (const view of viewsOf(thrown)) for (const text of texts) expect(view).not.toContain(text);
}
