import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployeeDashboard } from '../../shared/api';
import { apiConfig, DEFAULT_TIMEOUT_MS } from '../../client/src/api';
import { createDashboardPoller, type PollerSink } from '../../client/src/components/employee/dashboardPoller';
import { dashReducer, initialDashState, isReconnecting, type DashAction, type DashState } from '../../client/src/components/employee/dashboardState';
import { freshOwned, ownedReducer } from '../../client/src/components/employee/useEmployeeDashboard';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';

const run = createInitialRun(loadDefaultScenario());
const snap = snapshotAt(run, run.scenario.settings.simStartMin);
const dashes = run.scenario.employees
  .map((e) => employeeDashboard(run, snap, e.id)!)
  .filter((d) => d.assigned.length > 0);
const [A, B] = [dashes[0], dashes[1]];
const ids = (d: EmployeeDashboard) => d.assigned.map((v) => v.job.id);

type Pending = { url: string; signal: AbortSignal; resolve: (body: unknown) => void; reject: (e: unknown) => void };
let pending: Pending[] = [];
let calls: string[] = [];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers();
  pending = []; calls = [];
  vi.stubGlobal('fetch', (url: string, init?: { signal?: AbortSignal }) => new Promise<Response>((resolve, reject) => {
    calls.push(url);
    const signal = init!.signal!;
    const p: Pending = { url, signal, resolve: (b) => resolve(json(b)), reject };
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    pending.push(p);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); apiConfig.timeoutMs = DEFAULT_TIMEOUT_MS; });

const flush = () => vi.advanceTimersByTimeAsync(0);
const dashReq = (id: string) => pending.filter((p) => p.url.includes(`/employees/${id}/dashboard`));
const answerStatic = async () => {
  for (const p of pending.filter((q) => q.url === '/api/map' || q.url === '/api/businesses')) {
    p.resolve(p.url === '/api/map' ? { runId: 'run-1' } : { businesses: [], hubs: [] });
  }
  await flush();
};

function recorder() {
  const log: { kind: string; ids?: string[]; newIds?: string[]; action?: DashAction }[] = [];
  let dash: DashState = initialDashState;
  const sink: PollerSink = {
    dispatch: (action) => { dash = dashReducer(dash, action); log.push({ kind: 'dispatch', action }); },
    onStatic: () => log.push({ kind: 'static' }),
    onRunChanged: () => log.push({ kind: 'runChanged' }),
    onPoll: (d, newIds) => log.push({ kind: 'poll', ids: ids(d), newIds }),
  };
  return { sink, log, state: () => dash };
}

describe('employee poll abort', () => {
  it('uses two real Demo employees with different jobs', () => {
    expect(A.employee.id).not.toBe(B.employee.id);
    expect(ids(A).some((id) => ids(B).includes(id))).toBe(false);
  });

  it('unmount mid-request aborts the dashboard call and dispatches nothing', async () => {
    const r = recorder();
    const p = createDashboardPoller(A.employee.id, r.sink);
    p.start();
    await flush();
    expect(dashReq(A.employee.id)).toHaveLength(1);
    const req = dashReq(A.employee.id)[0];
    p.stop();
    expect(req.signal.aborted).toBe(true);
    req.resolve(A); // a late answer is ignored
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.log).toEqual([]);
    expect(calls).toHaveLength(1); // no further polls
  });

  it('unmount also aborts the map and businesses requests', async () => {
    const r = recorder();
    const p = createDashboardPoller(A.employee.id, r.sink);
    p.start();
    await flush();
    dashReq(A.employee.id)[0].resolve(A);
    await flush(); // first poll succeeds and starts loading the map + businesses
    const statics = pending.filter((q) => q.url === '/api/map' || q.url === '/api/businesses');
    expect(statics).toHaveLength(2);
    p.stop();
    expect(statics.every((q) => q.signal.aborted)).toBe(true);
    const before = r.log.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.log).toHaveLength(before);
    expect(r.state().error).toBeNull(); // aborts are not failures
  });

  it('A -> B mid-request: A never shows under B and B flags nothing New', async () => {
    const a = recorder();
    const pa = createDashboardPoller(A.employee.id, a.sink);
    pa.start();
    await flush();
    const reqA = dashReq(A.employee.id)[0];

    // Hook-level state: the switch makes the reducer drop everything from A.
    let owned = ownedReducer(freshOwned(A.employee.id), { owner: A.employee.id, kind: 'dash', action: { type: 'success', dash: A, runId: 'run-1' } });
    expect(owned.dash.dash).toBe(A);
    owned = ownedReducer(owned, { owner: B.employee.id, kind: 'dash', action: { type: 'reset' } });
    expect(owned.dash.dash).toBeNull();

    pa.stop(); // identity switch
    expect(reqA.signal.aborted).toBe(true);
    const b = recorder();
    const pb = createDashboardPoller(B.employee.id, b.sink);
    pb.start();
    await flush();
    reqA.resolve(A); // A answers late
    await flush();
    const reqB = dashReq(B.employee.id)[0];
    reqB.resolve(B);
    await flush();
    await answerStatic();

    for (const e of b.log) {
      expect(JSON.stringify(e)).not.toMatch(new RegExp(ids(A).join('|')));
    }
    expect(b.state().dash).toEqual(B);
    const polls = b.log.filter((e) => e.kind === 'poll');
    expect(polls).toHaveLength(1);
    expect(polls[0].newIds).toEqual([]); // first load flags nothing
    expect(a.log).toEqual([]);

    // Late events from A reaching the hook are dropped.
    const late = ownedReducer(owned, { owner: A.employee.id, kind: 'dash', action: { type: 'success', dash: A, runId: 'run-1' } });
    expect(late.dash.dash).toBeNull();
    pb.stop();
  });

  it('network error keeps data and shows Reconnecting, then recovers; polls never overlap', async () => {
    const r = recorder();
    const p = createDashboardPoller(A.employee.id, r.sink);
    p.start();
    await flush();
    dashReq(A.employee.id)[0].resolve(A);
    await flush();
    await answerStatic();
    expect(r.state().dash).toEqual(A);

    await vi.advanceTimersByTimeAsync(1000); // second poll goes out
    expect(dashReq(A.employee.id)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000); // still pending: no overlapping request
    expect(dashReq(A.employee.id)).toHaveLength(2);
    dashReq(A.employee.id)[1].reject(new TypeError('Failed to fetch'));
    await flush();
    expect(r.state().dash).toEqual(A);
    expect(isReconnecting(r.state())).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    dashReq(A.employee.id)[2].resolve(A);
    await flush();
    expect(isReconnecting(r.state())).toBe(false);
    expect(r.state().error).toBeNull();
    p.stop();
  });

  it('a timeout counts as a network error (Reconnecting), not as an abort', async () => {
    apiConfig.timeoutMs = 50;
    const r = recorder();
    const p = createDashboardPoller(A.employee.id, r.sink);
    p.start();
    await flush();
    dashReq(A.employee.id)[0].resolve(A);
    await flush();
    await answerStatic();
    await vi.advanceTimersByTimeAsync(1000); // second poll; never answered
    await vi.advanceTimersByTimeAsync(60);
    expect(r.state().dash).toEqual(A);
    expect(isReconnecting(r.state())).toBe(true);
    p.stop();
  });
});
