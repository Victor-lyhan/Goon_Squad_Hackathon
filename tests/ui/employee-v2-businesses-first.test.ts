// #712: the Employee page keeps its loading view until the business list has arrived once, so a first
// paint never reads "Unknown place" for a place whose name is on its way. Proven with the real reducer,
// and with the real poller over a fake API for the failed and the reloaded business request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, type RequestOptions } from '../../client/src/api/v2';
import type { NetworkBusiness } from '../../shared/v2/types';
import { UNKNOWN_PLACE, commuteSummary } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import {
  RUN_CHECK_INTERVAL_MS, createEmployeePoller, type EmployeeWorkspaceApi,
} from '../../client/src/components/employee/v2/live/employeePoller';
import {
  employeeWorkspaceReducer as reduce, initialWorkspaceState as init,
  type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { pageScreen } from '../../client/src/components/employee/v2/page/employeePageModel';
import { dash, jobResponse } from './employeeV2DataSample';

const biz = (id: string, name: string) => ({ id, name, neighborhood: 'Astoria' }) as NetworkBusiness;
const OLD = [biz('biz-a', 'Acme Studio'), biz('biz-b', 'Cafe Luna')];
const NEW = [biz('biz-a', 'Harbor Print'), biz('biz-b', 'Pier Books')];

const run = (actions: WorkspaceAction[], from: EmployeeWorkspaceState = init) => actions.reduce(reduce, from);
const ok = (version: number, ids: string[], runId: string | null = 'run-1'): WorkspaceAction =>
  ({ type: 'dashboard', dashboard: dash(version, ids), runId });
const list = (businesses: NetworkBusiness[]): WorkspaceAction => ({ type: 'businesses', businesses });
const fail = (error: unknown): WorkspaceAction => ({ type: 'dashboardFailed', error });
const network = () => new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
const travel = () => new ApiRequestError(503, 'no cache', undefined, 'http', 'travel_data_missing');

describe('employee workspace state: the first business list (#712)', () => {
  it('a dashboard before any business list is kept, and the view stays loading', () => {
    const s = reduce(init, ok(1, ['job-1']));
    expect(s.view).toBe('loading');
    expect(s.dashboard?.version).toBe(1);
    expect(s.businessesLoaded).toBe(false);
    expect(pageScreen(s, null)).toEqual({ kind: 'loading' });
    expect(pageScreen(s, 'job-1')).toEqual({ kind: 'loading' });
    // What the page would have said without the wait.
    expect(commuteSummary(s.dashboard!, s.businesses).workplaceName).toBe(UNKNOWN_PLACE);
  });

  it('the first business list then gives the view the dashboard would have given', () => {
    const waiting = reduce(init, ok(1, ['job-1']));
    const s = reduce(waiting, list(OLD));
    expect(s.view).toBe('ready');
    expect(s.dashboard).toBe(waiting.dashboard);
    expect(pageScreen(s, null)).toEqual({ kind: 'workspace' });
    expect(commuteSummary(s.dashboard!, s.businesses).workplaceName).toBe('Acme Studio');
    // The same state as the other order of the two answers.
    expect(s).toEqual(run([list(OLD), ok(1, ['job-1'])]));
  });

  it('the reverse order behaves as before: the list alone shows nothing, the dashboard shows at once', () => {
    const listed = reduce(init, list(OLD));
    expect(listed.view).toBe('loading');
    expect(listed.dashboard).toBeNull();
    const s = reduce(listed, ok(1, ['job-1']));
    expect(s.view).toBe('ready');
    expect(reduce(s, ok(1, ['job-1']))).toBe(s); // an equal poll is still the same object
  });

  it('an empty business list counts as arrived', () => {
    expect(run([ok(1, []), list([])]).view).toBe('ready');
  });

  it('while waiting: an equal poll is the same object, and a job that arrives is not "New" on first paint', () => {
    const waiting = reduce(init, ok(1, ['job-1']));
    expect(reduce(waiting, ok(1, ['job-1']))).toBe(waiting);
    const s = run([ok(2, ['job-1', 'job-2']), list(OLD)], waiting);
    expect(s.view).toBe('ready');
    expect(s.dashboard?.version).toBe(2);
    expect(s.newJobIds).toEqual([]);
    expect(s.runChanged).toBe(false);
    // From then on the highlight works as before.
    expect(reduce(s, ok(3, ['job-1', 'job-2', 'job-3'])).newJobIds).toEqual(['job-3']);
  });

  it('a job answer while waiting is kept and shows with the first list', () => {
    const s = run([ok(1, ['job-1']), { type: 'job', job: jobResponse('job-1') }]);
    expect(pageScreen(s, 'job-1')).toEqual({ kind: 'loading' });
    expect(pageScreen(reduce(s, list(OLD)), 'job-1')).toEqual({ kind: 'job' });
  });

  it('after the first list, a run change does not go back to loading: the old names stay until the new list', () => {
    const shown = run([ok(5, ['job-1']), list(OLD)]);
    const changed = reduce(shown, ok(1, ['job-9'], 'run-2'));
    expect(changed.view).toBe('ready');
    expect(changed.runChanged).toBe(true);
    expect(changed.businessesLoaded).toBe(true);
    expect(changed.businesses).toBe(shown.businesses);
    expect(pageScreen(changed, null)).toEqual({ kind: 'workspace' });
    const reloaded = reduce(changed, list(NEW));
    expect(reloaded.view).toBe('ready');
    expect(commuteSummary(reloaded.dashboard!, reloaded.businesses).workplaceName).toBe('Harbor Print');
  });

  it('not_found and unavailable are not delayed by a missing business list', () => {
    expect(reduce(init, { type: 'notFound', fallbackEmployeeId: 'emp-07' }).view).toBe('not_found');
    expect(reduce(init, fail(new ApiRequestError(404, 'Unknown employee'))).view).toBe('not_found');
    expect(reduce(init, fail(travel())).view).toBe('unavailable');
    expect(reduce(init, fail(network())).view).toBe('error');
    // Also when a dashboard was already waiting for the list.
    const waiting = reduce(init, ok(1, ['job-1']));
    expect(reduce(waiting, { type: 'notFound', fallbackEmployeeId: null }).view).toBe('not_found');
    expect(reduce(waiting, fail(travel())).view).toBe('unavailable');
    expect(reduce(waiting, fail(network())).view).toBe('error');
  });

  it('a late list does not replace a not_found, unavailable or error view; the next dashboard shows', () => {
    for (const problem of [
      reduce(init, { type: 'notFound', fallbackEmployeeId: 'emp-07' }),
      run([ok(1, []), fail(travel())]),
      run([ok(1, []), fail(network())]),
    ]) {
      const s = reduce(problem, list(OLD));
      expect(s.view).toBe(problem.view);
      expect(reduce(s, ok(2, [])).view).toBe('ready');
    }
  });

  it('not_found keeps the fact that the list arrived, so a later dashboard is not stuck on loading', () => {
    const s = run([ok(1, []), list(OLD), { type: 'notFound', fallbackEmployeeId: 'emp-07' }]);
    expect(s.businessesLoaded).toBe(true);
    expect(reduce(s, ok(1, [])).view).toBe('ready');
  });
});

// ---------- The real poller over a fake API ----------

const abortable = <T>(opts: RequestOptions | undefined, ms: number, value: () => T) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { try { resolve(value()); } catch (e) { reject(e); } }, ms);
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiRequestError(0, 'Request aborted', undefined, 'abort'));
    });
  });

function fakeApi() {
  const f = {
    calls: [] as string[],
    version: 1,
    mapRun: 'run-1',
    /** What the business request answers when it ends. */
    businesses: OLD as NetworkBusiness[] | Error,
    businessesMs: 1,
    api: {
      getEmployeeDashboard: (_id, opts) => { f.calls.push('dash'); return abortable(opts, 10, () => dash(f.version, ['job-1'])); },
      getJob: (id, opts) => abortable(opts, 10, () => jobResponse(id)),
      getBusinesses: (opts) => {
        f.calls.push('businesses');
        return abortable(opts, f.businessesMs, () => {
          if (f.businesses instanceof Error) throw f.businesses;
          return { businesses: f.businesses };
        });
      },
      getEmployees: (opts) => abortable(opts, 1, () => ({ employees: [] })),
      getMap: (opts) => { f.calls.push('map'); return abortable(opts, 1, () => ({ runId: f.mapRun })); },
    } as EmployeeWorkspaceApi,
  };
  return f;
}

function sinkState() {
  let state = init;
  const views: string[] = [];
  return {
    sink: { dispatch: (a: WorkspaceAction) => { state = reduce(state, a); views.push(state.view); } },
    get: () => state,
    /** The view after every action the poller sent. */
    views,
  };
}

const count = (f: { calls: string[] }, call: string) => f.calls.filter((c) => c === call).length;

describe('employee v2 poller: the first business list (#712)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('the first poll is never ready before the list is in', async () => {
    const f = fakeApi();
    f.businessesMs = 400;
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(200); // the dashboard is in, the list is not
    expect(s.get().dashboard?.version).toBe(1);
    expect(s.get().view).toBe('loading');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.get().view).toBe('ready');
    expect(s.get().businesses).toBe(OLD);
    expect(s.views).toEqual(['loading', 'ready']);
    p.stop();
  });

  it('a failed business request keeps the loading view and is asked again on the next tick', async () => {
    const f = fakeApi();
    f.businesses = new ApiRequestError(500, 'Internal server error');
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(2500); // three ticks, three failed lists
    expect(count(f, 'dash')).toBe(3);
    expect(count(f, 'businesses')).toBe(3);
    expect(s.get().view).toBe('loading');
    expect(s.get().dashboard).not.toBeNull();
    f.businesses = OLD;
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(f, 'businesses')).toBe(4);
    expect(s.get().view).toBe('ready');
    expect(s.get().businesses).toBe(OLD);
    await vi.advanceTimersByTimeAsync(3000); // and it is not asked again
    expect(count(f, 'businesses')).toBe(4);
    p.stop();
  });

  it('a run change reloads the list without a loading view; the old names stay until the new list', async () => {
    const f = fakeApi();
    const s = sinkState();
    const p = createEmployeePoller('emp-01', f.api, s.sink);
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.get().view).toBe('ready');
    const firstReady = s.views.length;

    // Random city: another run, a slow and at first failing business request.
    f.mapRun = 'run-2';
    f.version = 9;
    f.businesses = new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
    await vi.advanceTimersByTimeAsync(RUN_CHECK_INTERVAL_MS + 2000);
    expect(s.get().baseline?.runId).toBe('run-2');
    expect(s.get().runChanged).toBe(true);
    expect(count(f, 'businesses')).toBeGreaterThan(1);
    expect(s.get().view).toBe('ready');
    expect(s.get().businesses).toBe(OLD);

    f.businesses = NEW;
    f.businessesMs = 300;
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.get().businesses).toBe(NEW);
    expect(s.views.slice(firstReady - 1).every((v) => v === 'ready')).toBe(true);
    p.stop();
  });
});
