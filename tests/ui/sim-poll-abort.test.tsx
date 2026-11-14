// Runs the real useSimulatorData hook against a stubbed fetch. There is no DOM in this repo's test setup,
// so a tiny synchronous hooks harness stands in for React (state, refs, effects, callbacks).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Slot = { v?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
  const st = { slots: [] as Slot[], i: 0, effects: [] as Array<() => void>, mounted: false, render: () => {}, lateSets: 0 };
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = (): Slot => (st.slots[st.i] ??= {});
  return {
    st,
    react: {
      useState<T>(init: T) {
        const s = slot(); const k = st.i++;
        if (!('v' in s)) s.v = init;
        return [s.v as T, (n: T) => {
          if (!st.mounted) { st.lateSets++; return; }
          if (!Object.is(st.slots[k].v, n)) { st.slots[k].v = n; st.render(); }
        }] as const;
      },
      useRef<T>(init: T) { const s = slot(); st.i++; if (!('v' in s)) s.v = { current: init }; return s.v as { current: T }; },
      useCallback<T>(fn: T, deps: unknown[]) {
        const s = slot(); st.i++;
        if (!same(s.deps, deps)) { s.v = fn; s.deps = deps; }
        return s.v as T;
      },
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

import { useSimulatorData, POLL_MS, type SimulatorData } from '../../client/src/components/sim/useSimulatorData';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';

const run = createInitialRun(loadDefaultScenario());
const simFor = (runId: string) => ({ ...buildSimulatorResponse(run), runId });
const mapFor = (runId: string) => {
  const s = run.scenario;
  return { runId, graph: s.graph, businesses: s.businesses, hubs: s.hubs,
    homes: s.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })) };
};
const employeesBody = { employees: run.scenario.employees };

let current: SimulatorData;
function mount() {
  h.st.slots = []; h.st.effects = []; h.st.lateSets = 0; h.st.mounted = true;
  h.st.render = () => {
    h.st.i = 0;
    current = useSimulatorData();
    const fx = h.st.effects; h.st.effects = [];
    fx.forEach((f) => f());
  };
  h.st.render();
}
function unmount() {
  h.st.mounted = false;
  h.st.slots.forEach((s) => s.cleanup?.());
}

type Call = { path: string; signal: AbortSignal };
let calls: Call[];
let handler: (c: Call) => Promise<Response> | Response;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const never = (c: Call) => new Promise<Response>((_, rej) => {
  c.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
});
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
    const c = { path, signal: init.signal as AbortSignal };
    calls.push(c);
    return handler(c);
  });
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('simulator poll cancellation', () => {
  it('unmount aborts in-flight getSimulator and getMap and updates nothing afterwards', async () => {
    handler = (c) => (c.path === '/api/simulator' ? json(simFor('run-1')) : never(c));
    mount();
    await flush();
    const map = calls.find((c) => c.path === '/api/map')!;
    expect(map.signal.aborted).toBe(false);
    handler = never;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const poll = calls.filter((c) => c.path === '/api/simulator').at(-1)!;
    expect(poll.signal.aborted).toBe(false);
    unmount();
    expect(poll.signal.aborted).toBe(true);
    expect(map.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(h.st.lateSets).toBe(0);
    expect(calls.filter((c) => c.path === '/api/simulator')).toHaveLength(2);
  });

  it('aborts an older getMap when a newer runId arrives', async () => {
    let runId = 'run-1';
    handler = (c) => {
      if (c.path === '/api/simulator') return json(simFor(runId));
      if (c.path === '/api/map' && runId === 'run-2') return json(mapFor('run-2'));
      if (c.path === '/api/employees') return json(employeesBody);
      return never(c);
    };
    mount();
    await flush();
    const first = calls.find((c) => c.path === '/api/map')!;
    expect(first.signal.aborted).toBe(false);
    runId = 'run-2';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(first.signal.aborted).toBe(true);
    expect(current.map?.runId).toBe('run-2');
    expect(current.error).toBeNull();
  });

  it('network error keeps the last snapshot and flags reconnecting, then recovers', async () => {
    let down = false;
    handler = (c) => {
      if (down) return Promise.reject(new TypeError('Failed to fetch'));
      return json(c.path === '/api/simulator' ? simFor('run-1') : c.path === '/api/map' ? mapFor('run-1') : employeesBody);
    };
    mount();
    await flush();
    expect(current.sim?.runId).toBe('run-1');
    down = true;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(current.networkError).toBe(true);
    expect(current.error).toBeTruthy();
    expect(current.sim?.runId).toBe('run-1');
    expect(current.map).not.toBeNull();
    down = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(current.networkError).toBe(false);
    expect(current.error).toBeNull();
  });

  it('shows the message of an HTTP 500 and does not call it reconnecting', async () => {
    handler = (c) => (c.path === '/api/simulator' ? json({ error: 'Planner exploded' }, 500) : json({}));
    mount();
    await flush();
    expect(current.error).toBe('Planner exploded');
    expect(current.networkError).toBe(false);
  });

  it('does not overlap polls while one is in flight', async () => {
    handler = never;
    mount();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(calls.filter((c) => c.path === '/api/simulator')).toHaveLength(1);
  });
});
