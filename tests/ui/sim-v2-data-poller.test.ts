import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { RequestOptions } from '../../client/src/api/v2';
import type { SimDataAction } from '../../client/src/components/sim/v2/live/simDataModel';
import { createSimPoller, type SimPoller } from '../../client/src/components/sim/v2/live/simPoller';
import { abortError, mapOf, networkError, simAt, travel503 } from './sim-v2-data-fixtures';

/** A fake API whose answers take `simMs` / `mapMs` of fake time and honour the abort signal. */
function fakeApi(opts: { simMs?: number; mapMs?: number } = {}) {
  const f = {
    simMs: opts.simMs ?? 50, mapMs: opts.mapMs ?? 50,
    sim: simAt('run-a', 1, ['plan-1']) as SimulatorResponse,
    simError: null as Error | null,
    simCalls: 0, mapCalls: 0, open: 0, maxOpen: 0, aborted: 0,
  };
  const delayed = <T>(ms: number, value: () => T, signal?: AbortSignal) => new Promise<T>((resolve, reject) => {
    f.open++; f.maxOpen = Math.max(f.maxOpen, f.open);
    const t = setTimeout(() => {
      f.open--;
      try { resolve(value()); } catch (e) { reject(e); }
    }, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); f.open--; f.aborted++; reject(abortError()); }, { once: true });
  });
  const api = {
    getSimulator: (o?: RequestOptions) => {
      f.simCalls++;
      return delayed(f.simMs, () => { if (f.simError) throw f.simError; return f.sim; }, o?.signal);
    },
    getMap: (o?: RequestOptions): Promise<MapResponse> => {
      f.mapCalls++;
      const runId = f.sim.runId;
      return delayed(f.mapMs, () => mapOf(runId), o?.signal);
    },
  };
  return { f, api };
}

let poller: SimPoller | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { poller?.stop(); poller = null; vi.useRealTimers(); });

describe('createSimPoller', () => {
  it('sends one request per second', async () => {
    const { f, api } = fakeApi();
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a));
    poller.start();
    await vi.advanceTimersByTimeAsync(4990);
    expect(f.simCalls).toBe(5); // t = 0, 1, 2, 3, 4 s
    expect(actions.filter((a) => a.type === 'sim')).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.simCalls).toBe(6);
  });

  it('never overlaps when a request takes 2.5 s', async () => {
    const { f, api } = fakeApi({ simMs: 2500, mapMs: 10 });
    poller = createSimPoller(api, () => {});
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.maxOpen).toBe(1);
    expect(f.simCalls).toBe(4); // started at 0, 3, 6 and 9 s; the ticks in between are skipped
  });

  it('stop() aborts the open request and nothing reaches the sink afterwards', async () => {
    const { f, api } = fakeApi({ simMs: 800 });
    const sink = vi.fn();
    poller = createSimPoller(api, sink);
    poller.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.open).toBe(1);
    poller.stop();
    expect(f.aborted).toBe(1);
    expect(f.open).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sink).not.toHaveBeenCalled();
    expect(f.simCalls).toBe(1);
  });

  it('fetches the map once for 10 equal polls and again when a plan is added', async () => {
    const { f, api } = fakeApi();
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a));
    poller.start();
    await vi.advanceTimersByTimeAsync(9990);
    expect(f.simCalls).toBe(10);
    expect(f.mapCalls).toBe(1);
    // A newer version with the same plans does not refetch either.
    f.sim = simAt('run-a', 2, ['plan-1']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.mapCalls).toBe(1);
    f.sim = simAt('run-a', 3, ['plan-1', 'plan-2']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.mapCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.mapCalls).toBe(2);
    f.sim = simAt('run-b', 1, ['plan-1', 'plan-2']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.mapCalls).toBe(3);
    const maps = actions.filter((a): a is Extract<SimDataAction, { type: 'map' }> => a.type === 'map');
    expect(maps.map((a) => a.map.runId)).toEqual(['run-a', 'run-a', 'run-b']);
  });

  it('reports failures to the sink and retries the map after a failed map fetch', async () => {
    const { f, api } = fakeApi();
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a));
    f.simError = travel503('travel_data_missing', 'no data');
    poller.start();
    await vi.advanceTimersByTimeAsync(990);
    expect(actions).toEqual([{ type: 'pollFailed', error: f.simError }]);
    f.simError = null;
    const failMap = api.getMap;
    api.getMap = () => { f.mapCalls++; return Promise.reject(networkError()); };
    await vi.advanceTimersByTimeAsync(1000);
    expect(actions.map((a) => a.type)).toEqual(['pollFailed', 'sim', 'pollFailed']);
    api.getMap = failMap;
    // The retry waits for the 2 s gap after the failed map request (t = 1050 ms -> 3050 ms, #528).
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.mapCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.mapCalls).toBe(2);
    expect(actions.map((a) => a.type)).toEqual(['pollFailed', 'sim', 'pollFailed', 'sim', 'sim', 'map']);
  });

  it('refetchNow() drops the open poll and polls at once', async () => {
    const { f, api } = fakeApi({ simMs: 400 });
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a));
    poller.start();
    await vi.advanceTimersByTimeAsync(600); // first poll + its map are done (450 ms)
    await vi.advanceTimersByTimeAsync(500); // the 1 s poll is open
    expect(f.open).toBe(1);
    f.sim = simAt('run-b', 1);
    const done = poller.refetchNow();
    expect(f.aborted).toBe(1);
    expect(f.maxOpen).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    const sims = actions.filter((a): a is Extract<SimDataAction, { type: 'sim' }> => a.type === 'sim');
    expect(sims.map((a) => a.sim.runId)).toEqual(['run-a', 'run-b']);
    expect(actions.some((a) => a.type === 'pollFailed')).toBe(false); // the abort is silent
  });

  it('refetchNow() does nothing while stopped', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, () => {});
    await poller.refetchNow();
    expect(f.simCalls).toBe(0);
  });
});
