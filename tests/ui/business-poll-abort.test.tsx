// Hook-level test of the business polls' AbortSignals. There is no DOM in this repo's test setup, so a tiny
// hook runtime stands in for React (useState/useReducer/useRef/useCallback/useEffect only).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';

type Slot = { v?: unknown; deps?: unknown[]; cleanup?: () => void };
const rt = vi.hoisted(() => ({
  slots: [] as Slot[], i: 0, effects: [] as Array<() => void>, rerender: () => {},
}));

vi.mock('react', () => {
  const slot = (): Slot => (rt.slots[rt.i] ??= {});
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const useRef = <T,>(init: T) => { const s = slot(); rt.i++; if (!('v' in s)) s.v = { current: init }; return s.v as { current: T }; };
  const useState = <T,>(init: T) => {
    const s = slot(); rt.i++;
    if (!('v' in s)) s.v = [init, (n: T) => { (s.v as [T, unknown])[0] = n; rt.rerender(); }];
    return s.v as [T, (n: T) => void];
  };
  const useReducer = <S, A>(r: (s: S, a: A) => S, init: S) => {
    const s = slot(); rt.i++;
    if (!('v' in s)) s.v = [init, (a: A) => { (s.v as [S, unknown])[0] = r((s.v as [S, unknown])[0], a); rt.rerender(); }];
    return s.v as [S, (a: A) => void];
  };
  const useMemoLike = <T,>(f: () => T, deps: unknown[]) => {
    const s = slot(); rt.i++;
    if (!same(s.deps, deps)) { s.v = f(); s.deps = deps; }
    return s.v as T;
  };
  const useEffect = (f: () => void | (() => void), deps: unknown[]) => {
    const s = slot(); rt.i++;
    if (same(s.deps, deps)) return;
    s.deps = deps;
    rt.effects.push(() => { s.cleanup?.(); s.cleanup = (f() as (() => void) | undefined); });
  };
  return { useRef, useState, useReducer, useEffect, useCallback: <T,>(f: T, deps: unknown[]) => useMemoLike(() => f, deps), useMemo: useMemoLike, default: {} };
});

const api = vi.hoisted(() => ({
  getBusinessDashboard: vi.fn(), getMap: vi.fn(), getBusinesses: vi.fn(), getEmployees: vi.fn(),
}));
vi.mock('../../client/src/api', async () => {
  const real = await vi.importActual<typeof import('../../client/src/api')>('../../client/src/api');
  return { ...real, ...api };
});

import { ApiRequestError } from '../../client/src/api';
import { useBusinessDashboard } from '../../client/src/components/business/useBusinessDashboard';

const run = createInitialRun(loadDefaultScenario());
const snap = snapshotAt(run, run.scenario.settings.simStartMin);
const [bA, bB] = run.scenario.businesses;
const dashA = businessDashboard(run, snap, bA.id)!;
const dashB = businessDashboard(run, snap, bB.id)!;

type Result = ReturnType<typeof useBusinessDashboard>;
let result: Result;
let id = bA.id;
let unmounted = false;
function render() {
  rt.i = 0;
  result = useBusinessDashboard(id);
  const eff = rt.effects.splice(0);
  eff.forEach((f) => f());
}
rt.rerender = () => { if (!unmounted) render(); };
const unmount = () => { unmounted = true; rt.slots.forEach((s) => s.cleanup?.()); };
const flush = async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); };

/** Request whose promise rejects with an abort error when its signal fires, like the real client. */
const hang = (signal?: AbortSignal) => new Promise<never>((_, rej) => {
  signal?.addEventListener('abort', () => rej(new ApiRequestError(0, 'Request aborted', undefined, 'abort')));
});

beforeEach(() => {
  vi.useFakeTimers();
  rt.slots.length = 0; rt.effects.length = 0; unmounted = false; id = bA.id;
  api.getBusinesses.mockResolvedValue({ businesses: run.scenario.businesses, hubs: run.scenario.hubs });
  api.getEmployees.mockResolvedValue({ employees: run.scenario.employees });
  api.getMap.mockResolvedValue({ runId: 'run-1' });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('business polls are cancellable', () => {
  it('passes a signal to every GET and aborts them all on unmount', async () => {
    api.getBusinessDashboard.mockImplementation((_id: string, o?: { signal?: AbortSignal }) => hang(o?.signal));
    api.getBusinesses.mockImplementation((o?: { signal?: AbortSignal }) => hang(o?.signal));
    render(); await flush();
    const signals = [api.getBusinessDashboard.mock.calls[0][1]?.signal, api.getBusinesses.mock.calls[0][0]?.signal, api.getEmployees.mock.calls[0][0]?.signal];
    signals.forEach((s) => { expect(s).toBeInstanceOf(AbortSignal); expect(s.aborted).toBe(false); });
    unmount(); await flush();
    signals.forEach((s) => expect(s.aborted).toBe(true));
  });

  it('never shows A\'s dashboard after switching to B, even if A resolves late', async () => {
    let resolveA!: (d: unknown) => void;
    api.getBusinessDashboard.mockImplementation((bid: string) =>
      bid === bA.id ? new Promise((r) => { resolveA = r; }) : Promise.resolve(dashB));
    render(); await flush();
    id = bB.id; render(); await flush();
    resolveA(dashA); await flush();
    expect(result.dashboard?.business.id).not.toBe(bA.id);
    expect(result.dashboard?.business.id).toBe(bB.id);
    expect(api.getBusinessDashboard.mock.calls[0][1].signal.aborted).toBe(true);
    unmount();
  });

  it('an aborted request is silent: no error, no Reconnecting', async () => {
    api.getBusinessDashboard.mockImplementation((_i: string, o?: { signal?: AbortSignal }) => hang(o?.signal));
    render(); await flush();
    id = bB.id; render(); await flush();
    expect(result.error).toBeNull();
    expect(result.reconnecting).toBe(false);
    unmount();
  });

  it('a network error keeps the last dashboard with Reconnecting; an HTTP error shows its message', async () => {
    api.getBusinessDashboard.mockResolvedValueOnce(dashA);
    render(); await flush();
    expect(result.dashboard).toBeTruthy();
    api.getBusinessDashboard.mockRejectedValueOnce(new ApiRequestError(0, 'down', undefined, 'network'));
    await vi.advanceTimersByTimeAsync(1100); await flush();
    expect(result.dashboard).toBeTruthy();
    expect(result.reconnecting).toBe(true);
    api.getBusinessDashboard.mockRejectedValueOnce(new ApiRequestError(500, 'Server blew up'));
    await vi.advanceTimersByTimeAsync(1100); await flush();
    expect(result.error).toBe('Server blew up');
    unmount();
  });

  it('a 404 still shows not_found', async () => {
    api.getBusinessDashboard.mockRejectedValue(new ApiRequestError(404, 'Unknown business'));
    render(); await flush();
    expect(result.status).toBe('not_found');
    unmount();
  });

  it('a runId change aborts the old run\'s request before refetching, with no overlap', async () => {
    let inflight = 0; let maxInflight = 0;
    api.getBusinessDashboard.mockImplementation(async () => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await Promise.resolve(); inflight--;
      return { ...dashA, version: dashA.version + api.getBusinessDashboard.mock.calls.length };
    });
    render(); await flush();
    api.getMap.mockResolvedValue({ runId: 'run-2' });
    await vi.advanceTimersByTimeAsync(1100); await flush();
    const calls = api.getBusinessDashboard.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[1][1].signal.aborted).toBe(true);
    expect(calls[2][1].signal.aborted).toBe(false);
    expect(maxInflight).toBe(1);
    expect(result.runId).toBe('run-2');
    unmount();
  });
});
