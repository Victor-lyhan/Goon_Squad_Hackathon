// Runtime travel service (server/geo/travelService.ts): loading the cache at start and the synchronous lookups.
// Temp directories and a fake fetch only: no network, no real key, no .env.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TravelDataMissingError } from '../../shared/v2/types';
import { MATRIX_FILE, POLYLINES_FILE, TravelCacheError, emptyTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import { TravelNotLoadedError, createTravelService } from '../../server/geo/travelService';
import {
  KEY, NEW_HOME, NEW_HOME_POINT, TRAVEL_SERVICE_TEST_TIMEOUT_MS, fakeGoogle, lineFor, metersFor, noSleep, secondsFor, seedFiles, tempDirs, watchSuite,
} from './travelServiceHarness';

vi.setConfig({ testTimeout: TRAVEL_SERVICE_TEST_TIMEOUT_MS });

const dirs = tempDirs();
const suite = watchSuite();

describe('createTravelService: loading', () => {
  it('is not ready when the directory does not exist, and creates nothing', () => {
    const dir = dirs.empty();
    const service = createTravelService({ dir, key: KEY, fetch: fakeGoogle().fetch });
    expect(service.ready).toBe(false);
    expect(service.provider).toBeNull();
    expect(service.files).toEqual(emptyTravelFiles());
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('is not ready when the cache has places but no pairs', () => {
    const dir = dirs.empty();
    const files = seedFiles();
    files.matrix.pairs = {};
    writeTravelFiles(dir, files);
    const service = createTravelService({ dir, key: KEY, fetch: fakeGoogle().fetch });
    expect(service.ready).toBe(false);
    expect(service.provider).toBeNull();
    expect(Object.keys(service.files.matrix.places)).toContain('biz-a');
  });

  it('throws TravelCacheError for a corrupt cache and leaves the file as it was', () => {
    const cases: { file: string; text: string; says: string }[] = [
      { file: MATRIX_FILE, text: '{ "schemaVersion": 1, "places": {', says: 'not valid JSON' },
      { file: MATRIX_FILE, text: JSON.stringify({ schemaVersion: 2, places: {}, pairs: {} }), says: 'schemaVersion' },
      { file: MATRIX_FILE, text: JSON.stringify({ schemaVersion: 1, places: {}, pairs: { 'a|b': { durationS: 'soon', distanceM: 1 } } }), says: 'durationS' },
      { file: POLYLINES_FILE, text: 'not json', says: 'not valid JSON' },
    ];
    for (const { file, text, says } of cases) {
      const dir = dirs.seeded();
      const filePath = path.join(dir, file);
      fs.writeFileSync(filePath, text);
      const err = suite.thrownBySync(() => createTravelService({ dir, key: KEY, fetch: fakeGoogle().fetch }));
      expect(err).toBeInstanceOf(TravelCacheError);
      expect((err as TravelCacheError).file).toBe(filePath);
      expect((err as Error).message).toContain(says);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(text); // never silently replaced
    }
  });

  it('loads a cache without polylines.json: ready, with no route lines', () => {
    const dir = dirs.seeded();
    fs.rmSync(path.join(dir, POLYLINES_FILE));
    const service = createTravelService({ dir, key: '' });
    expect(service.ready).toBe(true);
    expect(service.provider!.durationMin('biz-a', 'biz-b')).toBeGreaterThan(0);
    expect(service.provider!.polyline('biz-a', 'biz-b')).toBeNull();
  });
});

describe('createTravelService: lookups over a written cache', () => {
  it('answers durations (seconds rounded up), distances, route lines and places, with no key and no request', () => {
    const google = fakeGoogle();
    const service = createTravelService({ dir: dirs.seeded(), key: '', fetch: google.fetch });
    expect(service.ready).toBe(true);
    const provider = service.provider!;

    expect(provider.durationMin('home-001', 'biz-a')).toBe(Math.ceil(secondsFor('home-001', 'biz-a') / 60));
    expect(provider.durationMin('biz-a', 'home-001')).toBe(Math.ceil(secondsFor('biz-a', 'home-001') / 60));
    expect(provider.distanceM('biz-b', 'biz-c')).toBe(metersFor('biz-b', 'biz-c'));
    expect(provider.durationMin('biz-a', 'biz-a')).toBe(0);
    expect(provider.distanceM('biz-a', 'biz-a')).toBe(0);
    expect(provider.polyline('biz-a', 'biz-b')).toBe(lineFor('biz-a', 'biz-b'));
    expect(provider.polyline('biz-b', 'biz-a')).toBeNull();
    expect(provider.has('home-001', 'biz-c')).toBe(true);
    expect(provider.has('home-story-ana', 'biz-c')).toBe(false);
    expect(provider.place('biz-b')).toEqual({ lat: 40.7033, lng: -73.9881 });
    expect(provider.place(NEW_HOME)).toBeNull();
    expect(service.files).toEqual(seedFiles());
    expect(google.calls).toEqual([]);
  });

  it('never estimates: a pair that is not cached throws TravelDataMissingError', () => {
    const provider = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: fakeGoogle().fetch }).provider!;
    const err = suite.thrownBySync(() => provider.durationMin('home-story-ana', 'biz-a'));
    expect(err).toBeInstanceOf(TravelDataMissingError);
    expect(suite.thrownBySync(() => provider.distanceM('biz-a', NEW_HOME))).toBeInstanceOf(TravelDataMissingError);
  });
});

describe('createTravelService: a service that is not ready', () => {
  it('calls nothing and writes nothing, even with a key', async () => {
    const dir = dirs.empty();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });

    expect(suite.thrownBySync(() => service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT }))).toBeInstanceOf(TravelNotLoadedError);
    expect(await suite.thrownBy(() => service.ensurePairs([{ from: 'biz-a', to: 'biz-b' }]))).toBeInstanceOf(TravelNotLoadedError);
    expect(await suite.thrownBy(() => service.ensurePolylines([{ from: 'biz-a', to: 'biz-b' }]))).toBeInstanceOf(TravelNotLoadedError);
    expect(await service.ensureLegPolylines([{ placeIds: ['biz-a', 'biz-b', 'home-001'] }])).toEqual({ fetched: 0, failed: 2 });

    expect(google.calls).toEqual([]);
    expect(service.files).toEqual(emptyTravelFiles());
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('leaks', () => {
  it('no error and no output of this suite holds the key', () => {
    suite.expectNoLeak(8);
  });
});
