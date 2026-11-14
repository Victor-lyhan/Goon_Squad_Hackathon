import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, type RequestOptions } from '../../client/src/api/v2';
import type { EmployeeDashboard } from '../../shared/v2/api';
import { createEmployeePoller, type EmployeeWorkspaceApi } from '../../client/src/components/employee/v2/live/employeePoller';
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
};

function fakeApi(): Fake {
  const dashes = new Map<string, EmployeeDashboard | Error>();
  let active = 0;
  const f: Fake = {
    calls: [], maxConcurrent: 0, delayMs: 10, signals: [],
    setDash: (id, d) => { dashes.set(id, d); },
    api: {
      getEmployeeDashboard: (id, opts) => {
        f.calls.push(`dash:${id}`);
        if (opts?.signal) f.signals.push(opts.signal);
        active += 1; f.maxConcurrent = Math.max(f.maxConcurrent, active);
        return abortable(opts, f.delayMs, () => {
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
      getMap: (opts) => { f.calls.push('map'); return abortable(opts, 1, () => ({ runId: 'run-1' })); },
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
