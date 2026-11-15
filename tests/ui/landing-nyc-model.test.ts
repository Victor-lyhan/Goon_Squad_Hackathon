import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  NYC_RETRY_DELAYS_MS, NYC_RETRY_EVERY_MS, nycRetryDelayMs, nycSummaryFrom, nycWorkspacePaths, startNycSummary,
  watchPackageHref, type NycSummary,
} from '../../client/src/pages/landingModel';
import { businesses, employees, simulator, storySimulator, travelMissingBody } from './landing-nyc-sample';

const BODIES: Record<string, unknown> = {
  '/api/v2/businesses': businesses, '/api/v2/employees': employees, '/api/v2/simulator': simulator,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => { calls.push({ url, init }); return answer(url, init); }));
  return calls;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const until = async (f: () => boolean) => { for (let i = 0; i < 50 && !f(); i++) await settle(); };

// Every started summary is stopped after its test: a failed load now retries on a timer (#610).
const stops: (() => void)[] = [];
const start = (...args: Parameters<typeof startNycSummary>) => {
  const stop = startNycSummary(...args);
  stops.push(stop);
  return stop;
};

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startNycSummary', () => {
  it('requests only the three /api/v2 reads (never an MVP 1 path) and reports the account IDs, no count (#843)', async () => {
    const calls = stubFetch(async (url) => json(BODIES[url]));
    const seen: NycSummary[] = [];
    start((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(calls.map((c) => c.url).sort()).toEqual(['/api/v2/businesses', '/api/v2/employees', '/api/v2/simulator']);
    for (const c of calls) { expect(c.url.startsWith('/api/v2/')).toBe(true); expect(c.init.method).toBe('GET'); }
    expect(seen).toEqual([{
      status: 'ready',
      businessIds: businesses.businesses.map((b) => b.id), employeeIds: employees.employees.map((e) => e.id),
      watchPackageId: null, // the sample run has no plans
    }]);
    // The sample's metrics (19 of 24) and list sizes reach the model nowhere: only IDs and the package.
    expect(Object.keys(seen[0]).sort()).toEqual(['businessIds', 'employeeIds', 'status', 'watchPackageId']);
    expect(Object.values(seen[0]).filter((v) => typeof v === 'number')).toEqual([]);
    expect(seen[0].status === 'ready' && seen[0].employeeIds[0]).toBe('emp-7');
    expect(nycWorkspacePaths(seen[0])).toEqual({
      business: `/business/${businesses.businesses[0].id}`, employee: '/employee/emp-7', simulator: '/simulator',
    });
  });

  it('carries the package "Watch a package" opens, picked from the simulator answer (#652)', async () => {
    stubFetch(async (url) => json(url === '/api/v2/simulator' ? storySimulator : BODIES[url]));
    const seen: NycSummary[] = [];
    start((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(seen[0]).toMatchObject({ status: 'ready', watchPackageId: 'shp-3' });
    expect(watchPackageHref(seen[0])).toBe('/simulator?package=shp-3&play=1');
  });

  it('503 travel_data_missing gives the unavailable state', async () => {
    stubFetch(async (url) => (url === '/api/v2/simulator' ? json(travelMissingBody, 503) : json(BODIES[url])));
    const seen: NycSummary[] = [];
    start((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(seen).toEqual([{ status: 'unavailable' }]);
    expect(nycWorkspacePaths(seen[0])).toEqual({ business: null, employee: null, simulator: '/simulator' });
  });

  it('a 503 without a travel code is a plain error', async () => {
    stubFetch(async () => json({ error: 'busy' }, 503));
    const seen: NycSummary[] = [];
    start((s) => seen.push(s));
    await until(() => seen.length > 0);
    expect(seen).toEqual([{ status: 'error' }]);
  });

  it('the cleanup aborts all three requests and nothing is reported afterwards', async () => {
    const calls = stubFetch((_url, init) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
    }));
    const seen: NycSummary[] = [];
    const stop = start((s) => seen.push(s));
    await settle();
    expect(calls).toHaveLength(3);
    stop();
    await settle(); await settle();
    for (const c of calls) expect(c.init.signal!.aborted).toBe(true);
    expect(seen).toEqual([]);
  });

  it('a late answer after the cleanup is ignored', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch(async (url) => { await gate; return json(BODIES[url]); });
    const seen: NycSummary[] = [];
    const stop = start((s) => seen.push(s));
    stop();
    release();
    await settle(); await settle();
    expect(seen).toEqual([]);
  });
});

describe('the model carries no count of the run (#843, PR #840 review note)', () => {
  it('nycSummaryFrom keeps the account IDs and the package only, whatever the metrics say', () => {
    const ready = nycSummaryFrom(businesses, employees, storySimulator);
    expect(ready).toEqual({
      status: 'ready',
      businessIds: ['biz-a', 'biz-b', 'biz-c', 'biz-d', 'biz-e'], employeeIds: ['emp-7', 'emp-1', 'emp-2'],
      watchPackageId: 'shp-3',
    });
    // An answer without `snapshot` gives the same model: the metrics are not read.
    const { shipments, plans } = storySimulator;
    expect(nycSummaryFrom(businesses, employees, { shipments, plans })).toEqual(ready);
  });

  it('landingModel.ts names no business, commuter or matched count and does not read the metrics', () => {
    const source = readFileSync(resolve(__dirname, '../../client/src/pages/landingModel.ts'), 'utf8');
    expect(source).not.toMatch(/matched|commuters|requested:|metrics\.|snapshot|\.length/);
  });
});

describe('startNycSummary asks again after a failed load (#610)', () => {
  const ready = nycSummaryFrom(businesses, employees, simulator);
  const down = () => new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
  const travelMissing = () => new ApiRequestError(503, 'Travel data is not loaded', undefined, 'http', 'travel_data_missing');

  /** Fake /api/v2 reads: load n (from 0) fails with `failures[n]`; a load past the list succeeds. */
  function reads(failures: unknown[]) {
    const loads: AbortSignal[][] = [];
    const read = <T,>(body: T) => (o?: { signal?: AbortSignal }) => {
      if (loads.length === 0 || loads[loads.length - 1].length === 3) loads.push([]);
      const n = loads.length - 1;
      loads[n].push(o!.signal!);
      return n < failures.length ? Promise.reject(failures[n]) : Promise.resolve(body);
    };
    return { loads, api: { getBusinesses: read(businesses), getEmployees: read(employees), getSimulator: read(simulator) } };
  }
  const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('the waits are 1 s, 2 s, 4 s, then 5 s for every later failure', () => {
    expect([1, 2, 3, 4, 5, 50].map(nycRetryDelayMs)).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
    expect(NYC_RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
    expect(NYC_RETRY_EVERY_MS).toBe(5000);
  });

  it('the first load rejects, the second resolves: error, then ready after 1 s, and no further request', async () => {
    fakeTimers();
    const { loads, api } = reads([down()]);
    const seen: NycSummary[] = [];
    start((s) => seen.push(s), api);
    await advance(0);
    expect(seen).toEqual([{ status: 'error' }]);
    expect(nycWorkspacePaths(seen[0])).toEqual({ business: null, employee: null, simulator: '/simulator' });
    await advance(999);
    expect(loads).toHaveLength(1);
    await advance(1);
    expect(loads).toHaveLength(2);
    expect(seen).toEqual([{ status: 'error' }, ready]);
    expect(nycWorkspacePaths(seen[1])).toEqual({
      business: `/business/${businesses.businesses[0].id}`, employee: '/employee/emp-7', simulator: '/simulator',
    });
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(loads).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it('a 503 then a success: unavailable, then ready', async () => {
    fakeTimers();
    const { loads, api } = reads([travelMissing()]);
    const seen: NycSummary[] = [];
    start((s) => seen.push(s), api);
    await advance(0);
    expect(seen).toEqual([{ status: 'unavailable' }]);
    await advance(1000);
    expect(seen).toEqual([{ status: 'unavailable' }, ready]);
    expect(loads).toHaveLength(2);
  });

  it('keeps asking at 1 s, 2 s, 4 s, then every 5 s, and reports the same failure once', async () => {
    fakeTimers();
    const { loads, api } = reads(Array.from({ length: 7 }, down));
    const seen: NycSummary[] = [];
    start((s) => seen.push(s), api);
    await advance(0);
    const startedAfter: number[] = [];
    for (const wait of [1000, 2000, 4000, 5000, 5000, 5000]) {
      await advance(wait - 1);
      startedAfter.push(loads.length);
      await advance(1);
      startedAfter.push(loads.length);
    }
    expect(startedAfter).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);
    expect(seen).toEqual([{ status: 'error' }]);
    await advance(5000); // the 8th load succeeds
    expect(seen).toEqual([{ status: 'error' }, ready]);
  });

  it('reports a change of the failure: 503, then a plain error, then ready', async () => {
    fakeTimers();
    const { api } = reads([travelMissing(), travelMissing(), down()]);
    const seen: NycSummary[] = [];
    start((s) => seen.push(s), api);
    await advance(1000 + 2000 + 4000);
    expect(seen).toEqual([{ status: 'unavailable' }, { status: 'error' }, ready]);
  });

  it('a failed load aborts its own open requests; the next load gets a fresh signal', async () => {
    fakeTimers();
    const { loads, api } = reads([down()]);
    start(() => {}, api);
    await advance(0);
    expect(loads[0].map((s) => s.aborted)).toEqual([true, true, true]);
    await advance(1000);
    expect(loads[1].map((s) => s.aborted)).toEqual([false, false, false]);
  });

  it('the cleanup during the wait drops the timer: no further request, nothing reported', async () => {
    fakeTimers();
    const { loads, api } = reads([down(), down()]);
    const seen: NycSummary[] = [];
    const stop = start((s) => seen.push(s), api);
    await advance(500);
    expect(seen).toEqual([{ status: 'error' }]);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(loads).toHaveLength(1);
    expect(seen).toEqual([{ status: 'error' }]);
  });

  it('the cleanup during a retry aborts its requests; a late answer or failure is not reported and starts no timer', async () => {
    fakeTimers();
    for (const late of ['answer', 'failure'] as const) {
      const signals: AbortSignal[] = [];
      let n = 0;
      let settleRetry!: () => void;
      const read = <T,>(body: T) => (o?: { signal?: AbortSignal }) => {
        signals.push(o!.signal!);
        if (n++ < 3) return Promise.reject(down());
        return new Promise<T>((res, rej) => { settleRetry = () => (late === 'answer' ? res(body) : rej(down())); });
      };
      const seen: NycSummary[] = [];
      const stop = start((s) => seen.push(s), {
        getBusinesses: read(businesses), getEmployees: read(employees), getSimulator: read(simulator),
      });
      await advance(1000);
      expect(signals).toHaveLength(6);
      expect(signals.slice(3).map((s) => s.aborted)).toEqual([false, false, false]);
      stop();
      expect(signals.slice(3).map((s) => s.aborted)).toEqual([true, true, true]);
      settleRetry();
      await advance(60_000);
      expect(seen, late).toEqual([{ status: 'error' }]);
      expect(signals, late).toHaveLength(6);
      expect(vi.getTimerCount(), late).toBe(0);
    }
  });

  it('through fetch: the API is down, then back; six GETs under /api/v2 and the states error, ready', async () => {
    fakeTimers();
    let up = false;
    const calls = stubFetch(async (url) => { if (!up) throw new TypeError('Failed to fetch'); return json(BODIES[url]); });
    const seen: NycSummary[] = [];
    start((s) => seen.push(s));
    for (let i = 0; i < 20 && seen.length < 1; i++) await advance(0);
    expect(seen).toEqual([{ status: 'error' }]);
    up = true;
    await advance(1000);
    for (let i = 0; i < 20 && seen.length < 2; i++) await advance(0);
    expect(seen).toEqual([{ status: 'error' }, ready]);
    expect(calls.map((c) => c.url).sort()).toEqual([
      '/api/v2/businesses', '/api/v2/businesses', '/api/v2/employees', '/api/v2/employees',
      '/api/v2/simulator', '/api/v2/simulator',
    ]);
  });
});
