// Runtime travel service (server/geo/travelService.ts): `ensureLegPolylines`, the best-effort route lines of a
// newly matched delivery. It never rejects; a failure leaves the legs on the straight-line fallback.
// Temp directories and a fake fetch only: no network, no real key, no .env.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pairKey } from '../../shared/v2/types';
import type { Leg } from '../../shared/v2/types';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import { createTravelService } from '../../server/geo/travelService';
import { KEY, NEW_HOME, fakeGoogle, google500, lineFor, noSleep, seedFiles, tempDirs, watchSuite } from './travelServiceHarness';

const dirs = tempDirs();
const suite = watchSuite();

/** A full Leg as the matcher builds it; only `placeIds` matters to the travel service. */
function leg(placeIds: string[]): Leg {
  return { tripId: 'trip-emp-1-evening', employeeId: 'emp-1', placeIds, stops: [], finishMin: 1100, extraMin: 4, extraDistanceM: 900, rewardCents: 450 };
}

// A relay: evening A -> R -> home, morning home -> R -> B (DECISIONS pass 45).
const relayLegs = [leg(['biz-a', 'biz-b', 'home-001']), leg(['home-001', 'biz-b', 'biz-c'])];
// Of its four pairs only biz-a|biz-b has a line in the seeded cache.
const missingLines = [pairKey('biz-b', 'home-001'), pairKey('home-001', 'biz-b'), pairKey('biz-b', 'biz-c')];
const bytesOf = (dir: string) => [MATRIX_FILE, POLYLINES_FILE].map((file) => fs.readFileSync(path.join(dir, file), 'utf8'));

describe('ensureLegPolylines', () => {
  it('fetches only the neighbouring pairs with no cached line and writes them to polylines.json', async () => {
    const dir = dirs.seeded();
    const google = fakeGoogle();
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });

    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 3, failed: 0 });

    expect(google.matrixCalls()).toEqual([]);
    expect(google.lineCalls().flatMap((call) => call.pairs).sort()).toEqual([...missingLines].sort());
    expect(google.calls[0].init?.headers?.['X-Goog-Api-Key']).toBe(KEY);
    expect(service.provider!.polyline('biz-b', 'home-001')).toBe(lineFor('biz-b', 'home-001'));
    // biz-a -> home-001 is cached but is not a neighbouring pair of any leg: untouched and not requested.
    const expected = seedFiles().polylines.polylines;
    for (const key of missingLines) expected[key] = lineFor(...(key.split('|') as [string, string]));
    expect(readTravelFiles(dir)!.polylines.polylines).toEqual(expected);

    // A second call finds everything cached.
    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 0, failed: 0 });
    expect(google.calls).toHaveLength(3);
  });

  it('resolves { fetched: 0, failed: 0 } with no request when every line is cached or there are no legs, even without a key', async () => {
    const google = fakeGoogle();
    const service = createTravelService({ dir: dirs.seeded(), key: '', fetch: google.fetch });
    expect(await service.ensureLegPolylines([leg(['home-001', 'biz-a', 'biz-b'])])).toEqual({ fetched: 0, failed: 0 });
    expect(await service.ensureLegPolylines([])).toEqual({ fetched: 0, failed: 0 });
    expect(await service.ensureLegPolylines([leg(['biz-a'])])).toEqual({ fetched: 0, failed: 0 });
    expect(google.calls).toEqual([]);
  });

  it('counts a pair shared by two legs once', async () => {
    const google = fakeGoogle();
    const service = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: google.fetch, sleep: noSleep });
    expect(await service.ensureLegPolylines([leg(['biz-c', 'biz-b', 'home-001']), leg(['biz-a', 'biz-b', 'home-001'])])).toEqual({ fetched: 2, failed: 0 });
    expect(google.calls.flatMap((call) => call.pairs).sort()).toEqual([pairKey('biz-b', 'home-001'), pairKey('biz-c', 'biz-b')]);
  });

  it('resolves { fetched: 0, failed: n } with no request when the key is missing', async () => {
    for (const key of ['', undefined]) {
      const dir = dirs.seeded();
      const before = bytesOf(dir);
      const google = fakeGoogle();
      const service = createTravelService({ dir, key, fetch: google.fetch });
      expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 0, failed: 3 });
      expect(google.calls).toEqual([]);
      expect(service.provider!.polyline('biz-b', 'home-001')).toBeNull(); // the leg stays on the straight line
      expect(bytesOf(dir)).toEqual(before);
    }
  });

  it('resolves { fetched: 0, failed: n } when Google fails, and leaves the files as they were', async () => {
    const dir = dirs.seeded();
    const before = bytesOf(dir);
    const google = fakeGoogle(() => google500);
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 0, failed: 3 });
    expect(google.calls.length).toBeGreaterThan(0);
    expect(bytesOf(dir)).toEqual(before);
    expect(readTravelFiles(dir)).toEqual(seedFiles());
  });

  it('resolves when the network itself throws', async () => {
    const service = createTravelService({
      dir: dirs.seeded(),
      key: KEY,
      fetch: async (url) => {
        throw new Error(`connect ECONNREFUSED ${url}?key=${KEY}`);
      },
      sleep: noSleep,
    });
    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 0, failed: 3 });
  });

  it('keeps the lines fetched before a failure and counts the rest as failed', async () => {
    const dir = dirs.seeded();
    // Sorted fetch order: biz-b|biz-c, biz-b|home-001, home-001|biz-b. The second request and everything after it fail.
    const google = fakeGoogle((_call, index) => (index >= 1 ? google500 : null));
    const service = createTravelService({ dir, key: KEY, fetch: google.fetch, sleep: noSleep });
    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 1, failed: 2 });
    expect(readTravelFiles(dir)!.polylines.polylines[pairKey('biz-b', 'biz-c')]).toBe(lineFor('biz-b', 'biz-c'));
    expect(service.provider!.polyline('biz-b', 'home-001')).toBeNull();
  });

  it('counts a pair Google has no route for as failed and still fetches the others', async () => {
    const google = fakeGoogle((call) => (call.pairs[0] === pairKey('biz-b', 'home-001') ? { status: 200, body: { routes: [] } } : null));
    const service = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: google.fetch, sleep: noSleep });
    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 2, failed: 1 });
    expect(service.provider!.polyline('biz-b', 'home-001')).toBeNull();
    expect(service.provider!.polyline('home-001', 'biz-b')).toBe(lineFor('home-001', 'biz-b'));
  });

  it('counts a pair with an unregistered place as failed without stopping the other legs', async () => {
    const google = fakeGoogle();
    const service = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: google.fetch, sleep: noSleep });
    expect(await service.ensureLegPolylines([leg(['biz-a', 'biz-c', NEW_HOME]), leg(['biz-b', 'biz-c', 'home-001'])])).toEqual({ fetched: 3, failed: 1 });
    expect(google.calls.flatMap((call) => call.pairs).sort()).toEqual([pairKey('biz-a', 'biz-c'), pairKey('biz-b', 'biz-c'), pairKey('biz-c', 'home-001')]);
  });

  it('never rejects: not when the cache cannot be written, not for legs that are not legs', async () => {
    const service = createTravelService({
      dir: dirs.seeded(),
      key: KEY,
      fetch: fakeGoogle().fetch,
      sleep: noSleep,
      persist: () => {
        throw new Error('disk full');
      },
    });
    // The lines are in memory, so the map can draw them, even though they could not be saved.
    expect(await service.ensureLegPolylines(relayLegs)).toEqual({ fetched: 3, failed: 0 });
    expect(service.provider!.polyline('biz-b', 'biz-c')).toBe(lineFor('biz-b', 'biz-c'));
    expect(await service.ensureLegPolylines([null as unknown as Leg])).toEqual({ fetched: 0, failed: 0 });
    expect(await service.ensureLegPolylines(undefined as unknown as Leg[])).toEqual({ fetched: 0, failed: 0 });
  });
});

describe('leaks', () => {
  it('no error and no output of this suite holds the key', async () => {
    // ensureLegPolylines swallows its errors, so look at what Google's failure looks like one level down too.
    const service = createTravelService({ dir: dirs.seeded(), key: KEY, fetch: fakeGoogle(() => google500).fetch, sleep: noSleep });
    await suite.thrownBy(() => service.ensurePolylines([{ from: 'biz-b', to: 'biz-c' }]));
    await suite.thrownBy(() =>
      createTravelService({
        dir: dirs.seeded(),
        key: KEY,
        fetch: async (url) => {
          throw new Error(`connect ECONNREFUSED ${url}?key=${KEY}`);
        },
        sleep: noSleep,
      }).ensurePolylines([{ from: 'biz-b', to: 'biz-c' }]),
    );
    suite.expectNoLeak(2);
  });
});
