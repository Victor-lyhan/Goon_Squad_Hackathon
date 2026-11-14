// Runtime travel service (server/geo/travelService.ts): a refused pair fetch leaves nothing behind (#520).
// A commute save with a new address calls `addPlaces` and then `ensurePairs`. When the fetch is refused, the
// place must be gone again, in memory and in every later cache write, so a typed address without travel pairs
// never reaches matrix.json (SPEC MVP II rule 6, DECISIONS pass 56).
// Temp directories, a fake fetch and a recording persist only: no network, no real key, no .env.
// An entered home's ID holds its coordinates, so no assertion message here prints an ID or a place list.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pairKey } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { GoogleApiError, GoogleKeyMissingError, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { PlacePair } from '../../server/geo/googleProvider';
import { createTravelService } from '../../server/geo/travelService';
import type { TravelService } from '../../server/geo/travelService';
import {
  BUSINESSES, KEY, NEW_HOME, NEW_HOME_POINT, OTHER_HOME, OTHER_HOME_POINT, POINTS, TRAVEL_SERVICE_TEST_TIMEOUT_MS, coordinateTexts, fakeGoogle,
  google500, lineFor, metersFor, noSleep, secondsFor, seedFiles, tempDirs, watchSuite,
} from './travelServiceHarness';
import type { GoogleCall, GoogleReply } from './travelServiceHarness';

vi.setConfig({ testTimeout: TRAVEL_SERVICE_TEST_TIMEOUT_MS });

const dirs = tempDirs();
const suite = watchSuite();

/** What a commute save needs for a new home: the home to and from every business. */
const homePairs = (home: string): PlacePair[] => BUSINESSES.flatMap((biz) => [{ from: home, to: biz }, { from: biz, to: home }]);
const bytesOf = (dir: string) => [MATRIX_FILE, POLYLINES_FILE].map((file) => fs.readFileSync(path.join(dir, file), 'utf8'));

/** The two calls of the commute route (server/api/v2/commuteRoutes.ts), with nothing awaited in between. */
function save(service: TravelService, home: string, point: LatLng): Promise<{ fetched: number }> {
  service.addPlaces({ [home]: point });
  return service.ensurePairs(homePairs(home));
}

/** A service over the seeded cache with a fake Google and a persist that keeps a copy of every write. */
function start(key: string | undefined, override?: (call: GoogleCall, index: number) => GoogleReply | null) {
  const dir = dirs.seeded();
  const google = fakeGoogle(override);
  const persisted: TravelFiles[] = [];
  const service = createTravelService({
    dir, key, fetch: google.fetch, sleep: noSleep, persist: (files) => void persisted.push(structuredClone(files)),
  });
  return { dir, google, persisted, service };
}

// Booleans only, so a failure never prints a place ID.
const knows = (service: TravelService, home: string) => ({
  inPlaces: Object.hasOwn(service.files.matrix.places, home),
  inProvider: service.provider!.place(home) !== null,
});
const GONE = { inPlaces: false, inProvider: false };
const THERE = { inPlaces: true, inProvider: true };

/** How many places of `files` have no travel pair in either direction. */
function placesWithoutPair(files: TravelFiles): number {
  const paired = new Set(Object.keys(files.matrix.pairs).flatMap((key) => key.split('|')));
  return Object.keys(files.matrix.places).filter((id) => !paired.has(id)).length;
}
// `home-story-ana` is in the seeded cache with coordinates and no pair. It was there at start, so it stays.
const SEED_PLACES_WITHOUT_PAIR = placesWithoutPair(seedFiles());
const SEED_PLACE_COUNT = Object.keys(seedFiles().matrix.places).length;

const namesHome = (call: GoogleCall, home: string) => call.pairs.some((key) => key.split('|').includes(home));
const pairsOf = (files: TravelFiles, home: string) => Object.keys(files.matrix.pairs).filter((key) => key.split('|').includes(home)).length;

describe('a refused pair fetch removes the new place again', () => {
  it('no key: GoogleKeyMissingError, the place is gone from files and provider, nothing was persisted', async () => {
    for (const key of ['', '   ', undefined]) {
      const { dir, google, persisted, service } = start(key);
      const before = bytesOf(dir);

      const err = await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));

      expect(err).toBeInstanceOf(GoogleKeyMissingError);
      expect(knows(service, NEW_HOME)).toEqual(GONE);
      expect(service.files).toEqual(seedFiles());
      expect(google.calls).toEqual([]);
      expect(persisted).toEqual([]);
      expect(bytesOf(dir)).toEqual(before);
    }
  });

  it('a key and a Google error on every call: the same, and the error passes through unchanged', async () => {
    const { dir, google, persisted, service } = start(KEY, () => google500);
    const before = bytesOf(dir);

    const err = await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));

    // Google's own error, as tests/geo/travel-service-fetch.test.ts sees it without a rollback.
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).name).toBe('GoogleApiError');
    expect((err as GoogleApiError).status).toBe(500);
    expect((err as GoogleApiError).googleStatus).toBe('INTERNAL');
    expect((err as Error).message).toContain('[redacted]');
    expect(google.calls.length).toBeGreaterThan(1); // retried, then given up
    expect(knows(service, NEW_HOME)).toEqual(GONE);
    expect(service.files).toEqual(seedFiles());
    expect(persisted).toEqual([]);
    expect(bytesOf(dir)).toEqual(before);
  });

  it('a "no route" answer for every pair removes the place too', async () => {
    const { persisted, service } = start(KEY, (call) => {
      // `call.pairs` is origins x destinations, origin by origin.
      const destinations = new Set(call.pairs.map((key) => key.split('|')[1])).size;
      return {
        status: 200,
        body: call.pairs.map((_, index) => ({
          originIndex: Math.floor(index / destinations), destinationIndex: index % destinations, condition: 'ROUTE_NOT_FOUND', status: {},
        })),
      };
    });
    const err = await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));
    expect((err as GoogleApiError).googleStatus).toBe('NO_ROUTE');
    expect(knows(service, NEW_HOME)).toEqual(GONE);
    expect(service.files).toEqual(seedFiles());
    expect(persisted).toEqual([]);
  });

  it('an answer for half of the pairs before an error: the place and its fetched pairs stay and are persisted', async () => {
    // Two requests: every business -> the home answers, then the home -> every business fails.
    let down = true;
    const { google, persisted, service } = start(KEY, (call) => (down && call.pairs[0].startsWith(NEW_HOME) ? google500 : null));

    const err = await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));

    expect(err).toBeInstanceOf(GoogleApiError);
    expect(knows(service, NEW_HOME)).toEqual(THERE);
    expect(service.files.matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual(service.files);
    expect(persisted[0].matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    for (const biz of BUSINESSES) {
      expect(persisted[0].matrix.pairs[pairKey(biz, NEW_HOME)]).toEqual({ durationS: secondsFor(biz, NEW_HOME), distanceM: metersFor(biz, NEW_HOME) });
      expect(service.provider!.has(NEW_HOME, biz)).toBe(false);
    }

    // The retry fills the rest and buys nothing twice. The place is on disk now, so a later failure keeps it.
    down = false;
    const callsBefore = google.calls.length;
    expect(await save(service, NEW_HOME, NEW_HOME_POINT)).toEqual({ fetched: 3 });
    expect(google.calls.slice(callsBefore).flatMap((call) => call.pairs).sort()).toEqual(BUSINESSES.map((biz) => pairKey(NEW_HOME, biz)).sort());
    expect(persisted).toHaveLength(2);
    expect(pairsOf(persisted[1], NEW_HOME)).toBe(6);
  });

  it('after a rolled-back save, a later successful ensureLegPolylines persists files that hold no place without a pair', async () => {
    let down = true;
    const { persisted, service } = start(KEY, () => (down ? google500 : null));
    await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));
    expect(persisted).toEqual([]);

    down = false;
    expect(await service.ensureLegPolylines([{ placeIds: ['biz-b', 'biz-c', 'home-001'] }])).toEqual({ fetched: 2, failed: 0 });

    expect(persisted).toHaveLength(1);
    expect(Object.hasOwn(persisted[0].matrix.places, NEW_HOME)).toBe(false);
    expect(persisted[0].matrix).toEqual(seedFiles().matrix);
    expect(placesWithoutPair(persisted[0])).toBe(SEED_PLACES_WITHOUT_PAIR); // only what the cache had at start
    expect(persisted[0].polylines.polylines[pairKey('biz-b', 'biz-c')]).toBe(lineFor('biz-b', 'biz-c'));
  });

  it('the same, written to the cache directory: matrix.json never holds the point', async () => {
    const dir = dirs.seeded();
    const matrixBefore = fs.readFileSync(path.join(dir, MATRIX_FILE), 'utf8');
    let down = true;
    const service = createTravelService({ dir, key: KEY, fetch: fakeGoogle(() => (down ? google500 : null)).fetch, sleep: noSleep });
    await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));

    down = false;
    expect(await service.ensureLegPolylines([{ placeIds: ['biz-b', 'biz-c', 'home-001'] }])).toEqual({ fetched: 2, failed: 0 });

    const [matrixText, polylinesText] = bytesOf(dir);
    expect(matrixText === matrixBefore).toBe(true);
    for (const text of coordinateTexts(NEW_HOME_POINT)) {
      expect(matrixText.includes(text)).toBe(false);
      expect(polylinesText.includes(text)).toBe(false);
    }
    expect(readTravelFiles(dir)).toEqual(service.files);
    expect(createTravelService({ dir, key: '' }).provider!.place(NEW_HOME)).toBeNull(); // a restart does not know it either
  });

  it('the same address saved again after the failure works: addPlaces accepts it and ensurePairs fetches it', async () => {
    let down = true;
    const { google, persisted, service } = start(KEY, () => (down ? google500 : null));
    await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));
    expect(knows(service, NEW_HOME)).toEqual(GONE);

    down = false;
    const callsBefore = google.calls.length;
    expect(await save(service, NEW_HOME, { ...NEW_HOME_POINT })).toEqual({ fetched: 6 });

    expect(google.calls.slice(callsBefore).flatMap((call) => call.pairs).sort()).toEqual(homePairs(NEW_HOME).map((p) => pairKey(p.from, p.to)).sort());
    expect(knows(service, NEW_HOME)).toEqual(THERE);
    expect(service.provider!.durationMin(NEW_HOME, 'biz-a')).toBe(Math.ceil(secondsFor(NEW_HOME, 'biz-a') / 60));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(persisted[0]).toEqual(service.files);
  });

  it('a refused save after a rolled-back one may use other coordinates for the same ID: nothing of the first is left', async () => {
    const { service } = start('');
    await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));
    // Before the rollback this was a TravelPlaceError ("already in the travel cache with other coordinates").
    const err = await suite.thrownBy(() => save(service, NEW_HOME, OTHER_HOME_POINT));
    expect(err).toBeInstanceOf(GoogleKeyMissingError);
    expect(service.files).toEqual(seedFiles());
  });
});

describe('overlapping saves', () => {
  const failing = (home: string) => (call: GoogleCall) => (namesHome(call, home) ? google500 : null);

  it('two new homes, the first one failing: only the failed one is removed', async () => {
    const { persisted, service } = start(KEY, failing(NEW_HOME));

    // Both are registered and both wait in the pairs' queue before the first request is answered.
    const first = save(service, NEW_HOME, NEW_HOME_POINT);
    const second = save(service, OTHER_HOME, OTHER_HOME_POINT);
    const [failed, worked] = await Promise.allSettled([first, second]);
    if (failed.status === 'rejected') suite.errors.push(failed.reason);

    expect(failed.status).toBe('rejected');
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(GoogleApiError);
    expect(worked).toEqual({ status: 'fulfilled', value: { fetched: 6 } });
    expect(knows(service, NEW_HOME)).toEqual(GONE);
    expect(knows(service, OTHER_HOME)).toEqual(THERE);
    expect(pairsOf(service.files, OTHER_HOME)).toBe(6);
    expect(pairsOf(service.files, NEW_HOME)).toBe(0);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual(service.files);
    expect(Object.keys(persisted[0].matrix.places)).toHaveLength(SEED_PLACE_COUNT + 1);
    expect(placesWithoutPair(persisted[0])).toBe(SEED_PLACES_WITHOUT_PAIR);
  });

  it('two new homes, the second one failing: only the failed one is removed, and the first write does not hold it', async () => {
    const { persisted, service } = start(KEY, failing(OTHER_HOME));

    const first = save(service, NEW_HOME, NEW_HOME_POINT);
    const second = save(service, OTHER_HOME, OTHER_HOME_POINT);
    const [worked, failed] = await Promise.allSettled([first, second]);
    if (failed.status === 'rejected') suite.errors.push(failed.reason);

    expect(worked).toEqual({ status: 'fulfilled', value: { fetched: 6 } });
    expect(failed.status).toBe('rejected');
    expect(knows(service, NEW_HOME)).toEqual(THERE);
    expect(knows(service, OTHER_HOME)).toEqual(GONE);
    // The first save was written while the second home was registered and still had no pair.
    expect(persisted).toHaveLength(1);
    expect(Object.hasOwn(persisted[0].matrix.places, OTHER_HOME)).toBe(false);
    expect(persisted[0].matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(placesWithoutPair(persisted[0])).toBe(SEED_PLACES_WITHOUT_PAIR);
    expect(persisted[0]).toEqual(service.files);
  });

  it('two saves of the same new home, the first one failing: the second still finds the place and fetches it', async () => {
    let failures = 0;
    // Only the first save's requests fail (the client tries each request a few times before it gives up).
    let firstSaveDone = false;
    const { persisted, service } = start(KEY, () => {
      if (firstSaveDone) return null;
      failures += 1;
      return google500;
    });

    const first = save(service, NEW_HOME, NEW_HOME_POINT).finally(() => { firstSaveDone = true; });
    const second = save(service, NEW_HOME, NEW_HOME_POINT);
    const [failed, worked] = await Promise.allSettled([first, second]);
    if (failed.status === 'rejected') suite.errors.push(failed.reason);

    expect(failures).toBeGreaterThan(0);
    expect(failed.status).toBe('rejected');
    expect(worked).toEqual({ status: 'fulfilled', value: { fetched: 6 } });
    expect(knows(service, NEW_HOME)).toEqual(THERE);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual(service.files);
  });

  it('two saves of the same new home, both failing: the place is removed after the second', async () => {
    const { persisted, service } = start(KEY, () => google500);
    const results = await Promise.allSettled([save(service, NEW_HOME, NEW_HOME_POINT), save(service, NEW_HOME, NEW_HOME_POINT)]);
    for (const result of results) if (result.status === 'rejected') suite.errors.push(result.reason);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(knows(service, NEW_HOME)).toEqual(GONE);
    expect(service.files).toEqual(seedFiles());
    expect(persisted).toEqual([]);
  });

  it('a route-line fetch that is written while a new home waits for its pairs does not write the home', async () => {
    const { persisted, service } = start(KEY, failing(NEW_HOME));

    const lines = service.ensureLegPolylines([{ placeIds: ['biz-b', 'biz-c', 'home-001'] }]); // its own queue: side by side with the save
    const refused = suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));
    expect(await lines).toEqual({ fetched: 2, failed: 0 });
    expect(await refused).toBeInstanceOf(GoogleApiError);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].matrix).toEqual(seedFiles().matrix);
    expect(knows(service, NEW_HOME)).toEqual(GONE);
    expect(service.files.matrix).toEqual(seedFiles().matrix);
  });

  it('a place that is held back from one write reaches the disk with its pairs', async () => {
    // The leg lines have their own queue (#601), so they are written while the pair fetch is still open.
    // Google answers the pair requests only after that write, so the order does not depend on timing.
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const persisted: TravelFiles[] = [];
    let answerPairs = () => {};
    const linesWritten = new Promise<void>((resolve) => { answerPairs = resolve; });
    const service = createTravelService({
      dir, key: KEY, sleep: noSleep, persist: (files) => void persisted.push(structuredClone(files)),
      fetch: async (url, init) => {
        if (url === ROUTE_MATRIX_URL) await linesWritten;
        return google.fetch(url, init);
      },
    });

    const lines = service.ensureLegPolylines([{ placeIds: ['biz-b', 'biz-c', 'home-001'] }]);
    const saved = save(service, NEW_HOME, NEW_HOME_POINT);
    expect(await lines).toEqual({ fetched: 2, failed: 0 });
    expect(persisted).toHaveLength(1);
    answerPairs();
    expect(await saved).toEqual({ fetched: 6 });

    expect(persisted).toHaveLength(2);
    expect(Object.hasOwn(persisted[0].matrix.places, NEW_HOME)).toBe(false); // no pair yet
    expect(knows(service, NEW_HOME)).toEqual(THERE); // but never taken out of memory
    expect(persisted[1].matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(persisted[1]).toEqual(service.files);
  });
});

describe('what a rollback never touches', () => {
  it('places of the cache at start stay, with or without pairs, when a fetch for them is refused', async () => {
    for (const [key, override] of [['', undefined], [KEY, () => google500]] as const) {
      const { persisted, service } = start(key, override);
      // `home-story-ana` has no pair in the seeded cache. Registering it again with its own point adds nothing.
      service.addPlaces({ 'home-story-ana': { ...POINTS['home-story-ana'] }, 'biz-a': { ...POINTS['biz-a'] }, 'home-001': { ...POINTS['home-001'] } });
      await suite.thrownBy(() => service.ensurePairs(homePairs('home-story-ana')));
      await suite.thrownBy(() => service.ensurePairs([{ from: 'home-001', to: 'home-story-ana' }, { from: 'biz-a', to: 'home-story-ana' }]));

      expect(knows(service, 'home-story-ana')).toEqual(THERE);
      expect(service.files).toEqual(seedFiles());
      expect(persisted).toEqual([]);
    }
  });

  it('a new place that already has its pairs stays when a later fetch is refused, also before it was written', async () => {
    let down = false;
    const dir = dirs.seeded();
    let diskWorks = false;
    const persisted: TravelFiles[] = [];
    const service = createTravelService({
      dir, key: KEY, fetch: fakeGoogle(() => (down ? google500 : null)).fetch, sleep: noSleep,
      persist: (files) => {
        if (!diskWorks) throw new Error('the disk is full');
        persisted.push(structuredClone(files));
      },
    });
    // The pairs are fetched but the write fails: the place is in memory only, with pairs.
    await suite.thrownBy(() => save(service, NEW_HOME, NEW_HOME_POINT));
    expect(pairsOf(service.files, NEW_HOME)).toBe(6);

    down = true;
    await suite.thrownBy(() => save(service, OTHER_HOME, OTHER_HOME_POINT));

    expect(knows(service, NEW_HOME)).toEqual(THERE);
    expect(knows(service, OTHER_HOME)).toEqual(GONE);
    expect(pairsOf(service.files, NEW_HOME)).toBe(6);

    // The next write that works takes it to the disk.
    down = false;
    diskWorks = true;
    expect(await service.ensureLegPolylines([{ placeIds: ['biz-b', 'biz-c'] }])).toEqual({ fetched: 1, failed: 0 });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].matrix.places[NEW_HOME]).toEqual(NEW_HOME_POINT);
    expect(persisted[0]).toEqual(service.files);
  });

  it('a refused route-line fetch removes nothing: only ensurePairs rolls back', async () => {
    const { service } = start('');
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    const err = await suite.thrownBy(() => service.ensurePolylines([{ from: NEW_HOME, to: 'biz-a' }]));
    expect(err).toBeInstanceOf(GoogleKeyMissingError);
    expect(await service.ensureLegPolylines([{ placeIds: [NEW_HOME, 'biz-a'] }])).toEqual({ fetched: 0, failed: 1 });
    expect(knows(service, NEW_HOME)).toEqual(THERE);
  });

  it('a removed place takes its route lines with it', async () => {
    let down = false;
    const { service } = start(KEY, () => (down ? google500 : null));
    // Not what the commute route does (it asks for lines after the pairs), but the service allows it.
    service.addPlaces({ [NEW_HOME]: NEW_HOME_POINT });
    expect(await service.ensurePolylines([{ from: NEW_HOME, to: 'biz-a' }, { from: 'biz-a', to: NEW_HOME }])).toEqual({ fetched: 2 });

    down = true;
    await suite.thrownBy(() => service.ensurePairs(homePairs(NEW_HOME)));

    expect(knows(service, NEW_HOME)).toEqual(GONE);
    expect(service.provider!.polyline(NEW_HOME, 'biz-a')).toBeNull();
    expect(service.files).toEqual(seedFiles());
  });
});

describe('leaks', () => {
  it('no error and no output of this suite holds the key', () => {
    suite.expectNoLeak(15);
  });
});
