// The actions and the hook wiring of the MVP II simulator data layer (#380). There is no DOM in this
// test setup, so a tiny synchronous hooks harness stands in for React (see sim-poll-abort.test.tsx).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Slot = { v?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
  const st = { slots: [] as Slot[], i: 0, effects: [] as Array<() => void>, mounted: false, renders: 0, render: () => {} };
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = (): Slot => (st.slots[st.i] ??= {});
  const memo = <T>(make: () => T, deps: unknown[]): T => {
    const s = slot(); st.i++;
    if (!same(s.deps, deps)) { s.v = make(); s.deps = deps; }
    return s.v as T;
  };
  return {
    st,
    react: {
      useReducer<S, A>(reducer: (s: S, a: A) => S, init: S) {
        const s = slot(); const k = st.i++;
        if (!('v' in s)) s.v = { state: init, dispatch: (a: A) => {
          const box = st.slots[k].v as { state: S };
          const next = reducer(box.state, a);
          if (Object.is(next, box.state) || !st.mounted) return;
          box.state = next; st.render();
        } };
        const box = s.v as { state: S; dispatch: (a: A) => void };
        return [box.state, box.dispatch] as const;
      },
      useRef<T>(init: T) { const s = slot(); st.i++; if (!('v' in s)) s.v = { current: init }; return s.v as { current: T }; },
      useCallback<T>(fn: T, deps: unknown[]) { return memo(() => fn, deps); },
      useMemo: memo,
      useEffect(fn: () => void | (() => void), deps: unknown[]) {
        const s = slot(); st.i++;
        if (same(s.deps, deps)) return;
        s.deps = deps;
        st.effects.push(() => { s.cleanup?.(); s.cleanup = fn(); });
      },
    },
  };
});
vi.mock('react', () => h.react);

import type { CompareResponse, SimulatorResponse } from '../../shared/v2/api';
import type { RequestOptions } from '../../client/src/api/v2';
import { INITIAL_SIM_DATA, simDataReducer, type SimDataAction } from '../../client/src/components/sim/v2/live/simDataModel';
import {
  createSimActions, useSimulatorV2, type SimulatorV2, type SimulatorV2Api,
} from '../../client/src/components/sim/v2/live/useSimulatorV2';
import { httpError, mapOf, simAt, travel503 } from './sim-v2-data-fixtures';

/** Resolves on demand. */
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSimActions', () => {
  function setup() {
    let state = simDataReducer(INITIAL_SIM_DATA, { type: 'sim', sim: simAt('run-a', 5) });
    const dispatch = (a: SimDataAction) => { state = simDataReducer(state, a); };
    const afterWrite = vi.fn();
    const control = deferred<SimulatorResponse>();
    const api = {
      simulatorControl: vi.fn(() => control.promise),
      generateScenario: vi.fn(async () => simAt('run-b', 1)),
      resetPlanning: vi.fn(async () => simAt('run-a', 6, [])),
      recomputeMatches: vi.fn(async () => { throw httpError(409, 'Planning is locked while the day plays'); }),
      compareMatches: vi.fn(async () => ({ directOnly: {}, withRelay: {} }) as unknown as CompareResponse),
    };
    const actions = createSimActions(api, dispatch, afterWrite);
    return { get state() { return state; }, api, actions, afterWrite, control };
  }

  it('sets busy while a write is open, applies its response at once, then refetches', async () => {
    const t = setup();
    const p = t.actions.control({ action: 'play' });
    expect(t.state.busy).toBe(true);
    expect(t.api.simulatorControl).toHaveBeenCalledWith({ action: 'play' });
    t.control.resolve(simAt('run-a', 9, ['plan-1'], 1300));
    expect((await p)?.version).toBe(9);
    expect(t.state).toMatchObject({ busy: false, view: 'ready', actionError: null });
    expect(t.state.sim?.clock.timeMin).toBe(1300);
    expect(t.afterWrite).toHaveBeenCalledTimes(1);
  });

  it('generate applies the new run (map cleared until the refetch)', async () => {
    const t = setup();
    await t.actions.generate({ preset: 'random', seed: 7 });
    expect(t.api.generateScenario).toHaveBeenCalledWith({ preset: 'random', seed: 7 });
    expect(t.state.sim?.runId).toBe('run-b');
    expect(t.state.map).toBeNull();
    expect(t.afterWrite).toHaveBeenCalledTimes(1);
  });

  it('resetPlanning applies its response', async () => {
    const t = setup();
    await t.actions.resetPlanning();
    expect(t.state.sim?.version).toBe(6);
    expect(t.state.sim?.plans).toEqual([]);
  });

  it('a 409 goes to actionError, not to the page state', async () => {
    const t = setup();
    const before = t.state.sim;
    expect(await t.actions.recompute()).toBeNull();
    expect(t.state).toMatchObject({ view: 'ready', busy: false, actionError: 'Planning is locked while the day plays' });
    expect(t.state.sim).toBe(before);
    expect(t.afterWrite).not.toHaveBeenCalled();
  });

  it('a 503 from a write is an actionError too', async () => {
    const t = setup();
    t.api.generateScenario.mockRejectedValueOnce(travel503('travel_data_missing', 'x'));
    await t.actions.generate({ preset: 'demo' });
    expect(t.state.view).toBe('ready');
    expect(t.state.unavailable).toBeNull();
    expect(t.state.actionError).toMatch(/npm run fetch:routes/);
  });

  it('compare returns the what-if without applying anything', async () => {
    const t = setup();
    const before = t.state.sim;
    const res = await t.actions.compare();
    expect(res).toEqual({ directOnly: {}, withRelay: {} });
    expect(t.state.sim).toBe(before);
    expect(t.state.busy).toBe(false);
    expect(t.afterWrite).not.toHaveBeenCalled();
  });

  it('busy stays true until the last of two overlapping actions settles', async () => {
    const t = setup();
    const a = t.actions.control({ action: 'pause' });
    const b = t.actions.compare();
    await b;
    expect(t.state.busy).toBe(true);
    t.control.resolve(simAt('run-a', 6));
    await a;
    expect(t.state.busy).toBe(false);
  });

  it('after dispose nothing is dispatched', async () => {
    const t = setup();
    const p = t.actions.control({ action: 'play' });
    t.actions.dispose();
    t.control.resolve(simAt('run-a', 9));
    await p;
    expect(t.state.sim?.version).toBe(5);
    expect(t.afterWrite).not.toHaveBeenCalled();
    expect(await t.actions.recompute()).toBeNull();
    expect(t.api.recomputeMatches).not.toHaveBeenCalled();
  });
});

describe('useSimulatorV2', () => {
  let current: SimulatorV2;
  const signals: AbortSignal[] = [];
  let sim: SimulatorResponse;
  const api: SimulatorV2Api = {
    getSimulator: vi.fn(async (o?: RequestOptions) => { if (o?.signal) signals.push(o.signal); return sim; }),
    getMap: vi.fn(async () => mapOf(sim.runId)),
    simulatorControl: vi.fn(async () => { sim = simAt(sim.runId, sim.version + 1, sim.plans.map((p) => p.id), 1440); return sim; }),
    generateScenario: vi.fn(async () => { sim = simAt('run-b', 1); return sim; }),
    resetPlanning: vi.fn(async () => sim),
    recomputeMatches: vi.fn(async () => sim),
    compareMatches: vi.fn(async () => ({}) as CompareResponse),
  };

  function mount() {
    h.st.slots = []; h.st.effects = []; h.st.mounted = true; h.st.renders = 0;
    h.st.render = () => {
      h.st.i = 0; h.st.renders++;
      current = useSimulatorV2(api);
      const fx = h.st.effects; h.st.effects = [];
      fx.forEach((f) => f());
    };
    h.st.render();
  }
  function unmount() {
    h.st.mounted = false;
    for (const s of h.st.slots) (s as { cleanup?: () => void }).cleanup?.();
  }

  beforeEach(() => { vi.useFakeTimers(); sim = simAt('run-a', 1); signals.length = 0; vi.clearAllMocks(); });
  afterEach(() => { unmount(); vi.useRealTimers(); });

  it('loads, polls every second and keeps the returned object for equal polls', async () => {
    mount();
    expect(current.view).toBe('loading');
    await vi.advanceTimersByTimeAsync(10);
    expect(current.view).toBe('ready');
    expect(current.map?.runId).toBe('run-a');
    const shown = current;
    const renders = h.st.renders;
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.getSimulator).toHaveBeenCalledTimes(4);
    expect(api.getMap).toHaveBeenCalledTimes(1);
    expect(current).toBe(shown);
    expect(h.st.renders).toBe(renders);
  });

  it('a control action applies at once; a generate refetches the map of the new run', async () => {
    mount();
    await vi.advanceTimersByTimeAsync(10);
    await current.control({ action: 'jump_to_morning' });
    expect(current.sim?.clock.timeMin).toBe(1440);
    await current.generate({ preset: 'random' });
    expect(current.sim?.runId).toBe('run-b');
    // The refetch after the write: the first map was requested < 2 s ago, so the new run's map waits
    // for the rest of the 2 s gap between map requests (#528).
    await vi.advanceTimersByTimeAsync(10);
    expect(current.map).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(current.map?.runId).toBe('run-b');
    expect(current.busy).toBe(false);
  });

  it('unmount stops the poll and aborts the open request', async () => {
    mount();
    await vi.advanceTimersByTimeAsync(10);
    // The next poll hangs until it is aborted.
    vi.mocked(api.getSimulator).mockImplementationOnce((o?: RequestOptions) => new Promise((_res, rej) => {
      signals.push(o!.signal!);
      o!.signal!.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    await vi.advanceTimersByTimeAsync(1000);
    const calls = vi.mocked(api.getSimulator).mock.calls.length;
    const open = signals[signals.length - 1];
    expect(open.aborted).toBe(false);
    unmount();
    expect(open.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.getSimulator).toHaveBeenCalledTimes(calls);
    expect(current.view).toBe('ready'); // the abort never reached the state
  });
});

describe('sim/v2/live folder rules', () => {
  const dir = resolve(__dirname, '../../client/src/components/sim/v2/live');
  const files = readdirSync(dir).map((f) => ({ f, src: readFileSync(join(dir, f), 'utf8') }));

  it('has the three files of #380', () => {
    expect(files.map((x) => x.f).sort()).toEqual(['simDataModel.ts', 'simPoller.ts', 'useSimulatorV2.ts']);
  });

  it.each(files.map((x) => [x.f, x.src]))('%s imports API helpers only from client/src/api/v2', (_f, src) => {
    const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    // Client API imports (not shared/v2/api): only the v2 helpers, never the MVP 1 index or ./client.
    for (const s of specs.filter((x) => !x.includes('shared/') && /\/api(\/|$)/.test(x))) expect(s).toBe('../../../../api/v2');
    expect(src).not.toMatch(/api\/client/);
    expect(specs.filter((x) => x.includes('shared/') && !x.includes('shared/v2/'))).toEqual([]);
  });

  it.each(files.map((x) => [x.f, x.src]))('%s never says hub or synthetic', (_f, src) => {
    expect(src).not.toMatch(/hub|synthetic/i);
  });
});
