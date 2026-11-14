// #528: the simulator picks up route lines that arrive after it loaded its map. Fake timers and a fake
// API (no network): the poller refetches GET /api/v2/map while a plan leg has no line (after 2, 4, 8,
// 16 and 30 s), then every 30 s, and an equal map keeps the state's map object.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapResponse, RoutePolyline, SimulatorResponse } from '../../shared/v2/api';
import type { RequestOptions } from '../../client/src/api/v2';
import {
  INITIAL_SIM_DATA, simDataReducer, type SimDataAction, type SimDataState,
} from '../../client/src/components/sim/v2/live/simDataModel';
import {
  MAP_REFRESH_MS, MAP_RETRY_DELAYS_MS, createSimPoller, type SimPoller,
} from '../../client/src/components/sim/v2/live/simPoller';
import { abortError, networkError, simAt } from './sim-v2-data-fixtures';

type PlanSpec = { id: string; legs: string[][] };

/** A SimulatorResponse whose plans carry legs with `placeIds` (the only leg field the poller reads). */
function simWith(runId: string, version: number, plans: PlanSpec[]): SimulatorResponse {
  const base = simAt(runId, version, plans.map((p) => p.id));
  return { ...base, plans: plans.map((p) => ({ id: p.id, legs: p.legs.map((placeIds) => ({ placeIds })) })) } as unknown as SimulatorResponse;
}

const PLAN_1: PlanSpec = { id: 'plan-1', legs: [['home-1', 'biz-a', 'biz-b']] };
const PLAN_2: PlanSpec = { id: 'plan-2', legs: [['home-2', 'biz-c'], ['biz-c', 'biz-d', 'home-3']] };
const PLAN_3: PlanSpec = { id: 'plan-3', legs: [['home-4', 'biz-e']] };

const line = (from: string, to: string, encoded: string | null = `enc:${from}>${to}`): RoutePolyline => ({ from, to, encoded });
const PLAN_1_LINES = [line('home-1', 'biz-a'), line('biz-a', 'biz-b')];
const PLAN_2_LINES = [line('home-2', 'biz-c'), line('biz-c', 'biz-d'), line('biz-d', 'home-3')];
/** What the server answers before `ensureLegPolylines` is done: the pairs are listed with `encoded: null`. */
const PLAN_2_PENDING = PLAN_2_LINES.map((l) => ({ ...l, encoded: null }));

function mapWith(runId: string, polylines: RoutePolyline[], homeLat = 40.81): MapResponse {
  return {
    runId,
    businesses: [{ id: 'biz-a', name: 'A' }] as unknown as MapResponse['businesses'],
    homes: [{ id: 'home-1', neighborhood: 'Harlem', lat: homeLat, lng: -73.94 }],
    employees: [{ id: 'emp-1', name: 'Ana', businessId: 'biz-a', homeId: 'home-1' }],
    polylines,
  };
}

/** A fake API: answers take `simMs` / `mapMs` of fake time, honour the abort signal and log their start. */
function fakeApi(opts: { simMs?: number; mapMs?: number } = {}) {
  const f = {
    simMs: opts.simMs ?? 50, mapMs: opts.mapMs ?? 50,
    sim: simWith('run-a', 1, [PLAN_1]),
    map: (): MapResponse => mapWith('run-a', PLAN_1_LINES),
    mapError: null as Error | null,
    simTimes: [] as number[], mapTimes: [] as number[], open: 0, maxOpen: 0,
  };
  const delayed = <T>(ms: number, value: () => T, signal?: AbortSignal) => new Promise<T>((resolve, reject) => {
    f.open++; f.maxOpen = Math.max(f.maxOpen, f.open);
    const t = setTimeout(() => {
      f.open--;
      try { resolve(value()); } catch (e) { reject(e); }
    }, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); f.open--; reject(abortError()); }, { once: true });
  });
  const api = {
    getSimulator: (o?: RequestOptions) => {
      f.simTimes.push(Date.now());
      return delayed(f.simMs, () => f.sim, o?.signal);
    },
    getMap: (o?: RequestOptions): Promise<MapResponse> => {
      f.mapTimes.push(Date.now());
      return delayed(f.mapMs, () => { if (f.mapError) throw f.mapError; return f.map(); }, o?.signal);
    },
  };
  return { f, api };
}

const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

let poller: SimPoller | null = null;
let actions: SimDataAction[] = [];
let state: SimDataState = INITIAL_SIM_DATA;
const sink = (a: SimDataAction) => { actions.push(a); state = simDataReducer(state, a); };
const mapActions = () => actions.filter((a): a is Extract<SimDataAction, { type: 'map' }> => a.type === 'map');

// The fake clock starts at 0, so the logged request times are milliseconds since start().
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); actions = []; state = INITIAL_SIM_DATA; });
afterEach(() => { poller?.stop(); poller = null; vi.useRealTimers(); });

describe('map refresh: lines that arrive after the map loaded (#528)', () => {
  it('a new plan whose first map has encoded: null gets its lines on the retry, then the 30 s rhythm', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(4990);
    expect(f.mapTimes).toEqual([50]); // nothing missing: no retry, the slow refresh is 30 s away

    // A live delivery: the plan appears before Google answered, so its pairs have no line yet.
    f.sim = simWith('run-a', 2, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    await vi.advanceTimersByTimeAsync(1000); // t = 5990: the poll at 5 s saw the new plan
    expect(f.mapTimes).toEqual([50, 5050]);
    expect(state.map?.polylines.filter((p) => p.encoded === null)).toHaveLength(3);

    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_LINES]); // the lines are cached now
    await vi.advanceTimersByTimeAsync(2000); // t = 7990
    // Retry 2 s after the first map of the new key arrived (5100 ms).
    expect(f.mapTimes).toEqual([50, 5050, 7100]);
    const last = mapActions().at(-1)!.map;
    expect(last.polylines.every((p) => p.encoded !== null)).toBe(true);
    expect(state.map).toBe(last);

    // Nothing missing any more: the next request is 30 s after that map arrived (7150 ms).
    await vi.advanceTimersByTimeAsync(37_150 - 7990 - 1);
    expect(f.mapTimes).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.mapTimes).toEqual([50, 5050, 7100, 37_150]);

    // The 1 s poll kept its rhythm and never overlapped the map requests.
    expect(gaps(f.simTimes).every((g) => g === 1000)).toBe(true);
    expect(f.maxOpen).toBe(1);
  });

  it('lines that never come: exactly 5 retries at 2, 4, 8, 16 and 30 s, then every 30 s', async () => {
    const { f, api } = fakeApi();
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(MAP_RETRY_DELAYS_MS).toEqual([2000, 4000, 8000, 16_000, 30_000]);
    expect(MAP_REFRESH_MS).toBe(30_000);
    // Each delay counts from the moment the previous map arrived (request start + 50 ms).
    const waits = gaps(f.mapTimes).map((g) => g - f.mapMs);
    expect(waits.slice(0, 5)).toEqual([2000, 4000, 8000, 16_000, 30_000]);
    expect(waits.slice(5).length).toBeGreaterThanOrEqual(3);
    expect(waits.slice(5).every((w) => w === 30_000)).toBe(true);
    expect(f.mapTimes.length).toBe(1 + 5 + waits.slice(5).length);
    expect(actions.some((a) => a.type === 'pollFailed')).toBe(false);
    expect(f.maxOpen).toBe(1);
  });

  it('missing a pair entirely (no polyline listed) also counts as a missing line', async () => {
    const { f, api } = fakeApi();
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, PLAN_2_LINES[0]]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(2200);
    expect(f.mapTimes).toEqual([50, 2100]);
  });

  it('a new map key resets the count of tries', async () => {
    const { f, api } = fakeApi();
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    // Three retries (2.1, 6.15, 14.2 s), then a new plan arrives during the 16 s wait.
    await vi.advanceTimersByTimeAsync(20_500);
    expect(f.mapTimes).toEqual([50, 2100, 6150, 14_200]);
    f.sim = simWith('run-a', 2, [PLAN_1, PLAN_2, PLAN_3]);
    await vi.advanceTimersByTimeAsync(100_000);
    // The new key is fetched on the poll at 21 s; its retries start again at 2 s.
    const after = f.mapTimes.slice(4);
    expect(after[0]).toBe(21_050);
    expect(gaps(after).map((g) => g - f.mapMs).slice(0, 5)).toEqual([2000, 4000, 8000, 16_000, 30_000]);
  });

  it('a failed refetch keeps the loaded map, counts as one try and shows no page error', async () => {
    const { f, api } = fakeApi();
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    const loaded = state.map;
    expect(loaded).not.toBeNull();
    f.mapError = networkError();
    await vi.advanceTimersByTimeAsync(1500); // the 2 s retry (2100 ms) fails at 2150 ms
    expect(f.mapTimes).toEqual([50, 2100]);
    expect(state.map).toBe(loaded);
    expect(state.reconnecting).toBe(false);
    expect(actions.some((a) => a.type === 'pollFailed')).toBe(false);
    f.mapError = null;
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_LINES]);
    // The failure used the 2 s try: the next one is 4 s after it (6150 ms) and brings the lines.
    await vi.advanceTimersByTimeAsync(6200 - 2500);
    expect(f.mapTimes).toEqual([50, 2100, 6150]);
    expect(state.map?.polylines.every((p) => p.encoded !== null)).toBe(true);
  });

  it('the slow refresh brings a commute saved in another tab', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    const first = state.map;
    f.map = () => mapWith('run-a', PLAN_1_LINES, 40.82); // emp-1's home moved
    await vi.advanceTimersByTimeAsync(30_100);
    expect(f.mapTimes).toEqual([50, 30_100]);
    expect(state.map).not.toBe(first);
    expect(state.map?.homes[0].lat).toBe(40.82);
  });

  it('an equal map leaves the state object unchanged', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    const before = state;
    const shownMap = state.map;
    await vi.advanceTimersByTimeAsync(61_000); // two refreshes with equal content (new objects)
    expect(f.mapTimes).toEqual([50, 30_100, 60_150]);
    expect(mapActions()).toHaveLength(3);
    expect(mapActions()[2].map).not.toBe(shownMap);
    expect(state.map).toBe(shownMap);
    expect(state).toBe(before); // equal polls and equal maps: nothing changed at all
  });

  it('stop() during a retry wait sends nothing more', async () => {
    const { f, api } = fakeApi();
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(1500); // the 2 s retry is waiting (due at 2100 ms)
    const sims = f.simTimes.length;
    const seen = actions.length;
    poller.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.mapTimes).toEqual([50]);
    expect(f.simTimes).toHaveLength(sims);
    expect(actions).toHaveLength(seen);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() during an open refetch aborts it and leaves no timer', async () => {
    const { f, api } = fakeApi({ mapMs: 300 });
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(2500); // the retry started at 2350 ms and is open
    expect(f.mapTimes).toEqual([50, 2350]);
    expect(f.open).toBe(1);
    const seen = actions.length;
    poller.stop();
    expect(f.open).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(actions).toHaveLength(seen);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a slow refetch never overlaps the 1 s poll, and the poll after it is not dropped', async () => {
    const { f, api } = fakeApi({ mapMs: 700 });
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.maxOpen).toBe(1);
    // A tick that lands on an open refetch runs right after it, so every tick of the 1 s poll is served.
    expect(f.simTimes).toHaveLength(121);
    expect(gaps(f.mapTimes).every((g) => g >= 2000)).toBe(true);
  });

  it('refetchNow() during an open refetch polls at once and the map is fetched again later', async () => {
    const { f, api } = fakeApi({ mapMs: 300 });
    f.sim = simWith('run-a', 1, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_PENDING]);
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(2400); // the retry started at 2350 ms and is open
    const sims = f.simTimes.length;
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_LINES]);
    const done = poller.refetchNow();
    expect(f.simTimes).toHaveLength(sims + 1);
    expect(f.maxOpen).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    // The aborted refetch is done again once the 2 s gap has passed (4350 ms); its map has the lines.
    expect(f.mapTimes).toEqual([50, 2350, 4350]);
    expect(state.map?.polylines.every((p) => p.encoded !== null)).toBe(true);
    expect(actions.some((a) => a.type === 'pollFailed')).toBe(false);
  });

  it('never sends two map requests within 2 s, even when the plans change twice in a row', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(990);
    f.sim = simWith('run-a', 2, [PLAN_1, PLAN_2]);
    f.map = () => mapWith('run-a', [...PLAN_1_LINES, ...PLAN_2_LINES]);
    await vi.advanceTimersByTimeAsync(1000); // poll at 1 s: new key, but the last map request was at 50 ms
    expect(f.mapTimes).toEqual([50]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.mapTimes).toEqual([50, 2050]);
    expect(state.map?.polylines).toHaveLength(5);
  });
});
