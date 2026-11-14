// Live GoogleProvider (server/geo/googleProvider.ts) against a fake client or a fake fetch: no network, no real key, no .env.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { TravelDataMissingError } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import { emptyTravelFiles, readTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { GoogleApiError, ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { FetchLike, RouteMatrixResult, RoutePolyline } from '../../server/geo/googleClient';
import { TravelPlaceMissingError, TravelRouteError, bindGoogleClient, createGoogleTravel, matrixRequests } from '../../server/geo/googleProvider';
import type { GoogleTravelClient } from '../../server/geo/googleProvider';

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
const KEY = 'FAKE_key-123+/=';
const KEY_ENCODED = 'FAKE_key-123%2B%2F%3D';

const PLACES: Record<string, LatLng> = {
  'biz-a': { lat: 40.7484, lng: -73.9857 },
  'biz-b': { lat: 40.7033, lng: -73.9881 },
  'biz-c': { lat: 40.7447, lng: -73.9485 },
  'home-1': { lat: 40.7644, lng: -73.9235 },
  'home-2': { lat: 40.6712, lng: -73.9772 },
};
const idOf = (point: LatLng) => Object.keys(PLACES).find((id) => PLACES[id].lat === point.lat && PLACES[id].lng === point.lng) ?? '?';

function cacheWith(pairs: TravelFiles['matrix']['pairs'] = {}): TravelFiles {
  const files = emptyTravelFiles();
  for (const [id, point] of Object.entries(PLACES)) files.matrix.places[id] = { ...point };
  files.matrix.places['biz-a'].formattedAddress = '350 5th Ave, New York, NY 10118, USA';
  Object.assign(files.matrix.pairs, pairs);
  return files;
}

/** Deterministic made-up Google answers, different per direction. */
const secondsFor = (from: string, to: string) => 600 + from.length * 61 + to.charCodeAt(to.length - 1);
const metersFor = (from: string, to: string) => 4000 + from.charCodeAt(from.length - 1) * 10 + to.length;

interface FakeClientOptions {
  /** Pairs Google has no route for, as "from|to". */
  noRoute?: string[];
  /** Pairs Google does not answer at all. */
  silent?: string[];
  /** Throw this instead of answering the Nth matrix call (0-based). */
  failMatrixCall?: { index: number; error: Error };
  polylineError?: (from: string, to: string) => Error | null;
}

function fakeClient(options: FakeClientOptions = {}) {
  const matrixCalls: { origins: string[]; destinations: string[] }[] = [];
  const polylineCalls: string[] = [];
  const client: GoogleTravelClient = {
    async computeRouteMatrix(origins, destinations): Promise<RouteMatrixResult> {
      const call = { origins: origins.map(idOf), destinations: destinations.map(idOf) };
      matrixCalls.push(call);
      if (options.failMatrixCall && options.failMatrixCall.index === matrixCalls.length - 1) throw options.failMatrixCall.error;
      const result: RouteMatrixResult = { elements: [], failures: [] };
      call.origins.forEach((from, originIndex) => {
        call.destinations.forEach((to, destinationIndex) => {
          const key = `${from}|${to}`;
          if (options.silent?.includes(key)) return;
          if (options.noRoute?.includes(key)) {
            result.failures.push({ originIndex, destinationIndex, condition: 'ROUTE_NOT_FOUND', message: 'no route between these points' });
          } else {
            result.elements.push({ originIndex, destinationIndex, durationS: secondsFor(from, to), distanceM: metersFor(from, to) });
          }
        });
      });
      return result;
    },
    async computeRoutePolyline(origin, destination): Promise<RoutePolyline> {
      const from = idOf(origin);
      const to = idOf(destination);
      polylineCalls.push(`${from}|${to}`);
      const error = options.polylineError?.(from, to);
      if (error) throw error;
      return { encoded: `line:${from}>${to}`, durationS: secondsFor(from, to), distanceM: metersFor(from, to) };
    },
  };
  const requestedPairs = () => matrixCalls.flatMap((call) => call.origins.flatMap((from) => call.destinations.map((to) => `${from}|${to}`))).sort();
  return { client, matrixCalls, polylineCalls, requestedPairs };
}

function persistSpy() {
  const snapshots: TravelFiles[] = [];
  return { snapshots, persist: (files: TravelFiles) => void snapshots.push(structuredClone(files)) };
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject');
}

/** Fails if the key shows up anywhere a caller could print or serialize the error. */
function expectNoKey(err: unknown) {
  expect(err).toBeInstanceOf(Error);
  const error = err as Error;
  const views = [error.message, JSON.stringify(error), String(error), error.stack ?? '', inspect(error, { depth: 10, showHidden: true })];
  for (const view of views) {
    expect(view).not.toContain(KEY);
    expect(view).not.toContain(KEY_ENCODED);
    expect(view).not.toContain(encodeURIComponent(KEY));
  }
}

const noRouteError = () =>
  new GoogleApiError({ status: 200, googleStatus: 'NO_ROUTE', endpoint: ROUTES_URL, message: 'no route between these points' });

describe('matrixRequests', () => {
  it('covers exactly the given pairs: origins that need the same destinations share one request', () => {
    const pairs = [
      { from: 'home-2', to: 'biz-b' },
      { from: 'home-1', to: 'biz-b' },
      { from: 'home-1', to: 'biz-a' },
      { from: 'home-2', to: 'biz-a' },
      { from: 'biz-a', to: 'biz-b' },
      { from: 'biz-b', to: 'biz-a' },
      { from: 'biz-a', to: 'home-1' },
    ];
    const requests = matrixRequests(pairs);
    expect(requests).toEqual([
      { origins: ['biz-a'], destinations: ['biz-b', 'home-1'] },
      { origins: ['biz-b'], destinations: ['biz-a'] },
      { origins: ['home-1', 'home-2'], destinations: ['biz-a', 'biz-b'] },
    ]);
    const covered = requests.flatMap((r) => r.origins.flatMap((from) => r.destinations.map((to) => `${from}|${to}`))).sort();
    expect(covered).toEqual(pairs.map((p) => `${p.from}|${p.to}`).sort());
    expect(matrixRequests([...pairs].reverse())).toEqual(requests); // the input order does not matter
    expect(matrixRequests([])).toEqual([]);
  });
});

describe('createGoogleTravel.ensurePairs', () => {
  it('requests only the pairs missing from the cache and stores raw seconds and meters', async () => {
    const files = cacheWith({ 'home-1|biz-a': { durationS: 1501, distanceM: 12040 } });
    const { client, matrixCalls, requestedPairs } = fakeClient();
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });

    const result = await travel.ensurePairs([
      { from: 'home-1', to: 'biz-a' }, // cached
      { from: 'home-1', to: 'biz-b' },
      { from: 'biz-a', to: 'home-1' },
      { from: 'biz-b', to: 'home-1' },
      { from: 'home-1', to: 'biz-b' }, // listed twice
      { from: 'home-1', to: 'home-1' }, // same place: needs no data
    ]);

    expect(result).toEqual({ fetched: 3 });
    expect(requestedPairs()).toEqual(['biz-a|home-1', 'biz-b|home-1', 'home-1|biz-b']);
    expect(matrixCalls).toEqual([
      { origins: ['biz-a', 'biz-b'], destinations: ['home-1'] },
      { origins: ['home-1'], destinations: ['biz-b'] },
    ]);
    expect(files.matrix.pairs).toEqual({
      'home-1|biz-a': { durationS: 1501, distanceM: 12040 }, // untouched
      'home-1|biz-b': { durationS: secondsFor('home-1', 'biz-b'), distanceM: metersFor('home-1', 'biz-b') },
      'biz-a|home-1': { durationS: secondsFor('biz-a', 'home-1'), distanceM: metersFor('biz-a', 'home-1') },
      'biz-b|home-1': { durationS: secondsFor('biz-b', 'home-1'), distanceM: metersFor('biz-b', 'home-1') },
    });
    expect(files.polylines.polylines).toEqual({});
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(files);
  });

  it('sends the coordinates from files.matrix.places, without the address', async () => {
    const files = cacheWith();
    const seen: { origins: LatLng[]; destinations: LatLng[] }[] = [];
    const { client } = fakeClient();
    const spying: GoogleTravelClient = {
      ...client,
      computeRouteMatrix: (origins, destinations) => {
        seen.push({ origins, destinations });
        return client.computeRouteMatrix(origins, destinations);
      },
    };
    await createGoogleTravel({ files, client: spying }).ensurePairs([{ from: 'biz-a', to: 'home-2' }]);
    expect(seen).toEqual([{ origins: [{ lat: 40.7484, lng: -73.9857 }], destinations: [{ lat: 40.6712, lng: -73.9772 }] }]);
  });

  it('makes no request and does not persist when everything is cached; persist runs once per call that fetched', async () => {
    const files = cacheWith();
    const { client, matrixCalls } = fakeClient();
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });
    const pairs = [
      { from: 'home-1', to: 'biz-a' },
      { from: 'home-1', to: 'biz-b' },
      { from: 'biz-a', to: 'home-1' },
      { from: 'biz-b', to: 'home-1' },
    ];

    expect(await travel.ensurePairs(pairs)).toEqual({ fetched: 4 });
    expect(matrixCalls).toHaveLength(2);
    expect(snapshots).toHaveLength(1);

    expect(await travel.ensurePairs(pairs)).toEqual({ fetched: 0 });
    expect(await travel.ensurePairs([])).toEqual({ fetched: 0 });
    expect(matrixCalls).toHaveLength(2);
    expect(snapshots).toHaveLength(1);

    expect(await travel.ensurePairs([...pairs, { from: 'home-2', to: 'biz-a' }])).toEqual({ fetched: 1 });
    expect(matrixCalls).toHaveLength(3);
    expect(matrixCalls[2]).toEqual({ origins: ['home-2'], destinations: ['biz-a'] });
    expect(snapshots).toHaveLength(2);
  });

  it('the provider is a CachedProvider over the same files: a fetched pair is readable at once, in rounded-up minutes', async () => {
    const files = cacheWith();
    const { client } = fakeClient();
    const travel = createGoogleTravel({ files, client });

    expect(travel.provider.has('home-1', 'biz-a')).toBe(false);
    expect(() => travel.provider.durationMin('home-1', 'biz-a')).toThrow(TravelDataMissingError);
    await travel.ensurePairs([{ from: 'home-1', to: 'biz-a' }]);
    expect(travel.provider.durationMin('home-1', 'biz-a')).toBe(Math.ceil(secondsFor('home-1', 'biz-a') / 60));
    expect(travel.provider.distanceM('home-1', 'biz-a')).toBe(metersFor('home-1', 'biz-a'));
    expect(travel.provider.place('home-1')).toEqual(PLACES['home-1']);
    expect(() => travel.provider.durationMin('biz-a', 'home-1')).toThrow(TravelDataMissingError); // the other direction was not asked for
  });

  it('a pair Google cannot route rejects and is not added; nothing is estimated', async () => {
    const files = cacheWith();
    const before = structuredClone(files);
    const { client, matrixCalls } = fakeClient({ noRoute: ['home-1|biz-a'] });
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });

    const err = await thrownBy(() => travel.ensurePairs([{ from: 'home-1', to: 'biz-a' }]));
    expect(err).toBeInstanceOf(TravelRouteError);
    expect(err).toBeInstanceOf(GoogleApiError); // so the API's Google error handling covers it
    expect(err).toMatchObject({ name: 'TravelRouteError', googleStatus: 'NO_ROUTE', endpoint: ROUTE_MATRIX_URL });
    expect((err as TravelRouteError).failures).toEqual([{ from: 'home-1', to: 'biz-a', what: 'matrix', reason: 'no route between these points' }]);
    expect((err as Error).message).toContain('no travel time for 1 of 1 requested pair(s): home-1|biz-a (no route between these points)');

    expect(files).toEqual(before);
    expect(snapshots).toHaveLength(0);
    expect(travel.provider.has('home-1', 'biz-a')).toBe(false);
    expect(() => travel.provider.durationMin('home-1', 'biz-a')).toThrow(TravelDataMissingError);

    // Not remembered as a failure: the next call asks Google again.
    await thrownBy(() => travel.ensurePairs([{ from: 'home-1', to: 'biz-a' }]));
    expect(matrixCalls).toHaveLength(2);
  });

  it('keeps and persists the pairs that did get a route, then rejects naming the ones that did not', async () => {
    const files = cacheWith();
    const { client } = fakeClient({ noRoute: ['home-1|biz-b'], silent: ['biz-c|home-1'] });
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });

    const err = await thrownBy(() =>
      travel.ensurePairs([
        { from: 'home-1', to: 'biz-a' },
        { from: 'home-1', to: 'biz-b' },
        { from: 'biz-a', to: 'home-1' },
        { from: 'biz-c', to: 'home-1' },
      ]),
    );
    expect(err).toBeInstanceOf(TravelRouteError);
    expect((err as TravelRouteError).failures).toEqual([
      { from: 'biz-c', to: 'home-1', what: 'matrix', reason: 'Google returned no answer for this pair' },
      { from: 'home-1', to: 'biz-b', what: 'matrix', reason: 'no route between these points' },
    ]);
    expect((err as Error).message).toContain('2 of 4 requested pair(s)');
    expect(Object.keys(files.matrix.pairs).sort()).toEqual(['biz-a|home-1', 'home-1|biz-a']);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(files);
  });

  it('lists at most five failed pairs in the message, and all of them in `failures`', async () => {
    const files = cacheWith();
    const all = Object.keys(PLACES).flatMap((from) => Object.keys(PLACES).filter((to) => to !== from).map((to) => ({ from, to })));
    const { client } = fakeClient({ noRoute: all.map((p) => `${p.from}|${p.to}`) });
    const err = (await thrownBy(() => createGoogleTravel({ files, client }).ensurePairs(all))) as TravelRouteError;
    expect(err.failures).toHaveLength(20);
    expect(err.message).toContain('20 of 20 requested pair(s)');
    expect(err.message).toContain('; and 15 more');
    expect(files.matrix.pairs).toEqual({});
  });

  it('rejects before any request when a place has no coordinates, and leaves the cache as it was', async () => {
    const files = cacheWith();
    const before = structuredClone(files);
    const { client, matrixCalls } = fakeClient();
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });

    const err = await thrownBy(() =>
      travel.ensurePairs([
        { from: 'home-1', to: 'biz-a' },
        { from: 'home-9', to: 'biz-a' },
        { from: 'biz-a', to: 'biz-zzz' },
      ]),
    );
    expect(err).toBeInstanceOf(TravelPlaceMissingError);
    expect((err as TravelPlaceMissingError).placeIds).toEqual(['biz-zzz', 'home-9']);
    expect((err as Error).message).toContain('No coordinates in the travel cache for place(s): biz-zzz, home-9');
    expect(matrixCalls).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
    expect(files).toEqual(before);

    // A cached pair needs no coordinates.
    files.matrix.pairs['home-9|biz-a'] = { durationS: 300, distanceM: 2000 };
    await expect(travel.ensurePairs([{ from: 'home-9', to: 'biz-a' }])).resolves.toEqual({ fetched: 0 });
  });

  it('when the client fails part way, earlier answers are kept and persisted and the client error is passed on', async () => {
    const files = cacheWith();
    const quota = new GoogleApiError({ status: 429, googleStatus: 'RESOURCE_EXHAUSTED', endpoint: ROUTE_MATRIX_URL, message: 'quota exceeded' });
    const { client, matrixCalls } = fakeClient({ failMatrixCall: { index: 1, error: quota } });
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });
    const pairs = [
      { from: 'biz-a', to: 'home-1' },
      { from: 'biz-b', to: 'home-2' },
      { from: 'biz-c', to: 'biz-a' },
    ];

    expect(await thrownBy(() => travel.ensurePairs(pairs))).toBe(quota);
    expect(matrixCalls).toHaveLength(2);
    expect(Object.keys(files.matrix.pairs)).toEqual(['biz-a|home-1']);
    expect(snapshots).toHaveLength(1);

    // Re-running resumes: only the two pairs still missing are requested.
    const retry = fakeClient();
    const again = createGoogleTravel({ files, client: retry.client, persist });
    expect(await again.ensurePairs(pairs)).toEqual({ fetched: 2 });
    expect(retry.requestedPairs()).toEqual(['biz-b|home-2', 'biz-c|biz-a']);
    expect(snapshots).toHaveLength(2);
  });

  it('ignores an answer for a pair it did not ask for, and an unreadable number is a failure', async () => {
    const files = cacheWith();
    const client: GoogleTravelClient = {
      async computeRouteMatrix() {
        return {
          elements: [
            { originIndex: 0, destinationIndex: 0, durationS: Number.NaN, distanceM: 500 },
            { originIndex: 0, destinationIndex: 1, durationS: 700, distanceM: 5200 },
            { originIndex: 0, destinationIndex: 1, durationS: 1, distanceM: 1 }, // sent twice: the first answer stands
            { originIndex: 3, destinationIndex: 0, durationS: 9, distanceM: 9 }, // outside the request
          ],
          failures: [],
        };
      },
      async computeRoutePolyline() {
        throw new Error('not used');
      },
    };
    const err = await thrownBy(() =>
      createGoogleTravel({ files, client }).ensurePairs([
        { from: 'home-1', to: 'biz-a' },
        { from: 'home-1', to: 'biz-b' },
      ]),
    );
    expect((err as TravelRouteError).failures).toEqual([
      { from: 'home-1', to: 'biz-a', what: 'matrix', reason: 'Google sent an unreadable duration or distance' },
    ]);
    expect(files.matrix.pairs).toEqual({ 'home-1|biz-b': { durationS: 700, distanceM: 5200 } });
  });

  it('runs one fetch at a time: two overlapping calls for the same pairs buy them once', async () => {
    const files = cacheWith();
    const { client, matrixCalls } = fakeClient();
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });
    const pairs = [
      { from: 'home-1', to: 'biz-a' },
      { from: 'biz-a', to: 'home-1' },
    ];

    const results = await Promise.all([travel.ensurePairs(pairs), travel.ensurePairs(pairs), travel.ensurePolylines(pairs)]);
    expect(results).toEqual([{ fetched: 2 }, { fetched: 0 }, { fetched: 2 }]);
    expect(matrixCalls).toHaveLength(2);
    expect(snapshots).toHaveLength(2); // one for the matrix fetch, one for the polylines

    // A rejected call does not block the ones after it.
    const failing = fakeClient({ noRoute: ['home-2|biz-a'] });
    const next = createGoogleTravel({ files, client: failing.client });
    const [first, second] = await Promise.allSettled([next.ensurePairs([{ from: 'home-2', to: 'biz-a' }]), next.ensurePairs([{ from: 'home-2', to: 'biz-b' }])]);
    expect(first.status).toBe('rejected');
    expect(second).toEqual({ status: 'fulfilled', value: { fetched: 1 } });
  });

  it('a failing persist rejects the call; the fetched pairs stay in memory', async () => {
    const files = cacheWith();
    const { client } = fakeClient();
    const travel = createGoogleTravel({
      files,
      client,
      persist: async () => {
        throw new Error('disk full');
      },
    });
    await expect(travel.ensurePairs([{ from: 'home-1', to: 'biz-a' }])).rejects.toThrow('disk full');
    expect(travel.provider.has('home-1', 'biz-a')).toBe(true);
  });
});

describe('createGoogleTravel.ensurePolylines', () => {
  it('fetches only missing route lines, one request per pair, and writes nothing into the matrix', async () => {
    const files = cacheWith();
    files.polylines.polylines['home-1|biz-a'] = 'cached-line';
    const before = structuredClone(files.matrix);
    const { client, polylineCalls, matrixCalls } = fakeClient();
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });
    const pairs = [
      { from: 'home-1', to: 'biz-a' },
      { from: 'biz-b', to: 'home-1' },
      { from: 'biz-a', to: 'home-1' },
      { from: 'biz-a', to: 'biz-a' },
      { from: 'biz-a', to: 'home-1' },
    ];

    expect(await travel.ensurePolylines(pairs)).toEqual({ fetched: 2 });
    expect(polylineCalls).toEqual(['biz-a|home-1', 'biz-b|home-1']);
    expect(matrixCalls).toHaveLength(0);
    expect(files.polylines.polylines).toEqual({
      'home-1|biz-a': 'cached-line',
      'biz-a|home-1': 'line:biz-a>home-1',
      'biz-b|home-1': 'line:biz-b>home-1',
    });
    expect(files.matrix).toEqual(before);
    expect(travel.provider.polyline('biz-a', 'home-1')).toBe('line:biz-a>home-1');
    expect(travel.provider.polyline('home-2', 'biz-a')).toBeNull();
    expect(snapshots).toHaveLength(1);

    expect(await travel.ensurePolylines(pairs)).toEqual({ fetched: 0 });
    expect(polylineCalls).toHaveLength(2);
    expect(snapshots).toHaveLength(1);
  });

  it('a pair without a route is skipped and reported; the others are kept', async () => {
    const files = cacheWith();
    const { client, polylineCalls } = fakeClient({ polylineError: (from) => (from === 'biz-b' ? noRouteError() : null) });
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });

    const err = await thrownBy(() =>
      travel.ensurePolylines([
        { from: 'biz-a', to: 'home-1' },
        { from: 'biz-b', to: 'home-1' },
        { from: 'biz-c', to: 'home-1' },
      ]),
    );
    expect(err).toBeInstanceOf(TravelRouteError);
    expect(err).toMatchObject({ googleStatus: 'NO_ROUTE', endpoint: ROUTES_URL });
    expect((err as TravelRouteError).failures).toEqual([{ from: 'biz-b', to: 'home-1', what: 'polyline', reason: 'no route between these points' }]);
    expect((err as Error).message).toContain('no route line for 1 of 3 requested pair(s): biz-b|home-1');
    expect(polylineCalls).toEqual(['biz-a|home-1', 'biz-b|home-1', 'biz-c|home-1']);
    expect(Object.keys(files.polylines.polylines)).toEqual(['biz-a|home-1', 'biz-c|home-1']);
    expect(travel.provider.polyline('biz-b', 'home-1')).toBeNull();
    expect(snapshots).toHaveLength(1);
  });

  it('any other client error stops the run at once; what was fetched before it is kept and persisted', async () => {
    const files = cacheWith();
    const denied = new GoogleApiError({ status: 403, googleStatus: 'PERMISSION_DENIED', endpoint: ROUTES_URL, message: 'API not enabled' });
    const { client, polylineCalls } = fakeClient({ polylineError: (from) => (from === 'biz-b' ? denied : null) });
    const { persist, snapshots } = persistSpy();
    const travel = createGoogleTravel({ files, client, persist });

    const err = await thrownBy(() =>
      travel.ensurePolylines([
        { from: 'biz-a', to: 'home-1' },
        { from: 'biz-b', to: 'home-1' },
        { from: 'biz-c', to: 'home-1' },
      ]),
    );
    expect(err).toBe(denied);
    expect(polylineCalls).toEqual(['biz-a|home-1', 'biz-b|home-1']);
    expect(files.polylines.polylines).toEqual({ 'biz-a|home-1': 'line:biz-a>home-1' });
    expect(snapshots).toHaveLength(1);
  });

  it('rejects before any request when a place has no coordinates', async () => {
    const files = cacheWith();
    const { client, polylineCalls } = fakeClient();
    const err = await thrownBy(() => createGoogleTravel({ files, client }).ensurePolylines([{ from: 'home-9', to: 'biz-a' }]));
    expect(err).toBeInstanceOf(TravelPlaceMissingError);
    expect((err as TravelPlaceMissingError).placeIds).toEqual(['home-9']);
    expect(polylineCalls).toHaveLength(0);
    expect(files.polylines.polylines).toEqual({});
  });
});

describe('with the real googleClient bound to a fake fetch', () => {
  const routesFetch = (reply: (url: string, body: any) => { status: number; body: unknown }) => {
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const body = JSON.parse(init?.body ?? 'null');
      calls.push({ url, headers: init?.headers ?? {}, body });
      const answer = reply(url, body);
      return { status: answer.status, text: async () => JSON.stringify(answer.body) };
    };
    return { calls, fetchImpl };
  };
  const noSleep = async () => {};

  it('ensurePairs and ensurePolylines send DRIVE + TRAFFIC_UNAWARE requests and store what Google said', async () => {
    const files = cacheWith();
    const { calls, fetchImpl } = routesFetch((url) =>
      url === ROUTE_MATRIX_URL
        ? {
            status: 200,
            body: [
              { originIndex: 0, destinationIndex: 0, duration: '1501s', distanceMeters: 12040, condition: 'ROUTE_EXISTS', status: {} },
              { originIndex: 0, destinationIndex: 1, duration: '961s', distanceMeters: 7310, condition: 'ROUTE_EXISTS', status: {} },
            ],
          }
        : { status: 200, body: { routes: [{ duration: '1501s', distanceMeters: 12040, polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' } }] } },
    );
    const travel = createGoogleTravel({ files, client: bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: noSleep }) });

    await travel.ensurePairs([
      { from: 'home-1', to: 'biz-a' },
      { from: 'home-1', to: 'biz-b' },
    ]);
    await travel.ensurePolylines([{ from: 'home-1', to: 'biz-a' }]);

    expect(calls.map((call) => call.url)).toEqual([ROUTE_MATRIX_URL, ROUTES_URL]);
    for (const call of calls) expect(call.body).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
    expect(calls[0].body.origins).toEqual([{ waypoint: { location: { latLng: { latitude: 40.7644, longitude: -73.9235 } } } }]);
    expect(calls[0].body.destinations).toHaveLength(2);
    expect(files.matrix.pairs).toEqual({
      'home-1|biz-a': { durationS: 1501, distanceM: 12040 },
      'home-1|biz-b': { durationS: 961, distanceM: 7310 },
    });
    expect(travel.provider.durationMin('home-1', 'biz-a')).toBe(26); // 1501 s rounded up
    expect(travel.provider.durationMin('home-1', 'biz-b')).toBe(17); // 961 s rounded up
    expect(travel.provider.polyline('home-1', 'biz-a')).toBe('_p~iF~ps|U_ulLnnqC');
  });

  it('the key never appears in an error: Google HTTP errors, route failures and missing routes', async () => {
    const files = cacheWith();
    const before = structuredClone(files);

    // 1. Google refuses the request and echoes the key in its message.
    const denied = routesFetch(() => ({
      status: 403,
      body: { error: { code: 403, status: 'PERMISSION_DENIED', message: `API key ${KEY} is not authorized (key=${KEY_ENCODED})` } },
    }));
    const deniedTravel = createGoogleTravel({ files, client: bindGoogleClient({ apiKey: KEY, fetchImpl: denied.fetchImpl, sleep: noSleep }) });
    for (const run of [
      () => deniedTravel.ensurePairs([{ from: 'home-1', to: 'biz-a' }]),
      () => deniedTravel.ensurePolylines([{ from: 'home-1', to: 'biz-a' }]),
    ]) {
      const err = await thrownBy(run);
      expect(err).toBeInstanceOf(GoogleApiError);
      expect(err).toMatchObject({ status: 403, googleStatus: 'PERMISSION_DENIED' });
      expectNoKey(err);
    }

    // 2. One pair has no route, and the element's status message echoes the key.
    const unroutable = routesFetch((url) =>
      url === ROUTE_MATRIX_URL
        ? { status: 200, body: [{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND', status: { code: 5, message: `no route (request key ${KEY})` } }] }
        : { status: 200, body: {} },
    );
    const unroutableTravel = createGoogleTravel({ files, client: bindGoogleClient({ apiKey: KEY, fetchImpl: unroutable.fetchImpl, sleep: noSleep }) });
    const matrixErr = await thrownBy(() => unroutableTravel.ensurePairs([{ from: 'home-1', to: 'biz-a' }]));
    expect(matrixErr).toBeInstanceOf(TravelRouteError);
    expect((matrixErr as TravelRouteError).failures).toEqual([{ from: 'home-1', to: 'biz-a', what: 'matrix', reason: 'no route (request key [redacted])' }]);
    expectNoKey(matrixErr);

    const lineErr = await thrownBy(() => unroutableTravel.ensurePolylines([{ from: 'home-1', to: 'biz-a' }]));
    expect(lineErr).toBeInstanceOf(TravelRouteError);
    expect((lineErr as TravelRouteError).failures).toEqual([{ from: 'home-1', to: 'biz-a', what: 'polyline', reason: 'no route between these points' }]);
    expectNoKey(lineErr);

    expect(files).toEqual(before); // none of the failures wrote anything
  });
});

describe('persist with writeTravelFiles', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-google-travel-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a fetched commute is on disk afterwards, and a provider started from the files needs no request', async () => {
    const dir = path.join(root, 'nyc');
    const files = cacheWith();
    const first = fakeClient();
    const travel = createGoogleTravel({ files, client: first.client, persist: (current) => writeTravelFiles(dir, current) });
    const commute = [
      { from: 'home-1', to: 'biz-a' },
      { from: 'biz-a', to: 'home-1' },
    ];
    await travel.ensurePairs(commute);
    await travel.ensurePolylines(commute);

    const reloaded = readTravelFiles(dir);
    expect(reloaded).toEqual(files);

    const second = fakeClient();
    const restarted = createGoogleTravel({ files: reloaded!, client: second.client });
    expect(await restarted.ensurePairs(commute)).toEqual({ fetched: 0 });
    expect(await restarted.ensurePolylines(commute)).toEqual({ fetched: 0 });
    expect(second.matrixCalls).toHaveLength(0);
    expect(second.polylineCalls).toHaveLength(0);
    expect(restarted.provider.durationMin('home-1', 'biz-a')).toBe(travel.provider.durationMin('home-1', 'biz-a'));
  });
});
