// Runtime travel service (server/geo/travelService.ts): registering a new home, fetching its pairs and route
// lines live, and writing them back to the cache files. Temp directories and a fake fetch only: no network,
// no real key, no .env.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pairKey } from '../../shared/v2/types';
import { MATRIX_FILE, POLYLINES_FILE, TravelCacheError, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { GoogleApiError, GoogleKeyMissingError, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import { TravelPlaceMissingError, TravelRouteError } from '../../server/geo/googleProvider';
import type { PlacePair } from '../../server/geo/googleProvider';
import { TravelPlaceError, createTravelService } from '../../server/geo/travelService';
import {
  BUSINESSES, KEY, NEW_HOME, NEW_HOME_POINT, POINTS, coordinateTexts, expectNoText, fakeGoogle, google500, lineFor, metersFor,
  noSleep, secondsFor, seedFiles, tempDirs, watchSuite,
} from './travelServiceHarness';

const dirs = tempDirs();
const suite = watchSuite();

/** What a commute save needs for a new home: the home to and from every business. */
const homePairs = (home: string): PlacePair[] => BUSINESSES.flatMap((biz) => [{ from: home, to: biz }, { from: biz, to: home }]);
const cachedPairs: PlacePair[] = [...homePairs('home-001'), { from: 'biz-a', to: 'biz-b' }, { from: 'biz-c', to: 'biz-c' }];
const bytesOf = (dir: string) => [MATRIX_FILE, POLYLINES_FILE].map((file) => fs.readFileSync(path.join(dir, file), 'utf8'));

describe('addPlaces', () => {
  it('registers a new home in matrix.places; the same coordinates again change nothing', () => {
    const service = createTravelService({ dir: dirs.seeded(), key: '' });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    expect(service.files.matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(service.provider!.place(NEW_HOME)).toEqual(NEW_HOME_POINT);

    service.addPlaces({ [NEW_HOME]: { ...NEW_HOME_POINT }, 'biz-a': { ...POINTS['biz-a'] } });
    expect(service.files.matrix.places['biz-a'].formattedAddress).toBe('350 5th Ave, New York, NY 10118, USA'); // kept
    expect(Object.keys(service.files.matrix.places)).toHaveLength(Object.keys(seedFiles().matrix.places).length + 1);
  });

  it('keeps only lat and lng, as a copy', () => {
    const service = createTravelService({ dir: dirs.seeded(), key: '' });
    const point = { ...NEW_HOME_POINT, label: '31-14 Example St' };
    service.addPlaces({ [NEW_HOME]: point });
    point.lat = 0;
    expect(service.files.matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
  });

  it('rejects a place that already has other coordinates, adds nothing, and names no coordinate', () => {
    const service = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: fakeGoogle().fetch });
    const moved = { lat: 40.8201, lng: -73.9493 };
    const err = suite.thrownBySync(() => service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT, 'home-story-ana': moved }));
    expect(err).toBeInstanceOf(TravelPlaceError);
    expect((err as TravelPlaceError).placeIds).toEqual(['home-story-ana']);
    expect((err as Error).message).toContain('home-story-ana');
    expectNoText(err, [...coordinateTexts(moved), ...coordinateTexts(POINTS['home-story-ana'])]);
    expect(service.files).toEqual(seedFiles()); // the valid place of the same call was not added either
  });

  it('rejects an unusable ID or coordinate without repeating the value', () => {
    const service = createTravelService({ dir: dirs.seeded(), key: '' });
    const bad: Record<string, { lat: number; lng: number }> = {
      'home-c-far': { lat: 140.7642, lng: -73.9235 },
      'home-c-nan': { lat: Number.NaN, lng: -73.9235 },
      'home|pipe': NEW_HOME_POINT,
      '': NEW_HOME_POINT,
    };
    for (const [id, point] of Object.entries(bad)) {
      const err = suite.thrownBySync(() => service.addPlaces({ [id]: point }));
      expect(err).toBeInstanceOf(TravelPlaceError);
      expect((err as TravelPlaceError).placeIds).toEqual([id]);
      expectNoText(err, ['140.7642', '73.9235']);
    }
    expect(service.files).toEqual(seedFiles());
  });
});

describe('ensurePairs', () => {
  it('resolves for cached pairs with an empty key and makes no request', async () => {
    for (const key of ['', '   ', undefined]) {
      const dir = dirs.seeded();
      const before = bytesOf(dir);
      const google = fakeGoogle();
      const service = createTravelService({ dir, key, fetch: google.fetch });
      expect(await service.ensurePairs(cachedPairs)).toEqual({ fetched: 0 });
      expect(await service.ensurePairs([])).toEqual({ fetched: 0 });
      expect(google.calls).toEqual([]);
      expect(bytesOf(dir)).toEqual(before);
    }
  });

  it('rejects with GoogleKeyMissingError for a missing pair with an empty key, before any request', async () => {
    for (const key of ['', '   ', undefined]) {
      const dir = dirs.seeded();
      const before = bytesOf(dir);
      const google = fakeGoogle();
      const service = createTravelService({ dir, key, fetch: google.fetch });
      service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
      const err = await suite.thrownBy(() => service.ensurePairs([...cachedPairs, ...homePairs(NEW_HOME)]));
      expect(err).toBeInstanceOf(GoogleKeyMissingError);
      // The key error comes first even when a place has no coordinates yet.
      expect(await suite.thrownBy(() => service.ensurePairs([{ from: 'home-c-unknown', to: 'biz-a' }]))).toBeInstanceOf(GoogleKeyMissingError);
      expect(google.calls).toEqual([]);
      expect(service.provider!.has(NEW_HOME, 'biz-a')).toBe(false);
      expect(bytesOf(dir)).toEqual(before);
    }
  });

  it('with a key fetches a missing pair once, shows it through provider and writes it to matrix.json', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    const provider = service.provider!; // taken before the fetch: the same provider sees the new pair
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });

    expect(await service.ensurePairs([{ from: NEW_HOME, to: 'biz-a' }, { from: 'biz-a', to: 'biz-b' }])).toEqual({ fetched: 1 });

    expect(google.calls).toHaveLength(1);
    expect(google.calls[0].url).toBe(ROUTE_MATRIX_URL);
    expect(google.calls[0].pairs).toEqual([pairKey(NEW_HOME, 'biz-a')]); // only the missing pair
    expect(google.calls[0].init?.headers?.['X-Goog-Api-Key']).toBe(KEY);
    expect(provider.durationMin(NEW_HOME, 'biz-a')).toBe(Math.ceil(secondsFor(NEW_HOME, 'biz-a') / 60));
    expect(provider.distanceM(NEW_HOME, 'biz-a')).toBe(metersFor(NEW_HOME, 'biz-a'));

    const onDisk = readTravelFiles(dir)!;
    expect(onDisk.matrix.pairs[pairKey(NEW_HOME, 'biz-a')]).toEqual({ durationS: secondsFor(NEW_HOME, 'biz-a'), distanceM: metersFor(NEW_HOME, 'biz-a') });
    expect(onDisk.matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(onDisk).toEqual(service.files);
    const expected = seedFiles();
    expected.matrix.places[NEW_HOME] = NEW_HOME_POINT;
    expected.matrix.pairs[pairKey(NEW_HOME, 'biz-a')] = { durationS: secondsFor(NEW_HOME, 'biz-a'), distanceM: metersFor(NEW_HOME, 'biz-a') };
    expect(onDisk).toEqual(expected); // everything from before is still there

    // Asking again costs nothing, and a restart finds the pair in the cache without a key.
    expect(await service.ensurePairs([{ from: NEW_HOME, to: 'biz-a' }])).toEqual({ fetched: 0 });
    expect(google.calls).toHaveLength(1);
    const restarted = createTravelService({ dir, key: '' });
    expect(restarted.provider!.durationMin(NEW_HOME, 'biz-a')).toBe(Math.ceil(secondsFor(NEW_HOME, 'biz-a') / 60));
  });

  it('fetches a whole new home (to and from every business) and nothing else', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    expect(await service.ensurePairs([...homePairs(NEW_HOME), ...cachedPairs])).toEqual({ fetched: 6 });
    expect(google.calls.flatMap((call) => call.pairs).sort()).toEqual(homePairs(NEW_HOME).map((p) => pairKey(p.from, p.to)).sort());
    for (const { from, to } of homePairs(NEW_HOME)) expect(readTravelFiles(dir)!.matrix.pairs[pairKey(from, to)].durationS).toBe(secondsFor(from, to));
  });

  it('makes one request for two overlapping calls for the same pair', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    const pair = { from: NEW_HOME, to: 'biz-b' };

    const results = await Promise.all([service.ensurePairs([pair]), service.ensurePairs([pair])]);

    expect(results).toEqual([{ fetched: 1 }, { fetched: 0 }]);
    expect(google.calls).toHaveLength(1);
    expect(readTravelFiles(dir)!.matrix.pairs[pairKey(NEW_HOME, 'biz-b')]).toEqual({ durationS: secondsFor(NEW_HOME, 'biz-b'), distanceM: metersFor(NEW_HOME, 'biz-b') });
  });

  it('rejects on a Google 500; the files on disk still parse and hold everything from before', async () => {
    const dir = dirs.seeded();
    const before = bytesOf(dir);
    const google = fakeGoogle(() => google500);
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });

    const err = await suite.thrownBy(() => service.ensurePairs(homePairs(NEW_HOME)));

    expect(err).toBeInstanceOf(GoogleApiError); // Google's own error, unchanged
    expect((err as GoogleApiError).status).toBe(500);
    expect((err as GoogleApiError).googleStatus).toBe('INTERNAL');
    expect((err as Error).message).toContain('[redacted]'); // Google's body repeated the key; the client removed it
    expect(google.calls.length).toBeGreaterThan(1); // it was retried, then given up
    expect(bytesOf(dir)).toEqual(before);
    expect(readTravelFiles(dir)).toEqual(seedFiles());
    expect(service.provider!.has(NEW_HOME, 'biz-a')).toBe(false); // nothing invented
    expect(service.provider!.durationMin('home-001', 'biz-a')).toBe(Math.ceil(secondsFor('home-001', 'biz-a') / 60));
  });

  it('keeps the pairs that did get an answer, in memory and on disk, when a later request fails', async () => {
    const dir = dirs.seeded();
    // Two requests: every business -> the home, then the home -> every business. The second one fails.
    const google = fakeGoogle((call) => (call.pairs[0].startsWith(NEW_HOME) ? google500 : null));
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });

    const err = await suite.thrownBy(() => service.ensurePairs(homePairs(NEW_HOME)));

    expect(err).toBeInstanceOf(GoogleApiError);
    const onDisk = readTravelFiles(dir)!;
    for (const biz of BUSINESSES) {
      expect(service.provider!.durationMin(biz, NEW_HOME)).toBe(Math.ceil(secondsFor(biz, NEW_HOME) / 60));
      expect(onDisk.matrix.pairs[pairKey(biz, NEW_HOME)]).toEqual({ durationS: secondsFor(biz, NEW_HOME), distanceM: metersFor(biz, NEW_HOME) });
      expect(service.provider!.has(NEW_HOME, biz)).toBe(false);
      expect(Object.hasOwn(onDisk.matrix.pairs, pairKey(NEW_HOME, biz))).toBe(false);
    }
    for (const [key, pair] of Object.entries(seedFiles().matrix.pairs)) expect(onDisk.matrix.pairs[key]).toEqual(pair);
  });

  it('passes on "no route" as TravelRouteError and never writes that pair', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle((call) =>
      call.pairs.includes(pairKey('home-story-ana', 'biz-a'))
        ? { status: 200, body: call.pairs.map((_, destinationIndex) => ({ originIndex: 0, destinationIndex, condition: 'ROUTE_NOT_FOUND', status: {} })) }
        : null,
    );
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    const err = await suite.thrownBy(() => service.ensurePairs([{ from: 'home-story-ana', to: 'biz-a' }]));
    expect(err).toBeInstanceOf(TravelRouteError);
    expect((err as TravelRouteError).failures.map((f) => pairKey(f.from, f.to))).toEqual([pairKey('home-story-ana', 'biz-a')]);
    expectNoText(err, coordinateTexts(POINTS['home-story-ana']));
    expect(readTravelFiles(dir)).toEqual(seedFiles());
  });

  it('rejects with TravelPlaceMissingError, before any request, for a place that was never registered', async () => {
    const google = fakeGoogle();
    const service = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: google.fetch, sleep: noSleep });
    const err = await suite.thrownBy(() => service.ensurePairs(homePairs(NEW_HOME)));
    expect(err).toBeInstanceOf(TravelPlaceMissingError);
    expect(google.calls).toEqual([]);
  });

  it('uses the given persist instead of writing to dir', async () => {
    const dir = dirs.seeded();
    const before = bytesOf(dir);
    const saved: TravelFiles[] = [];
    const service = createTravelService({ dir, key: KEY, fetch: fakeGoogle().fetch, sleep: noSleep, persist: (files) => void saved.push(structuredClone(files)) });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    await service.ensurePairs([{ from: NEW_HOME, to: 'biz-c' }]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(service.files);
    expect(bytesOf(dir)).toEqual(before);
  });

  it('rejects with TravelCacheError when the cache cannot be written; the pair is still in memory', async () => {
    const dir = dirs.seeded();
    const service = createTravelService({ dir, key: KEY, fetch: fakeGoogle().fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    fs.rmSync(dir, { recursive: true });
    fs.writeFileSync(dir, 'a file where the directory was');
    const err = await suite.thrownBy(() => service.ensurePairs([{ from: NEW_HOME, to: 'biz-c' }]));
    expect(err).toBeInstanceOf(TravelCacheError);
    expectNoText(err, coordinateTexts(NEW_HOME_POINT).map((text) => `: ${text}`));
    expect(service.provider!.durationMin(NEW_HOME, 'biz-c')).toBe(Math.ceil(secondsFor(NEW_HOME, 'biz-c') / 60));
  });
});

describe('ensurePolylines', () => {
  const commute: PlacePair[] = [{ from: NEW_HOME, to: 'biz-a' }, { from: 'biz-a', to: NEW_HOME }];

  it('resolves for cached lines with an empty key; a missing line with an empty key is GoogleKeyMissingError; no request either way', async () => {
    const dir = dirs.seeded();
    const before = bytesOf(dir);
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: '', fetch: google.fetch });
    expect(await service.ensurePolylines([{ from: 'home-001', to: 'biz-a' }, { from: 'biz-a', to: 'home-001' }])).toEqual({ fetched: 0 });
    expect(await suite.thrownBy(() => service.ensurePolylines([{ from: 'home-001', to: 'biz-b' }]))).toBeInstanceOf(GoogleKeyMissingError);
    expect(google.calls).toEqual([]);
    expect(bytesOf(dir)).toEqual(before);
  });

  it('with a key fetches each missing line once and writes it to polylines.json', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });

    expect(await service.ensurePolylines([...commute, { from: 'biz-a', to: 'biz-b' }])).toEqual({ fetched: 2 });

    expect(google.lineCalls().flatMap((call) => call.pairs).sort()).toEqual(commute.map((p) => pairKey(p.from, p.to)).sort());
    expect(google.matrixCalls()).toEqual([]);
    expect(service.provider!.polyline(NEW_HOME, 'biz-a')).toBe(lineFor(NEW_HOME, 'biz-a'));
    const onDisk = readTravelFiles(dir)!;
    expect(onDisk.polylines.polylines).toEqual({
      ...seedFiles().polylines.polylines,
      [pairKey(NEW_HOME, 'biz-a')]: lineFor(NEW_HOME, 'biz-a'),
      [pairKey('biz-a', NEW_HOME)]: lineFor('biz-a', NEW_HOME),
    });
    expect(onDisk.matrix.pairs).toEqual(seedFiles().matrix.pairs); // a route line never adds a travel time
  });

  it('rejects on a Google 500 and keeps the lines fetched before it', async () => {
    const dir = dirs.seeded();
    // Lines are fetched in sorted order: "biz-a|home-c-…" answers, "home-c-…|biz-a" fails.
    const google = fakeGoogle((call) => (call.pairs[0].startsWith(NEW_HOME) ? google500 : null));
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });

    const err = await suite.thrownBy(() => service.ensurePolylines(commute));

    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(500);
    const onDisk = readTravelFiles(dir)!;
    expect(onDisk.polylines.polylines[pairKey('biz-a', NEW_HOME)]).toBe(lineFor('biz-a', NEW_HOME));
    expect(Object.hasOwn(onDisk.polylines.polylines, pairKey(NEW_HOME, 'biz-a'))).toBe(false);
    expect(service.provider!.polyline(NEW_HOME, 'biz-a')).toBeNull();
    for (const [key, line] of Object.entries(seedFiles().polylines.polylines)) expect(onDisk.polylines.polylines[key]).toBe(line);
  });
});

describe('one Google fetch at a time', () => {
  it('runs overlapping calls of all the fetching methods one request after another', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });

    const results = await Promise.all([
      service.ensurePairs(homePairs(NEW_HOME)),
      service.ensurePolylines([{ from: NEW_HOME, to: 'biz-a' }, { from: 'biz-a', to: NEW_HOME }]),
      service.ensureLegPolylines([{ placeIds: ['biz-b', 'biz-c', 'home-001'] }]),
      service.ensurePairs(homePairs('home-story-ana')),
    ]);

    expect(results).toEqual([{ fetched: 6 }, { fetched: 2 }, { fetched: 2, failed: 0 }, { fetched: 6 }]);
    expect(google.calls.length).toBeGreaterThanOrEqual(8);
    expect(google.maxInFlight()).toBe(1);
    expect(readTravelFiles(dir)).toEqual(service.files);
  });
});

describe('leaks', () => {
  it('no error and no output of this suite holds the key', () => {
    suite.expectNoLeak(15);
  });
});
