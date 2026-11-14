// The v2 runtime's moving parts (server/api/v2/bootstrap.ts) on the sample cache in a temp folder:
// the ticker starts only when asked, the shutdown pauses and saves once, a restart resumes paused, and
// with a key the live fetches of a commute save, a new delivery and the address search go through the
// injected fetch and are visible at once. The fetch is a fake: no network, no real key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { shutdown } from '../../server/index';
import { MATRIX_FILE, POLYLINES_FILE } from '../../server/geo/cache';
import { pairKey, type Run as RunV2 } from '../../shared/v2/types';
import {
  FAKE_KEY, GEOCODED, fakeGoogle, startBootstrapApi, T, tempRepo, type BootstrapApi, type TempRepo,
} from './v2-bootstrap-helper';

let api: BootstrapApi | null = null;
let repo: TempRepo | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
  repo?.remove();
  repo = null;
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const noTicker = { stop: () => undefined };

describe('v2 runtime: ticker and shutdown', () => {
  it('the clock moves only after startTicker; shutdown stops it, pauses and saves; a restart resumes paused', async () => {
    repo = tempRepo('sample');
    api = await startBootstrapApi({ cache: 'sample', repo });
    const start = api.store!.get().clock.timeMin;

    const played = await api.v2.post('/simulator/control', { action: 'play' });
    expect(played.body.clock).toMatchObject({ playing: true, phase: 'locked' });
    await wait(30);
    expect(api.store!.get().clock.timeMin).toBe(start); // createV2Runtime alone starts no timer

    let t = 0;
    api.runtime.startTicker({ intervalMs: 5, now: () => (t += 1000) });
    api.runtime.startTicker({ intervalMs: 5, now: () => (t += 1000) }); // a second call starts no second timer
    await vi.waitFor(() => expect(api!.store!.get().clock.timeMin).toBeGreaterThan(start), { timeout: 5_000, interval: 5 });
    const moving = (await api.v2.get('/simulator')).body;
    expect(moving.clock.timeMin).toBeGreaterThan(start);

    // What Ctrl-C runs in server/index.ts: MVP 1 and the v2 runtime together.
    await shutdown(api.mvp1Store, noTicker, api.runtime);
    const stopped = api.store!.get();
    expect(stopped.clock.playing).toBe(false);
    expect(stopped.clock.timeMin).toBeGreaterThanOrEqual(moving.clock.timeMin);
    expect(api.mvp1Store.get().clock.playing).toBe(false);
    expect(fs.existsSync(api.repo.mvp1StatePath)).toBe(true);
    await wait(30); // the ticker is really stopped
    expect(api.store!.get().version).toBe(stopped.version);
    expect(await api.savedRun()).toStrictEqual(JSON.parse(JSON.stringify(stopped)));

    api.runtime.startTicker({ intervalMs: 5 }); // not after a shutdown
    await api.close();

    // A new process on the same folders.
    api = await startBootstrapApi({ cache: 'sample', repo });
    expect(api.runtime.status).toBe('ready');
    const resumed = (await api.v2.get('/simulator')).body;
    expect(resumed.runId).toBe(stopped.runId);
    expect(resumed.version).toBe(stopped.version);
    expect(resumed.clock).toStrictEqual({ ...stopped.clock, playing: false });
    expect(resumed.clock.phase).toBe('locked');
  }, T);

  it('shutdown writes the state file exactly once, also when nothing happened', async () => {
    api = await startBootstrapApi({ cache: 'sample' });
    expect(fs.existsSync(api.repo.statePath)).toBe(false);
    const before = api.store!.get().version;

    const firstCall = api.runtime.shutdown();
    expect(api.runtime.shutdown()).toBe(firstCall); // Ctrl-C twice: one save
    await firstCall;
    await api.runtime.shutdown();

    expect(api.store!.get().version).toBe(before + 1);
    const saved = await api.savedRun();
    expect(saved?.version).toBe(before + 1);
    expect(saved?.clock.playing).toBe(false);
    expect(fs.readdirSync(path.dirname(api.repo.statePath))).toStrictEqual(['state-v2.json']);
  }, T);

  it('the MVP 1 state is saved even when the v2 save fails, and the failure is reported', async () => {
    api = await startBootstrapApi({ cache: 'sample' });
    const failing = { shutdown: () => Promise.reject(new Error('disk full')) };
    await expect(shutdown(api.mvp1Store, noTicker, failing)).rejects.toThrow('disk full');
    expect(JSON.parse(fs.readFileSync(api.repo.mvp1StatePath, 'utf8')).run.clock.playing).toBe(false);
  }, T);
});

describe('v2 runtime with a key: live fetches go through the travel service and are visible at once', () => {
  it('a commute save with a new home, a new delivery and the address search', async () => {
    const logged: unknown[][] = [];
    for (const method of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
    }
    const google = fakeGoogle();
    api = await startBootstrapApi({ cache: 'sample', key: FAKE_KEY, fetch: google.fetch });
    const bodies: unknown[] = [];
    const run = (): RunV2 => api!.store!.get();
    expect(google.urls).toStrictEqual([]); // starting from the cache needs no request

    // --- the address search: Google's result has no neighborhood, so the name comes from neighborhoods.json
    const search = await api.v2.get(`/geocode?q=${encodeURIComponent('30-01 Example St')}`);
    bodies.push(search.body);
    expect(search.status).toBe(200);
    expect(search.body).toStrictEqual({ results: [{ ...GEOCODED, neighborhood: 'Astoria' }] });
    expect(google.geocodeCalls()).toBe(1);

    // --- a commute save with that new home: its pairs and the two commute lines are fetched before the answer
    const employee = run().scenario.employees[0];
    const businessCount = run().scenario.businesses.length;
    const commute = await api.v2.put(`/employees/${employee.id}/commute`, {
      businessId: employee.businessId,
      home: { lat: GEOCODED.lat, lng: GEOCODED.lng, neighborhood: 'Astoria' },
      eveningDepartureMin: employee.eveningDepartureMin,
      morningDepartureMin: employee.morningDepartureMin,
      availableEvening: true,
      availableMorning: true,
      maxExtraMin: employee.maxExtraMin,
    });
    bodies.push(commute.body);
    expect(commute.status).toBe(200);
    const homeId: string = commute.body.home.id;
    expect(homeId).toMatch(/^home-c-/);
    expect(google.matrixCalls()).toBeGreaterThan(0);
    expect(google.lineCalls()).toBe(2);
    // The trips use Google's (fake) answer of 900 s = 15 min, read through the same provider the service wrote to.
    expect(commute.body.trips.map((trip: any) => trip.baselineDurationMin)).toStrictEqual([15, 15]);

    // The very next read sees the new home, its route lines and its matrix pairs.
    const map = (await api.v2.get('/map')).body;
    bodies.push(map);
    expect(map.homes.map((home: any) => home.id)).toContain(homeId);
    const line = (from: string, to: string) =>
      map.polylines.find((p: any) => p.from === from && p.to === to)?.encoded ?? null;
    expect(line(employee.businessId, homeId)).toEqual(expect.any(String));
    expect(line(homeId, employee.businessId)).toEqual(expect.any(String));
    expect((await api.v2.get('/simulator')).status).toBe(200);

    // The answers were written back to the cache files (SPEC MVP II rule 3).
    const matrix = JSON.parse(fs.readFileSync(path.join(api.repo.fixturesDir, MATRIX_FILE), 'utf8'));
    expect(matrix.places[homeId]).toStrictEqual({ lat: GEOCODED.lat, lng: GEOCODED.lng });
    const homePairs = Object.keys(matrix.pairs).filter((key) => key.split('|').includes(homeId));
    expect(homePairs).toHaveLength(businessCount * 2);

    // Generate knows the new home's place at once (`generateInputs.places` is the cache's own table),
    // and an export / import round trip is accepted because `travelPairs` reads the same cache.
    const exported = (await api.v2.get('/scenario/export')).body;
    expect((await api.v2.post('/scenario/import', exported)).status).toBe(200);

    // --- a new delivery: answered first, its route lines fetched after the response
    const linesBefore = google.lineCalls();
    const { businesses } = run().scenario;
    let created: Record<string, any> | null = null;
    for (let i = 1; i < 4 && !created; i++) {
      const res = await api.v2.post('/shipments', {
        clientRequestId: `runtime-${i}`,
        originBusinessId: businesses[0].id,
        destinationBusinessId: businesses[i].id,
        label: 'Late proofs', category: 'envelope', description: 'Printed proofs', weightKg: 0.3,
        readyMin: run().scenario.settings.simStartMin + 30,
        deadlineMin: run().scenario.settings.simEndMin - 120,
      });
      bodies.push(res.body);
      expect(res.status).toBe(201);
      if (res.body.matched) created = res.body;
    }
    expect(created).not.toBeNull();
    const legPairs: [string, string][] = created!.plan.legs.flatMap((leg: { placeIds: string[] }) =>
      leg.placeIds.slice(1).map((to, i): [string, string] => [leg.placeIds[i], to]));
    const travel = api.runtime.deps.travel!;
    await vi.waitFor(() => {
      for (const [from, to] of legPairs) expect(travel.polyline(from, to)).toEqual(expect.any(String));
    }, { timeout: 5_000, interval: 10 });
    expect(google.lineCalls()).toBeGreaterThan(linesBefore);
    const mapAfter = (await api.v2.get('/map')).body;
    for (const [from, to] of legPairs) {
      expect(mapAfter.polylines.find((p: any) => p.from === from && p.to === to)?.encoded).toEqual(expect.any(String));
    }
    const polylines = JSON.parse(fs.readFileSync(path.join(api.repo.fixturesDir, POLYLINES_FILE), 'utf8'));
    for (const [from, to] of legPairs) expect(Object.hasOwn(polylines.polylines, pairKey(from, to))).toBe(true);

    // --- the key went to Google only: it is in no response body, no log line and no file the server wrote
    await api.runtime.shutdown();
    const written = [api.repo.statePath, path.join(api.repo.fixturesDir, MATRIX_FILE), path.join(api.repo.fixturesDir, POLYLINES_FILE)]
      .map((file) => fs.readFileSync(file, 'utf8'));
    for (const text of [JSON.stringify(bodies), JSON.stringify(logged), ...written]) expect(text).not.toContain(FAKE_KEY);
  }, T);

  it('without a key the same new home is refused with the documented 503 and the run stays', async () => {
    const google = fakeGoogle();
    api = await startBootstrapApi({ cache: 'sample', key: '   ', fetch: google.fetch });
    const before = api.store!.get();
    const employee = before.scenario.employees[0];
    const commute = await api.v2.put(`/employees/${employee.id}/commute`, {
      businessId: employee.businessId,
      home: { lat: GEOCODED.lat, lng: GEOCODED.lng, neighborhood: 'Astoria' },
      eveningDepartureMin: employee.eveningDepartureMin,
      morningDepartureMin: employee.morningDepartureMin,
      availableEvening: true,
      availableMorning: true,
      maxExtraMin: employee.maxExtraMin,
    });
    expect(commute.status).toBe(503);
    expect(commute.body.code).toBe('google_key_missing');
    expect(api.store!.get()).toBe(before);
    expect(google.urls).toStrictEqual([]); // nothing is asked of Google without a key, and nothing is estimated
    expect(fs.existsSync(api.repo.statePath)).toBe(false);
  }, T);
});
