// The map's route-line fetch on the real runtime (server/api/v2/bootstrap.ts, issue #536): `createV2Runtime`
// with the real travel service on the sample cache in a temp folder. That cache holds every travel pair and
// NO route line, like a run made by Random city or an import. Google is a fake `fetch`: no network, no real
// key, and nothing is written to fixtures/nyc or data/ (DECISIONS pass 56).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAP_LINE_PAIRS_PER_REQUEST, missingLinePairs } from '../../server/api/v2/mapLines';
import { POLYLINES_FILE } from '../../server/geo/cache';
import type { MapResponse } from '../../shared/v2/api';
import { pairKey, type Run as RunV2 } from '../../shared/v2/types';
import { FAKE_KEY, fakeGoogle, noNetwork, startBootstrapApi, T, type BootstrapApi } from './v2-bootstrap-helper';

let api: BootstrapApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const keysOf = (pairs: { from: string; to: string }[]) => pairs.map(({ from, to }) => pairKey(from, to));
const missingKeys = (map: MapResponse) => keysOf(map.polylines.filter((p) => p.encoded === null));
const linesOnDisk = (a: BootstrapApi): Record<string, string> => {
  const file = path.join(a.repo.fixturesDir, POLYLINES_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).polylines : {};
};

describe('GET /api/v2/map on the runtime, travel cache without route lines', () => {
  it.each([['no key', null], ['a blank key', '   ']])('with %s nothing is fetched and the answer does not change', async (_name, key) => {
    const network = noNetwork();
    api = await startBootstrapApi({ cache: 'sample', key, fetch: network.fetch });
    const first = await api.v2.get('/map');
    await wait(30);
    const second = await api.v2.get('/map');
    expect(first.status).toBe(200);
    expect(second.body).toStrictEqual(first.body);
    expect(first.body.polylines.length).toBeGreaterThan(0);
    expect(first.body.polylines.every((p: any) => p.encoded === null)).toBe(true);
    expect(network.calls).toEqual([]);
    expect(linesOnDisk(api)).toEqual({});
  }, T);

  it('with a key: 60 lines per map request, plan legs first; later requests return them and fetch the rest', async () => {
    const logged: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
    }
    const google = fakeGoogle();
    api = await startBootstrapApi({ cache: 'sample', key: FAKE_KEY, fetch: google.fetch });
    const run = (): RunV2 => api!.store!.get();
    const bodies: unknown[] = [];
    const map = async (): Promise<MapResponse> => {
      const res = await api!.v2.get('/map');
      expect(res.status).toBe(200);
      bodies.push(res.body);
      return res.body as unknown as MapResponse;
    };

    // --- the default run: the answer comes first, with no line; then exactly the first 60 pairs are fetched
    const first = await map();
    const wanted = keysOf(missingLinePairs(run(), first.polylines));
    expect(wanted.length).toBeGreaterThan(MAP_LINE_PAIRS_PER_REQUEST); // so the cap is really at work here
    expect(missingKeys(first)).toHaveLength(first.polylines.length);
    await vi.waitFor(() => expect(Object.keys(linesOnDisk(api!)).sort()).toEqual(wanted.slice(0, 60).sort()), { timeout: 5_000, interval: 10 });
    await wait(30);
    expect(google.lineCalls()).toBe(60); // no request without a map request
    expect(google.urls).toHaveLength(60); // route lines only: no matrix call, no address search

    // --- the page's refetches (#528) pick the lines up and start the next 60, until the map lacks none it needs
    const second = await map();
    expect(missingKeys(second)).not.toEqual(expect.arrayContaining(wanted.slice(0, 60)));
    let last = second;
    await vi.waitFor(async () => {
      last = await map();
      expect(missingLinePairs(run(), last.polylines)).toEqual([]);
    }, { timeout: 10_000, interval: 10 });
    expect(google.lineCalls()).toBe(wanted.length); // every pair once
    const plans = run().assignments.plans;
    const carriers = new Set(plans.flatMap((plan) => plan.legs.map((leg) => leg.employeeId)));
    const legKeys = plans.flatMap((plan) => plan.legs.flatMap((leg) => leg.placeIds.slice(1).map((to, i) => pairKey(leg.placeIds[i], to))));
    expect(legKeys.length).toBeGreaterThan(0);
    expect(missingKeys(last)).not.toEqual(expect.arrayContaining(legKeys));
    // What is still missing are only commutes of employees who carry nothing; they are never fetched.
    const idleCommutes = keysOf(run().trips.filter((t) => !carriers.has(t.employeeId)).map((t) => ({ from: t.originPlaceId, to: t.destinationPlaceId })));
    expect(idleCommutes.length).toBeGreaterThan(0);
    expect([...new Set(missingKeys(last))].sort()).toEqual([...new Set(idleCommutes)].filter((key) => !legKeys.includes(key)).sort());
    await map();
    await wait(30);
    expect(google.lineCalls()).toBe(wanted.length); // nothing left: no call

    // --- Random city: a new run with other plans gets its lines the same way, with no write route involved
    const before = google.lineCalls();
    const generated = await api.v2.post('/scenario/generate', { preset: 'random', seed: 5, employees: 40, packages: 20 });
    expect(generated.status).toBe(200);
    expect(generated.body.plans.length).toBeGreaterThan(0);
    await wait(30);
    expect(google.lineCalls()).toBe(before); // Generate itself fetches no line
    const city = await map();
    expect(city.runId).toBe(generated.body.runId);
    const cityWanted = keysOf(missingLinePairs(run(), city.polylines));
    expect(cityWanted.length).toBeGreaterThan(0);
    await vi.waitFor(async () => {
      expect(missingLinePairs(run(), (await map()).polylines)).toEqual([]);
    }, { timeout: 10_000, interval: 10 });
    expect(google.lineCalls()).toBe(before + cityWanted.length);
    expect(Object.keys(linesOnDisk(api))).toEqual(expect.arrayContaining(cityWanted));
    expect(google.matrixCalls()).toBe(0);

    // --- the key went to Google only
    for (const text of [JSON.stringify(bodies), JSON.stringify(logged), JSON.stringify(linesOnDisk(api))]) expect(text).not.toContain(FAKE_KEY);
    expect(logged).toEqual([]);
  }, T);
});
