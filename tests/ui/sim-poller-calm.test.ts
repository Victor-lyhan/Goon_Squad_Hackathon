// @vitest-environment jsdom
// #921: the simulator's live updates stay calm in every state of the demo.
//   - hidden tab: the 1 s poll and the map refetch pause (the open request is dropped); on return one
//     poll at once, then the 1 s rhythm again, and the map timer goes on with the time it had left;
//   - server unreachable: the poll backs off 1, 2, 4, 8, then 10 s, and goes back to 1 s on the first answer;
//   - leave: stop() aborts the open request, clears every timer and the visibility listener.
// Fake timers and a fake API; the last group mounts the real hook in jsdom and flips `document.hidden`.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { RequestOptions } from '../../client/src/api/v2';
import type { SimDataAction } from '../../client/src/components/sim/v2/live/simDataModel';
import {
  MAP_REFRESH_MS, SIM_BACKOFF_MAX_MS, SIM_POLL_MS, backoffDelayMs, createSimPoller, documentVisibility,
  type PageVisibility, type SimPoller,
} from '../../client/src/components/sim/v2/live/simPoller';
import { useSimulatorV2, type SimulatorV2Api } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import { mount } from './kitDom';
import { abortError, httpError, mapOf, networkError, simAt } from './sim-v2-data-fixtures';

/** A fake API: answers take `ms` of fake time, honour the abort signal, and fail while `down`. */
function fakeApi(ms = 50) {
  const f = {
    down: false as boolean | 'http500',
    simAt: [] as number[], mapAt: [] as number[],
    open: 0, maxOpen: 0, aborted: 0,
  };
  const delayed = <T>(value: () => T, signal?: AbortSignal) => new Promise<T>((resolve, reject) => {
    f.open++; f.maxOpen = Math.max(f.maxOpen, f.open);
    const t = setTimeout(() => {
      f.open--;
      try { resolve(value()); } catch (e) { reject(e); }
    }, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); f.open--; f.aborted++; reject(abortError()); }, { once: true });
  });
  let version = 0;
  const api = {
    getSimulator: (o?: RequestOptions): Promise<SimulatorResponse> => {
      f.simAt.push(Date.now());
      return delayed(() => {
        if (f.down === 'http500') throw httpError(500, 'boom');
        if (f.down) throw networkError();
        return simAt('run-a', ++version);
      }, o?.signal);
    },
    getMap: (o?: RequestOptions): Promise<MapResponse> => {
      f.mapAt.push(Date.now());
      return delayed(() => { if (f.down) throw networkError(); return mapOf('run-a'); }, o?.signal);
    },
  };
  return { f, api };
}

/** A tab whose visibility the test flips; `listeners` shows whether the poller still listens. */
function fakeTab(hidden = false) {
  const listeners = new Set<() => void>();
  const state = { hidden };
  const visibility: PageVisibility = {
    hidden: () => state.hidden,
    onChange(l) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
  return {
    listeners,
    visibility,
    set(next: boolean) { state.hidden = next; for (const l of [...listeners]) l(); },
  };
}

let poller: SimPoller | null = null;
let t0 = 0;
const since = (ts: number[]) => ts.map((t) => t - t0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers(); t0 = Date.now(); });
afterEach(() => { poller?.stop(); poller = null; vi.useRealTimers(); });

describe('a hidden tab', () => {
  it('pauses the 1 s poll and the map refetch; on return one poll at once, then the 1 s rhythm', async () => {
    const { f, api } = fakeApi();
    const tab = fakeTab();
    poller = createSimPoller(api, () => {}, { visibility: tab.visibility });
    poller.start();
    await advance(2990);
    expect(since(f.simAt)).toEqual([0, 1000, 2000]);
    expect(since(f.mapAt)).toEqual([50]); // the first poll's map; its slow refresh is due at 30.1 s

    tab.set(true); // t = 2.99 s
    await advance(60_000); // a whole minute away: past the 30 s map refresh too
    expect(f.simAt).toHaveLength(3);
    expect(f.mapAt).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // nothing is waiting to fire

    tab.set(false); // t = 62.99 s: polls at once, before any timer
    expect(since(f.simAt)).toHaveLength(4);
    expect(since(f.simAt)[3]).toBe(62_990);
    await advance(3000);
    expect(since(f.simAt).slice(3)).toEqual([62_990, 63_990, 64_990, 65_990]);
    expect(f.maxOpen).toBe(1);

    // The 30 s map refresh fell due while hidden: it goes once, right after the return poll's answer
    // (a commute saved in another tab shows up), and the next one is 30 s after it.
    expect(since(f.mapAt)).toEqual([50, 63_040]);
    expect(f.maxOpen).toBe(1);

    // A short hide keeps the map timer's due time (63.09 + 30 = 93.09 s): nothing extra on return.
    await advance(70_000 - 65_990); // t = 70 s
    tab.set(true);
    await advance(5000);
    tab.set(false); // t = 75 s
    await advance(93_000 - 75_000);
    expect(f.mapAt).toHaveLength(2);
    await advance(1200);
    expect(since(f.mapAt)).toEqual([50, 63_040, 93_090]);
    expect(f.maxOpen).toBe(1);
  });

  it('drops the request that is open when the tab hides; its answer never reaches the page', async () => {
    const { f, api } = fakeApi(400);
    const tab = fakeTab();
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a), { visibility: tab.visibility });
    poller.start();
    await advance(200);
    expect(f.open).toBe(1);
    tab.set(true);
    expect(f.aborted).toBe(1);
    expect(f.open).toBe(0);
    await advance(10_000);
    expect(actions).toEqual([]); // the abort is silent: no error sentence for a tab switch
    expect(f.simAt).toHaveLength(1);
  });

  it('an aborted map fetch is fetched with the first poll after return', async () => {
    const { f, api } = fakeApi(400);
    const tab = fakeTab();
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a), { visibility: tab.visibility });
    poller.start();
    await advance(600); // the poll answered at 400 ms; its map is open
    expect(f.mapAt).toHaveLength(1);
    tab.set(true);
    await advance(5000);
    tab.set(false);
    await advance(1000);
    expect(f.mapAt).toHaveLength(2);
    expect(actions.map((a) => a.type)).toEqual(['sim', 'sim', 'map']);
  });

  it('a page opened in a hidden tab waits for the tab to be shown; refetchNow() sends nothing while hidden', async () => {
    const { f, api } = fakeApi();
    const tab = fakeTab(true);
    poller = createSimPoller(api, () => {}, { visibility: tab.visibility });
    poller.start();
    await poller.refetchNow();
    await advance(10_000);
    expect(f.simAt).toEqual([]);
    tab.set(false);
    await advance(1990);
    expect(since(f.simAt)).toEqual([10_000, 11_000]);
  });

  it('hiding twice or showing twice changes nothing', async () => {
    const { f, api } = fakeApi();
    const tab = fakeTab();
    poller = createSimPoller(api, () => {}, { visibility: tab.visibility });
    poller.start();
    await advance(500);
    tab.set(false); // still visible: no extra poll
    expect(f.simAt).toHaveLength(1);
    tab.set(true);
    tab.set(true);
    tab.set(false);
    tab.set(false);
    expect(f.simAt).toHaveLength(2);
    await advance(990);
    expect(f.simAt).toHaveLength(2);
    await advance(20);
    expect(f.simAt).toHaveLength(3);
  });
});

describe('an unreachable server', () => {
  it('backoffDelayMs: 1, 2, 4, 8, then 10 s', () => {
    expect([1, 2, 3, 4, 5, 6, 50, 5000].map((n) => backoffDelayMs(n))).toEqual(
      [1000, 2000, 4000, 8000, 10_000, 10_000, 10_000, 10_000],
    );
    expect(backoffDelayMs(0)).toBe(SIM_POLL_MS);
    expect(SIM_BACKOFF_MAX_MS).toBe(10_000);
  });

  it('backs off while requests fail, and goes back to 1 s on the first good answer', async () => {
    const { f, api } = fakeApi();
    const actions: SimDataAction[] = [];
    poller = createSimPoller(api, (a) => actions.push(a), { visibility: null });
    poller.start();
    await advance(1000);
    f.down = true;
    // t = 1 s fails at 1.05 s; then waits of 1, 2, 4, 8, 10, 10 s after each failure.
    await advance(40_000);
    expect(since(f.simAt)).toEqual([0, 1000, 2050, 4100, 8150, 16_200, 26_250, 36_300]);
    expect(f.maxOpen).toBe(1);
    // Every failure is reported (the page's "Can't reach the Relay server. Retrying…" stays).
    expect(actions.filter((a) => a.type === 'pollFailed')).toHaveLength(7);

    f.down = false; // t = 41 s; the next try is at 46.35 s
    await advance(5340);
    expect(f.simAt).toHaveLength(8);
    await advance(20);
    expect(f.simAt).toHaveLength(9); // 46.35 s: answers at 46.40 s
    await advance(3100);
    expect(since(f.simAt).slice(8)).toEqual([46_350, 47_400, 48_400, 49_400]);
  });

  it('an HTTP error is an answer: no back-off, the poll stays at 1 s', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, () => {}, { visibility: null });
    f.down = 'http500';
    poller.start();
    await advance(4990);
    expect(since(f.simAt)).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it('an HTTP answer after network failures ends the back-off at once', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, () => {}, { visibility: null });
    f.down = true;
    poller.start();
    await advance(7100); // 0, 1.05, 3.10 s; next at 7.15 s
    expect(since(f.simAt)).toEqual([0, 1050, 3100]);
    f.down = 'http500';
    await advance(3000); // 7.15 s answers 500 at 7.20 s: 1 s again from there
    expect(since(f.simAt)).toEqual([0, 1050, 3100, 7150, 8200, 9200]);
  });

  it('refetchNow() (a control or "Retry now") still polls at once while backing off', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, () => {}, { visibility: null });
    f.down = true;
    poller.start();
    await advance(5000); // next try at 7.15 s
    f.down = false;
    const done = poller.refetchNow(); // polls at 5 s, answers at 5.05 s: the back-off is over
    expect(since(f.simAt)).toEqual([0, 1050, 3100, 5000]);
    await advance(100); // and its first map (5.05 to 5.10 s)
    await done;
    await advance(2000);
    expect(since(f.simAt)).toEqual([0, 1050, 3100, 5000, 6050, 7050]);
  });

  it('a hidden tab pauses the back-off too; on return it polls at once', async () => {
    const { f, api } = fakeApi();
    const tab = fakeTab();
    poller = createSimPoller(api, () => {}, { visibility: tab.visibility });
    f.down = true;
    poller.start();
    await advance(2000);
    tab.set(true);
    await advance(30_000);
    expect(since(f.simAt)).toEqual([0, 1050]);
    tab.set(false); // t = 32 s
    expect(since(f.simAt)).toEqual([0, 1050, 32_000]);
  });
});

describe('stop() on leave', () => {
  it('aborts the open request, clears every timer and stops listening to the tab', async () => {
    const { f, api } = fakeApi(400);
    const tab = fakeTab();
    const sink = vi.fn();
    poller = createSimPoller(api, sink, { visibility: tab.visibility });
    poller.start();
    await advance(1200); // map timer armed, the 1 s interval running, a poll open
    expect(f.open).toBe(1);
    expect(tab.listeners.size).toBe(1);
    const seen = sink.mock.calls.length;
    poller.stop();
    expect(f.aborted).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(tab.listeners.size).toBe(0);
    tab.set(true);
    tab.set(false);
    await advance(MAP_REFRESH_MS * 2);
    expect(f.simAt).toHaveLength(2);
    expect(sink.mock.calls.length).toBe(seen);
  });

  it('clears the back-off timer too', async () => {
    const { f, api } = fakeApi();
    poller = createSimPoller(api, () => {}, { visibility: null });
    f.down = true;
    poller.start();
    await advance(2000);
    expect(vi.getTimerCount()).toBe(1); // the back-off timeout
    poller.stop();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(f.simAt).toHaveLength(2);
  });
});

describe('the real tab (document.hidden) and the real hook', () => {
  let hidden = false;
  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => { delete (document as { hidden?: boolean }).hidden; });
  const flip = (next: boolean) => { hidden = next; document.dispatchEvent(new Event('visibilitychange')); };

  it('documentVisibility() reads document.hidden and hears visibilitychange', () => {
    const v = documentVisibility()!;
    const heard = vi.fn();
    const off = v.onChange(heard);
    expect(v.hidden()).toBe(false);
    flip(true);
    expect(v.hidden()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    flip(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('useSimulatorV2: pauses with the tab, resumes with one poll, and sends nothing after unmount', async () => {
    const { f, api } = fakeApi();
    const full: SimulatorV2Api = {
      ...api,
      simulatorControl: async () => simAt('run-a', 1000),
      compareMatches: async () => { throw new Error('unused'); },
    };
    function Probe() { useSimulatorV2(full); return null; }
    const page = mount(createElement(Probe));
    await advance(2990);
    expect(f.simAt).toHaveLength(3);

    flip(true);
    await advance(40_000);
    expect(f.simAt).toHaveLength(3);
    expect(f.mapAt).toHaveLength(1);

    flip(false);
    expect(f.simAt).toHaveLength(4);
    await advance(1500); // 4th answered; the 1 s interval fired once more
    expect(f.simAt).toHaveLength(5);

    page.unmount(); // a poll is open (its answer is due 50 ms after the 1 s tick)
    expect(vi.getTimerCount()).toBe(0);
    flip(true);
    flip(false);
    await advance(60_000);
    expect(f.simAt).toHaveLength(5);
    expect(f.open).toBe(0);
  });
});
