// #636 (DECISIONS pass 62): the header's list loaders in client/src/ui/shell.ts ask again every 3 s after
// `error` or `unavailable` until the list is ready, then stop. One request at a time, the same failure is
// reported once, and the cleanup aborts the request in flight and clears the timer. Fake timers, no DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, isTravelUnavailable } from '../../client/src/api/v2';
import {
  DIRECTORY_RETRY_MS, startV2BusinessDirectory, startV2Directory, startV2DirectoryWithEmployers,
  type V2BusinessDirectory, type V2Directory,
} from '../../client/src/ui/shell';

const EMPLOYEES = [
  { id: 'emp-01', name: 'Maya Chen', businessId: 'biz-01' },
  { id: 'emp-02', name: 'Luis Ortega', businessId: 'biz-02' },
];
const PLAIN = EMPLOYEES.map(({ id, name }) => ({ id, name }));
const BUSINESSES = [
  { id: 'biz-01', name: 'Brooklyn Roasters' },
  { id: 'biz-02', name: 'Hudson Print Co' },
];
const READY: V2Directory = { status: 'ready', employees: PLAIN };

const down = () => new Error('Failed to fetch');
const travelMissing = () =>
  new ApiRequestError(503, 'NYC travel data is not loaded on this server yet.', undefined, 'http', 'travel_data_missing');

/** A script step that rejects with something that is not an Error. */
class Rejects { constructor(readonly reason: unknown) {} }

type Call = { signal: AbortSignal; resolve: (body: unknown) => void; reject: (err: unknown) => void };

/**
 * A fetcher for the loaders. `script` gives the outcome of each call in order: an Error (or a Rejects)
 * rejects, 'pending' stays open until the test settles it through `calls[n]`, anything else is the answer;
 * calls after the script get `body`. Records every call's signal and how many requests were open at the
 * same time.
 */
function fetcher<T>(body: T, script: unknown[] = []) {
  const calls: Call[] = [];
  let open = 0;
  let maxOpen = 0;
  const fetch = (opts: { signal: AbortSignal }): Promise<T> => {
    const n = calls.length;
    open += 1;
    maxOpen = Math.max(maxOpen, open);
    const p = new Promise<T>((resolve, reject) => {
      calls.push({ signal: opts.signal, resolve: resolve as (b: unknown) => void, reject });
      const step = script[n];
      if (n >= script.length) resolve(body);
      else if (step instanceof Error) reject(step);
      else if (step instanceof Rejects) reject(step.reason);
      else if (step !== 'pending') resolve(step as T);
    });
    const closed = () => { open -= 1; };
    p.then(closed, closed);
    return p;
  };
  return { fetch, calls, maxOpen: () => maxOpen };
}

const employeesApi = (script: unknown[] = []) => fetcher({ employees: EMPLOYEES }, script);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('a header list loads again after a failed load (#636)', () => {
  it('the wait between two tries is 3 s', () => {
    expect(DIRECTORY_RETRY_MS).toBe(3000);
  });

  it('a load that fails once and then answers: error, then ready 3 s later, and no further request', async () => {
    const api = employeesApi([down()]);
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    expect(api.calls).toHaveLength(1); // the first request starts at once, as before
    await advance(0);
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }]);
    await advance(2999);
    expect(api.calls).toHaveLength(1);
    await advance(1);
    expect(api.calls).toHaveLength(2);
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }, READY]);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(api.calls).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it('a 503 and then a 200: unavailable, then ready', async () => {
    const api = employeesApi([travelMissing()]);
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(0);
    expect(seen).toEqual([{ status: 'unavailable' }]);
    await advance(3000);
    expect(seen).toEqual([{ status: 'unavailable' }, READY]);
    expect(api.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a list that answers at once is loaded once and leaves no timer', async () => {
    const api = employeesApi();
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(0);
    expect(seen).toEqual([READY]);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(api.calls).toHaveLength(1);
  });

  it('keeps asking every 3 s while the API is down and reports the same failure once', async () => {
    const api = employeesApi(Array.from({ length: 6 }, down));
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(0);
    const started: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await advance(2999);
      started.push(api.calls.length);
      await advance(1);
      started.push(api.calls.length);
    }
    expect(started).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }]);
    await advance(3000); // the 7th load answers
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }, READY]);
    expect(api.maxOpen()).toBe(1);
  });

  it('a failure that differs from the last one is reported: error, unavailable, another error, ready', async () => {
    const api = employeesApi([
      down(), down(), travelMissing(), travelMissing(), new Error('Request timed out'), new Rejects('a string'), down(),
    ]);
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(3000 * 6);
    expect(api.calls).toHaveLength(7);
    expect(seen).toEqual([
      { status: 'error', message: 'Failed to fetch' },
      { status: 'unavailable' },
      { status: 'error', message: 'Request timed out' },
      { status: 'error', message: 'Could not load accounts' },
      { status: 'error', message: 'Failed to fetch' },
    ]);
    await advance(3000);
    expect(api.calls).toHaveLength(8);
    expect(seen).toHaveLength(6);
    expect(seen[5]).toEqual(READY);
  });

  it('an answer without a list is a failed load: one plain error, asked again, then ready', async () => {
    const api = employeesApi([{}, { employees: 'none' }, null]);
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(6000);
    expect(api.calls).toHaveLength(3);
    expect(seen).toEqual([{ status: 'error', message: 'Could not load accounts' }]);
    await advance(3000);
    expect(seen).toEqual([{ status: 'error', message: 'Could not load accounts' }, READY]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never two requests at a time: the 3 s start when a request has failed, not when it started', async () => {
    const api = employeesApi(['pending', 'pending']);
    const seen: V2Directory[] = [];
    startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(20_000); // a slow first request: nothing else starts while it is open
    expect(api.calls).toHaveLength(1);
    expect(seen).toEqual([]);
    api.calls[0].reject(down());
    await advance(2999);
    expect(api.calls).toHaveLength(1);
    await advance(1);
    expect(api.calls).toHaveLength(2);
    await advance(20_000); // the retry is slow too
    expect(api.calls).toHaveLength(2);
    api.calls[1].resolve({ employees: EMPLOYEES });
    await advance(0);
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }, READY]);
    expect(api.maxOpen()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a fetcher that throws at once is a failed load like any other', async () => {
    let n = 0;
    const seen: V2Directory[] = [];
    startV2Directory(() => {
      n += 1;
      if (n === 1) throw new Error('no fetch here');
      return Promise.resolve({ employees: EMPLOYEES });
    }, isTravelUnavailable, (d) => seen.push(d));
    await advance(0);
    expect(seen).toEqual([{ status: 'error', message: 'no fetch here' }]);
    await advance(3000);
    expect(seen).toEqual([{ status: 'error', message: 'no fetch here' }, READY]);
  });
});

describe('the cleanup stops the retries (#636)', () => {
  it('a cleanup after an error clears the timer: no further request and no state', async () => {
    const api = employeesApi([down()]);
    const seen: V2Directory[] = [];
    const stop = startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(0);
    expect(seen).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(api.calls).toHaveLength(1);
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }]);
  });

  it('a cleanup during a retry aborts that request and drops its answer and its failure', async () => {
    for (const settle of [(c: Call) => c.resolve({ employees: EMPLOYEES }), (c: Call) => c.reject(down())]) {
      const api = employeesApi([travelMissing(), 'pending']);
      const seen: V2Directory[] = [];
      const stop = startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
      await advance(3000);
      expect(api.calls).toHaveLength(2);
      expect(api.calls[1].signal.aborted).toBe(false);
      expect(api.calls[1].signal).not.toBe(api.calls[0].signal); // each try has its own signal
      stop();
      expect(api.calls[1].signal.aborted).toBe(true);
      settle(api.calls[1]);
      await advance(60_000);
      expect(api.calls).toHaveLength(2);
      expect(seen).toEqual([{ status: 'unavailable' }]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('a cleanup called from inside the report of a failure stops the retries too', async () => {
    const api = employeesApi([down()]);
    const seen: V2Directory[] = [];
    const stop: () => void = startV2Directory(api.fetch, isTravelUnavailable, (d) => { seen.push(d); stop(); });
    await advance(60_000);
    expect(api.calls).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('calling the cleanup twice, or after the list is ready, does nothing', async () => {
    const api = employeesApi();
    const seen: V2Directory[] = [];
    const stop = startV2Directory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(0);
    stop();
    stop();
    await advance(60_000);
    expect(seen).toEqual([READY]);
    expect(api.calls).toHaveLength(1);
  });
});

describe('the three loaders share the retry (#636)', () => {
  it('startV2DirectoryWithEmployers: error, then the list with the employer of each employee', async () => {
    const api = employeesApi([down()]);
    const seen: V2Directory[] = [];
    startV2DirectoryWithEmployers(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(3000);
    expect(seen).toEqual([{ status: 'error', message: 'Failed to fetch' }, { status: 'ready', employees: EMPLOYEES }]);
    expect(api.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('startV2BusinessDirectory: unavailable once for two 503s, then the businesses; the cleanup stops it', async () => {
    const api = fetcher({ businesses: BUSINESSES }, [travelMissing(), travelMissing()]);
    const seen: V2BusinessDirectory[] = [];
    startV2BusinessDirectory(api.fetch, isTravelUnavailable, (d) => seen.push(d));
    await advance(3000);
    expect(seen).toEqual([{ status: 'unavailable' }]);
    await advance(3000);
    expect(seen).toEqual([{ status: 'unavailable' }, { status: 'ready', businesses: BUSINESSES }]);
    expect(api.calls).toHaveLength(3);

    const failing = fetcher({ businesses: BUSINESSES }, [down()]);
    const stop = startV2BusinessDirectory(failing.fetch, isTravelUnavailable, () => undefined);
    await advance(0);
    stop();
    await advance(60_000);
    expect(failing.calls).toHaveLength(1);
    expect(failing.calls[0].signal.aborted).toBe(true);
  });

  it('two loaders side by side (the header) retry on their own: one list down does not reload the other', async () => {
    const employees = employeesApi();
    const businesses = fetcher({ businesses: BUSINESSES }, [down(), down()]);
    const seenE: V2Directory[] = [];
    const seenB: V2BusinessDirectory[] = [];
    startV2DirectoryWithEmployers(employees.fetch, isTravelUnavailable, (d) => seenE.push(d));
    startV2BusinessDirectory(businesses.fetch, isTravelUnavailable, (d) => seenB.push(d));
    await advance(6000);
    expect(employees.calls).toHaveLength(1);
    expect(businesses.calls).toHaveLength(3);
    expect(seenE).toEqual([{ status: 'ready', employees: EMPLOYEES }]);
    expect(seenB).toEqual([{ status: 'error', message: 'Failed to fetch' }, { status: 'ready', businesses: BUSINESSES }]);
  });
});
