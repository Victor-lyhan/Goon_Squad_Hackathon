import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, type RequestOptions } from '../../client/src/api/v2';
import type { EmployeeDashboard } from '../../shared/v2/api';
import {
  RUN_CHECK_INTERVAL_MS, createEmployeePoller, type EmployeeWorkspaceApi,
} from '../../client/src/components/employee/v2/live/employeePoller';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import {
  COMMUTE_SAVE_TIMEOUT_MS, ownedWorkspaceReducer, saveCommuteWith,
} from '../../client/src/components/employee/v2/live/useEmployeeWorkspace';
import { dash, jobResponse } from './employeeV2DataSample';

const abortable = <T>(opts: RequestOptions | undefined, ms: number, value: () => T | Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { Promise.resolve().then(value).then(resolve, reject); }, ms);
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiRequestError(0, 'Request aborted', undefined, 'abort'));
    });
  });

type Fake = {
  api: EmployeeWorkspaceApi;
  calls: string[];
  maxConcurrent: number;
  setDash: (id: string, d: EmployeeDashboard | Error) => void;
  delayMs: number;
  signals: AbortSignal[];
  /** true: every dashboard request answers with a higher version (the simulator is playing). */
  rising: boolean;
  /** What the map answers when a request ends: a run ID, or the error it fails with. */
  mapRun: string | Error;
  mapMs: number;
  mapPending: number;
};

function fakeApi(): Fake {
  const dashes = new Map<string, EmployeeDashboard | Error>();
  let active = 0;
  const f: Fake = {
    calls: [], maxConcurrent: 0, delayMs: 10, signals: [],
    rising: false, mapRun: 'run-1', mapMs: 1, mapPending: 0,
    setDash: (id, d) => { dashes.set(id, d); },
    api: {
      getEmployeeDashboard: (id, opts) => {
        f.calls.push(`dash:${id}`);
        if (opts?.signal) f.signals.push(opts.signal);
        active += 1; f.maxConcurrent = Math.max(f.maxConcurrent, active);
        const nth = f.calls.filter((c) => c === `dash:${id}`).length;
        return abortable(opts, f.delayMs, () => {
          if (f.rising) return dash(nth, []);
          const d = dashes.get(id);
          if (!d) throw new ApiRequestError(404, 'Unknown employee');
          if (d instanceof Error) throw d;
          return d;
        }).finally(() => { active -= 1; });
      },
      getJob: (id, opts) => {
        f.calls.push(`job:${id}`);
        return abortable(opts, f.delayMs, () => {
          if (id === 'job-gone') throw new ApiRequestError(404, 'Unknown job');
          return jobResponse(id);
        });
      },
      getBusinesses: (opts) => { f.calls.push('businesses'); return abortable(opts, 1, () => ({ businesses: [] })); },
      getEmployees: (opts) => {
        f.calls.push('employees');
        return abortable(opts, 1, () => ({ employees: [{ id: 'emp-07' }] as never }));
      },
      getMap: (opts) => {
        f.calls.push('map');
        f.mapPending += 1;
        return abortable(opts, f.mapMs, () => {
          if (f.mapRun instanceof Error) throw f.mapRun;
          return { runId: f.mapRun };
        }).finally(() => { f.mapPending -= 1; });
      },
    },
  };
  return f;
}

function sinkState() {
  let state: EmployeeWorkspaceState = initialWorkspaceState;
  const actions: WorkspaceAction[] = [];
  return {
    sink: { dispatch: (a: WorkspaceAction) => { actions.push(a); state = employeeWorkspaceReducer(state, a); } },
    get: () => state,
    actions,
  };
}

const count = (f: Fake, call: string) => f.calls.filter((c) => c === call).length;
type DashboardAction = Extract<WorkspaceAction, { type: 'dashboard' }>;
const dashboards = (actions: WorkspaceAction[]) => actions.filter((a): a is DashboardAction => a.type === 'dashboard');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('employee v2 poller', () => {
  it('polls once per second and shows the first dashboard', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(1, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('ready');
    expect(count(f, 'businesses')).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(f, 'dash:emp-01')).toBe(4);
    expect(count(f, 'businesses')).toBe(1);
    expect(count(f, 'map')).toBe(1); // run checked only when the version moves
    p.stop();
  });

  it('flags a delivery that appears in a later poll, without a manual refresh', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(1, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    f.setDash('emp-01', dash(2, ['job-1', 'job-2']));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().newJobIds).toEqual(['job-2']);
    // #597: the delivery shows without a run check; the check follows within 5 s of the first one.
    expect(count(f, 'map')).toBe(1);
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS);
    expect(count(f, 'map')).toBe(2);
    p.stop();
  });

  it('never overlaps requests when one takes 2.5 s', async () => {
    const f = fakeApi();
    f.delayMs = 2500;
    f.setDash('emp-01', dash(1, []));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.maxConcurrent).toBe(1);
    // 2.5 s request + 1 s wait: ticks at 0, ~3.5, ~7 s.
    expect(count(f, 'dash:emp-01')).toBe(3);
    // refetchNow while a poll is in flight queues one more poll after it instead of overlapping.
    await vi.advanceTimersByTimeAsync(600); // the tick at ~10.5 s is now in flight
    const before = count(f, 'dash:emp-01');
    const done = vi.fn();
    void p.refetchNow().then(done);
    expect(count(f, 'dash:emp-01')).toBe(before);
    await vi.advanceTimersByTimeAsync(5100);
    expect(done).toHaveBeenCalled();
    expect(count(f, 'dash:emp-01')).toBe(before + 1);
    expect(f.maxConcurrent).toBe(1);
    p.stop();
  });

  it('stop() aborts the request in flight and nothing reaches the sink after it', async () => {
    const f = fakeApi();
    f.delayMs = 500;
    f.setDash('emp-01', dash(1, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(100);
    p.stop();
    expect(f.signals.every((sig) => sig.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.actions).toEqual([]);
    expect(count(f, 'dash:emp-01')).toBe(1);
  });

  it('drops a late response for the previous employee ID', async () => {
    const f = fakeApi();
    f.delayMs = 800;
    f.setDash('emp-01', dash(1, ['job-a']));
    f.setDash('emp-02', dash(5, ['job-b'], 'emp-02'));
    let owned = { owner: 'emp-01', state: initialWorkspaceState };
    const make = (id: string) => createEmployeePoller(id, f.api, {
      dispatch: (action) => { owned = ownedWorkspaceReducer(owned, { owner: id, action }); },
    });
    const a = make('emp-01');
    a.start();
    await vi.advanceTimersByTimeAsync(300);
    a.stop(); // the hook stops the old poller when the employee ID changes
    const b = make('emp-02');
    b.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(owned.owner).toBe('emp-02');
    expect(owned.state.dashboard?.employee.id).toBe('emp-02');
    expect(owned.state.newJobIds).toEqual([]);
    b.stop();
  });

  it('a 404 shows not_found with the first valid employee ID', async () => {
    const f = fakeApi();
    const s = sinkState();
    const p = createEmployeePoller('emp-99', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('not_found');
    expect(s.get().fallbackEmployeeId).toBe('emp-07');
    p.stop();
  });

  it('a network error after the first success keeps the data and reconnects', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(1, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    f.setDash('emp-01', new ApiRequestError(0, 'Failed to fetch', undefined, 'network'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().reconnecting).toBe(true);
    expect(s.get().dashboard?.version).toBe(1);
    f.setDash('emp-01', dash(1, ['job-1']));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().reconnecting).toBe(false);
    p.stop();
  });

  it('fetches the watched job with each tick; a 404 sets jobMissing', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(1, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.watchJob('job-1');
    p.start();
    await vi.advanceTimersByTimeAsync(2050);
    expect(count(f, 'job:job-1')).toBe(3);
    expect(s.get().job?.job.id).toBe('job-1');
    p.watchJob('job-gone');
    expect(s.get().job).toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().jobMissing).toBe(true);
    p.watchJob(null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.get().jobMissing).toBe(false);
    expect(count(f, 'job:job-gone')).toBe(1);
    p.stop();
  });

  it('refetchNow() after a save polls at once', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(1, []));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    const before = count(f, 'dash:emp-01');
    const put = vi.fn(async () => ({ employee: dash(2, []).employee, home: dash(2, []).home, trips: [], rematchedShipmentIds: [] }));
    f.setDash('emp-01', dash(2, ['job-new']));
    const res = await saveCommuteWith({ putCommute: put }, 'emp-01', {} as never, p.refetchNow);
    expect(res.rematchedShipmentIds).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(count(f, 'dash:emp-01')).toBe(before + 1);
    expect(s.get().newJobIds).toEqual(['job-new']);
    p.stop();
  });
});

describe('employee v2 poller: run check (#597)', () => {
  it('a version that rises with every poll for 10 s gives at most 3 map requests and 10 dashboards', async () => {
    const f = fakeApi();
    f.rising = true;
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    const sent = dashboards(s.actions);
    expect(count(f, 'map')).toBeLessThanOrEqual(3);
    expect(count(f, 'map')).toBeGreaterThanOrEqual(2); // the first poll and one check during the 10 s
    expect(sent.length).toBeGreaterThanOrEqual(10);
    expect(sent.length).toBe(count(f, 'dash:emp-01')); // every dashboard that arrived was shown
    expect(sent.map((a) => a.dashboard.version)).toEqual(sent.map((_, i) => i + 1));
    expect(sent.every((a) => a.runId === 'run-1')).toBe(true);
    expect(s.get().dashboard?.version).toBe(sent.length);
    expect(count(f, 'businesses')).toBe(1);
    p.stop();
  });

  it('dispatches a dashboard while a map request is still pending', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(1, []));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS + 100);
    expect(count(f, 'map')).toBe(1);
    f.mapMs = 4000; // the whole set of route lines takes a while
    f.setDash('emp-01', dash(2, ['job-1']));
    await vi.advanceTimersByTimeAsync(1100);
    expect(count(f, 'map')).toBe(2);
    expect(f.mapPending).toBe(1);
    expect(s.get().dashboard?.version).toBe(2);
    f.setDash('emp-01', dash(3, ['job-1', 'job-2']));
    await vi.advanceTimersByTimeAsync(1100);
    expect(f.mapPending).toBe(1);
    expect(s.get().dashboard?.version).toBe(3);
    expect(s.get().newJobIds).toEqual(['job-1', 'job-2']);
    expect(count(f, 'map')).toBe(2);
    p.stop();
  });

  it('one version change followed by silence still gives one check; another run reaches the next dispatch', async () => {
    const f = fakeApi();
    f.setDash('emp-01', dash(7, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    // Random city: a new run, whose dashboard has another version.
    f.mapRun = 'run-2';
    f.setDash('emp-01', dash(1, ['job-9']));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.get().dashboard?.version).toBe(1); // shown at once, with the last known run
    expect(dashboards(s.actions).at(-1)?.runId).toBe('run-1');
    expect(count(f, 'map')).toBe(1);
    expect(count(f, 'businesses')).toBe(1);
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS); // the check, then the next poll
    expect(count(f, 'map')).toBe(2);
    expect(dashboards(s.actions).at(-1)?.runId).toBe('run-2');
    expect(s.get().baseline?.runId).toBe('run-2');
    expect(s.get().runChanged).toBe(true);
    expect(count(f, 'businesses')).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000); // silence: no further check, no further reload
    expect(count(f, 'map')).toBe(2);
    expect(count(f, 'businesses')).toBe(2);
    p.stop();
  });

  it('a failed check keeps the run ID and is repeated 5 s later', async () => {
    const f = fakeApi();
    f.mapRun = new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
    f.setDash('emp-01', dash(1, ['job-1']));
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('ready'); // a failed map request leaves the page working
    expect(dashboards(s.actions).at(-1)?.runId).toBeNull();
    await vi.advanceTimersByTimeAsync(4000);
    expect(count(f, 'map')).toBe(1);
    f.mapRun = 'run-1';
    await vi.advanceTimersByTimeAsync(2000);
    expect(count(f, 'map')).toBe(2);
    expect(dashboards(s.actions).at(-1)?.runId).toBe('run-1');
    // Later: the version moves once and that check fails; the one after it finds the new run.
    f.mapRun = new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
    f.setDash('emp-01', dash(2, ['job-1']));
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS + 100);
    expect(count(f, 'map')).toBe(3);
    expect(dashboards(s.actions).at(-1)?.runId).toBe('run-1');
    f.mapRun = 'run-2';
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS + 1100);
    expect(count(f, 'map')).toBe(4);
    expect(s.get().baseline?.runId).toBe('run-2');
    expect(count(f, 'businesses')).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(count(f, 'map')).toBe(4);
    p.stop();
  });

  it('stop() leaves nothing running: no timer, no request, no dispatch', async () => {
    const f = fakeApi();
    f.rising = true;
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS);
    f.mapMs = 4000;
    await vi.advanceTimersByTimeAsync(1500); // a slow check is pending and its 5 s wait is running
    expect(f.mapPending).toBe(1);
    const calls = f.calls.length;
    const actions = s.actions.length;
    p.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.mapPending).toBe(0);
    expect(f.calls.length).toBe(calls);
    expect(s.actions.length).toBe(actions);
    expect(vi.getTimerCount()).toBe(0);

    // Stopped between polls, with only the two waits running.
    const g = fakeApi();
    g.rising = true;
    const q = createEmployeePoller('emp-01', g.api, sinkState().sink);
    q.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(2);
    q.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('saveCommute', () => {
  it('uses the long timeout, returns the response and refetches', async () => {
    const response = { employee: dash(1, []).employee, home: dash(1, []).home, trips: [], rematchedShipmentIds: ['shp-1'] };
    const put = vi.fn(async (_id: string, _req: unknown, _opts?: RequestOptions) => response);
    const refetch = vi.fn(async () => {});
    const req = { businessId: 'biz-a', home: { homeId: 'home-001' } } as never;
    expect(await saveCommuteWith({ putCommute: put }, 'emp-01', req, refetch)).toBe(response);
    expect(COMMUTE_SAVE_TIMEOUT_MS).toBe(20000);
    expect(put).toHaveBeenCalledWith('emp-01', req, { timeoutMs: 20000 });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('rethrows errors unchanged and does not refetch', async () => {
    const err = new ApiRequestError(409, 'Run is locked');
    const refetch = vi.fn(async () => {});
    await expect(saveCommuteWith({ putCommute: async () => { throw err; } }, 'emp-01', {} as never, refetch)).rejects.toBe(err);
    const busy = new ApiRequestError(503, 'Google down', undefined, 'http', 'google_unavailable');
    await expect(saveCommuteWith({ putCommute: async () => { throw busy; } }, 'emp-01', {} as never, refetch)).rejects.toBe(busy);
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('employee v2 data folder rules', () => {
  const dir = join(__dirname, '../../client/src/components/employee/v2/live');
  const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
  it.each(files)('%s imports only the v2 API, no localStorage, no "hub"', (name) => {
    const src = readFileSync(join(dir, name), 'utf8');
    expect(src).not.toMatch(/api\/client['"]/);
    expect(src).not.toMatch(/from ['"](\.\.\/)+api['"]/);
    expect(src).not.toMatch(/api\/index/);
    expect(src).not.toMatch(/localStorage/);
    expect(src.toLowerCase()).not.toContain('hub');
  });
  it('has the three files', () => {
    expect(files.sort()).toEqual(['employeePoller.ts', 'employeeWorkspaceState.ts', 'useEmployeeWorkspace.ts']);
  });
});
