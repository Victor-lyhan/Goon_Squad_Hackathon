// GET /api/v2/map starts a background fetch of the route lines its answer lacks (issue #536, DECISIONS
// pass 57). Over HTTP, on the real app with the read routes registered, a store in memory, a travel lookup
// the test can write to and a recording fake of `ensureLegPolylines`. No network beyond localhost, no key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapResponse } from '../../server/api/v2/views';
import type { MapResponse } from '../../shared/v2/api';
import { TravelDataMissingError } from '../../shared/v2/types';
import { sampleRun } from './v2-sample';
import {
  bigRun, fakeEnsure, fakeLine, keyOf, lineTravel, SECRET, type LinesMode, type Pair,
} from './v2-map-lines-helper';
import { startReadApi, wire, type ReadApi } from './v2-read-routes-helper';

const T = 10_000; // every test here talks to a real HTTP server (DECISIONS pass 19)

let api: ReadApi | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await api?.close();
  api = null;
});

// 40 carriers: 80 leg pairs, then 80 commute pairs; 5 employees with no plan: 10 commute pairs never asked for.
const city = bigRun(40, 5);

async function start(mode: LinesMode, cached: Pair[] = []) {
  const { travel, lines } = lineTravel(Object.fromEntries(cached.map((pair) => [keyOf(pair), fakeLine(pair)])));
  const fake = fakeEnsure(lines, mode);
  api = await startReadApi({ travel, run: city.run, ensureLegPolylines: fake.ensureLegPolylines });
  const map = async () => {
    const res = await api!.get('/map');
    expect(res.status).toBe(200);
    return res.body as MapResponse;
  };
  return { travel, lines, fake, map, api };
}

const encodedOf = (map: MapResponse, pairs: Pair[]) =>
  pairs.map(([from, to]) => map.polylines.find((p) => p.from === from && p.to === to)?.encoded);
const missingIn = (map: MapResponse) => map.polylines.filter((p) => p.encoded === null).length;

describe('GET /map fetches the route lines it answered without', () => {
  it('first the plan legs, then the carriers\' commutes; 60 pairs per request, as two-place legs', async () => {
    const { fake, map } = await start('fetch');
    const first = await map();
    expect(first.polylines).toHaveLength(170);
    expect(missingIn(first)).toBe(170); // the answer was built before the fetch started
    expect(fake.calls).toEqual([city.wanted.slice(0, 60)]);
    expect(city.wanted.slice(0, 60)).toEqual(city.legPairs.slice(0, 60));
    expect(fake.shapes).toEqual([Array(60).fill(2)]);
  }, T);

  it('a second request returns the fetched lines encoded and asks for the next 60, until nothing is left', async () => {
    const { fake, map } = await start('fetch');
    await map();

    const second = await map();
    expect(encodedOf(second, city.wanted.slice(0, 60))).toEqual(city.wanted.slice(0, 60).map(fakeLine));
    expect(missingIn(second)).toBe(110);
    expect(fake.calls[1]).toEqual(city.wanted.slice(60, 120)); // the last 20 leg pairs, then 40 commute pairs
    expect(fake.calls[1].slice(0, 20)).toEqual(city.legPairs.slice(60));
    expect(fake.calls[1].slice(20)).toEqual(city.carrierCommutes.slice(0, 40));

    const third = await map();
    expect(missingIn(third)).toBe(50);
    expect(fake.calls[2]).toEqual(city.wanted.slice(120));

    // Every plan leg and every carrier commute has its line; the commutes of the 5 employees with no plan do not.
    const fourth = await map();
    expect(encodedOf(fourth, city.wanted)).toEqual(city.wanted.map(fakeLine));
    expect(encodedOf(fourth, city.idleCommutes)).toEqual(Array(10).fill(null));
    await map();
    expect(fake.calls).toHaveLength(3); // nothing left to ask for: nothing is called
    expect(fake.calls.flat().map(keyOf)).toEqual(city.wanted.map(keyOf));
    expect(fake.shapes.flat().every((places) => places === 2)).toBe(true);
  }, T);

  it('with every line cached nothing is called', async () => {
    const { fake, map } = await start('fetch', [...city.wanted, ...city.idleCommutes]);
    expect(missingIn(await map())).toBe(0);
    await map();
    expect(fake.calls).toEqual([]);
  }, T);

  it('with only the commutes of employees with no plan missing nothing is called', async () => {
    const { fake, map } = await start('fetch', city.wanted);
    expect(missingIn(await map())).toBe(10);
    await map();
    expect(fake.calls).toEqual([]);
  }, T);
});

describe('one fetch at a time', () => {
  it('a map request while a fetch is running starts none, is answered at once, and uses up no try', async () => {
    const { fake, map } = await start('hang');
    const first = await map(); // answered although its fetch never settles
    expect(fake.calls).toHaveLength(1);

    const during = [await map(), await map(), await map()];
    expect(fake.calls).toHaveLength(1);
    for (const body of during) expect(body).toEqual(first);

    await fake.release(); // the fetch ends without a line
    await map();
    expect(fake.calls).toHaveLength(2);
    // The three requests in between counted nothing: the first 60 pairs get their second try now.
    expect(fake.calls[1]).toEqual(city.wanted.slice(0, 60));

    await map(); // the second fetch hangs too
    expect(fake.calls).toHaveLength(2);
    await fake.release();
    await map();
    expect(fake.calls[2]).toEqual(city.wanted.slice(60, 120));
  }, T);
});

describe('a pair is tried at most twice per server run', () => {
  it('pairs that never get a line are passed twice, then the next pairs get their turn, then nothing is called', async () => {
    const { fake, map } = await start('fail');
    for (let i = 0; i < 9; i++) expect(missingIn(await map())).toBe(170);
    expect(fake.calls).toEqual([
      city.wanted.slice(0, 60), city.wanted.slice(0, 60),
      city.wanted.slice(60, 120), city.wanted.slice(60, 120),
      city.wanted.slice(120), city.wanted.slice(120),
    ]);
    const tries = new Map<string, number>();
    for (const pair of fake.calls.flat()) tries.set(keyOf(pair), (tries.get(keyOf(pair)) ?? 0) + 1);
    expect([...tries.values()].every((count) => count === 2)).toBe(true);
    expect(tries.size).toBe(160);
  }, T);

  it('the count is per pair: a new plan\'s pairs are still fetched after others ran out, also for a new run', async () => {
    const { fake, map, api } = await start('fail');
    for (let i = 0; i < 7; i++) await map();
    expect(fake.calls).toHaveLength(6);

    // A re-match gives carrier 1 another stop: two new leg pairs. The old pairs stay used up.
    const [plan, ...rest] = city.run.assignments.plans;
    const moved = { ...plan, legs: [{ ...plan.legs[0], placeIds: ['biz-studio', 'biz-new', 'home-001'] }] };
    api.setRun({ ...city.run, runId: 'run-rematched', assignments: { ...city.run.assignments, plans: [moved, ...rest] } });
    fake.setMode('fetch');
    const before = await map();
    expect(before.runId).toBe('run-rematched');
    expect(fake.calls[6]).toEqual([['biz-studio', 'biz-new'], ['biz-new', 'home-001']]);
    const after = await map();
    expect(encodedOf(after, fake.calls[6])).toEqual(fake.calls[6].map(fakeLine));
    expect(fake.calls).toHaveLength(7);
  }, T);
});

describe('the fetch never delays or fails the map answer', () => {
  it.each(['reject', 'throw'] as const)('a fetch that %ss: 200 with the same body, nothing logged, and the next request may fetch', async (mode) => {
    const logged: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
    }
    const { fake, travel } = await start(mode);
    const first = await api!.get('/map');
    const second = await api!.get('/map');
    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(wire(mapResponse(city.run, travel)));
      expect(res.text).not.toContain(SECRET);
    }
    expect(fake.calls).toHaveLength(2);
    expect(logged).toEqual([]);
  }, T);

  it('the answer is the pure view of the run, byte for byte the answer of a server without the function', async () => {
    const { travel } = await start('fail');
    const withFetch = await api!.get('/map');
    const plain = await startReadApi({ travel, run: city.run });
    try {
      const without = await plain.get('/map');
      expect(without.status).toBe(200);
      expect(withFetch.text).toBe(without.text);
      expect(withFetch.body).toEqual(wire(mapResponse(city.run, travel)));
    } finally {
      await plain.close();
    }
  }, T);

  it('only GET /map fetches, and no request changes the run', async () => {
    const { fake, api } = await start('fetch');
    for (const url of ['/businesses', '/employees', '/simulator', '/employees/emp-1/dashboard', '/map/', '/nowhere']) await api.get(url);
    // `/map/` is the same route in Express; nothing else calls the function.
    expect(fake.calls).toHaveLength(1);
    await api.get('/map');
    expect(fake.calls).toHaveLength(2);
    expect(api.store.get()).toBe(city.run);
    expect(api.mutations()).toBe(0);
  }, T);

  it('a map that cannot be built is the documented 503 and starts no fetch', async () => {
    const fake = fakeEnsure({}, 'fetch');
    api = await startReadApi({
      run: sampleRun,
      ensureLegPolylines: fake.ensureLegPolylines,
      travel: {
        durationMin: (from, to) => { throw new TravelDataMissingError(from, to); },
        distanceM: (from, to) => { throw new TravelDataMissingError(from, to); },
        polyline: (from, to) => { throw new TravelDataMissingError(from, to, 'polyline'); },
      },
    });
    const res = await api.get('/map');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('travel_data_missing');
    expect(fake.calls).toEqual([]);
  }, T);
});
