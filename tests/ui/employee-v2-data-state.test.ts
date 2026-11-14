import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  employeeWorkspaceReducer as reduce, initialWorkspaceState as init, TRAVEL_DATA_MISSING_TEXT,
  type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { dash, jobResponse } from './employeeV2DataSample';

// The business list has arrived (#712): a dashboard shows at once. The order of the two is tested in
// employee-v2-businesses-first.test.ts.
const listed = reduce(init, { type: 'businesses', businesses: [] });
const run = (actions: WorkspaceAction[], from: EmployeeWorkspaceState = listed) => actions.reduce(reduce, from);
const ok = (version: number, ids: string[], runId: string | null = 'run-1', emp = 'emp-01'): WorkspaceAction =>
  ({ type: 'dashboard', dashboard: dash(version, ids, emp), runId });
const fail = (error: unknown): WorkspaceAction => ({ type: 'dashboardFailed', error });
const travel = (code: string, message: string) => new ApiRequestError(503, message, undefined, 'http', code);
const network = () => new ApiRequestError(0, 'Failed to fetch', undefined, 'network');

describe('employee workspace state: new-delivery highlight', () => {
  it('first load flags no new jobs', () => {
    const s = run([ok(1, ['job-1', 'job-2'])]);
    expect(s.view).toBe('ready');
    expect(s.newJobIds).toEqual([]);
  });

  it('flags a job added by a later poll once', () => {
    const s = run([ok(1, ['job-1']), ok(2, ['job-1', 'job-2'])]);
    expect(s.newJobIds).toEqual(['job-2']);
    const s2 = run([ok(3, ['job-1', 'job-2']), ok(4, ['job-1', 'job-2'])], s);
    expect(s2.newJobIds).toEqual(['job-2']);
    expect(run([{ type: 'seen', jobId: 'job-2' }], s2).newJobIds).toEqual([]);
  });

  it('a seen job does not come back as new', () => {
    const s = run([ok(1, ['job-1']), ok(2, ['job-1', 'job-2']), { type: 'seen', jobId: 'job-2' }, ok(3, ['job-1', 'job-2'])]);
    expect(s.newJobIds).toEqual([]);
  });

  it('an equal poll (same version) returns the same state object', () => {
    const s = run([ok(1, ['job-1'])]);
    expect(reduce(s, ok(1, ['job-1']))).toBe(s);
  });

  it('a run change resets the highlight and the baseline', () => {
    const s = run([ok(1, ['job-1']), ok(2, ['job-1', 'job-2'])]);
    const s2 = reduce(s, ok(3, ['job-9', 'job-8'], 'run-2'));
    expect(s2.newJobIds).toEqual([]);
    expect(s2.runChanged).toBe(true);
    expect(reduce(s2, ok(4, ['job-9', 'job-8', 'job-7'], 'run-2')).newJobIds).toEqual(['job-7']);
  });

  it('another employee ID resets the baseline', () => {
    const s = run([ok(1, ['job-1']), ok(2, ['job-2', 'job-3'], 'run-1', 'emp-02')]);
    expect(s.newJobIds).toEqual([]);
    expect(run([{ type: 'reset' }], s)).toBe(init);
  });
});

describe('employee workspace state: failures', () => {
  it('404 shows not_found with a valid employee to link to', () => {
    const s = run([ok(1, ['job-1']), { type: 'notFound', fallbackEmployeeId: 'emp-03' }]);
    expect(s.view).toBe('not_found');
    expect(s.fallbackEmployeeId).toBe('emp-03');
    expect(s.dashboard).toBeNull();
    expect(reduce(s, { type: 'notFound', fallbackEmployeeId: 'emp-03' })).toBe(s);
    expect(reduce(init, fail(new ApiRequestError(404, 'Unknown employee'))).view).toBe('not_found');
  });

  it('travel_data_missing shows the fixed text, the other codes the server text, and recovers', () => {
    const missing = reduce(listed, fail(travel('travel_data_missing', 'no cache')));
    expect(missing.view).toBe('unavailable');
    expect(missing.unavailable).toEqual({ code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT });
    expect(TRAVEL_DATA_MISSING_TEXT).toBe('NYC travel data is not loaded on this server yet.');
    for (const code of ['google_key_missing', 'google_unavailable']) {
      const s = reduce(init, fail(travel(code, `Server says ${code}`)));
      expect(s.view).toBe('unavailable');
      expect(s.unavailable).toEqual({ code, message: `Server says ${code}` });
    }
    const back = reduce(missing, ok(1, ['job-1']));
    expect(back.view).toBe('ready');
    expect(back.unavailable).toBeNull();
    expect(back.newJobIds).toEqual([]);
  });

  it('a 503 after the first success keeps the data and reconnects', () => {
    const s = run([ok(1, ['job-1']), fail(travel('google_unavailable', 'Google is down'))]);
    expect(s.view).toBe('ready');
    expect(s.dashboard?.version).toBe(1);
    expect(s.reconnecting).toBe(true);
    expect(s.unavailable?.message).toBe('Google is down');
    const back = reduce(s, ok(1, ['job-1']));
    expect(back.reconnecting).toBe(false);
    expect(back.unavailable).toBeNull();
  });

  it('a network error before the first success is an error view; polling on recovers', () => {
    const s = reduce(listed, fail(network()));
    expect(s.view).toBe('error');
    expect(s.error).toBe('Failed to fetch');
    expect(reduce(s, fail(network()))).toBe(s);
    expect(reduce(s, ok(1, [])).view).toBe('ready');
  });

  it('a network error after the first success keeps the data and sets reconnecting', () => {
    const first = run([ok(1, ['job-1'])]);
    const s = reduce(first, fail(network()));
    expect(s.view).toBe('ready');
    expect(s.dashboard).toBe(first.dashboard);
    expect(s.reconnecting).toBe(true);
    expect(reduce(s, fail(network()))).toBe(s);
    const back = reduce(s, ok(1, ['job-1']));
    expect(back.reconnecting).toBe(false);
    expect(back.dashboard).toBe(first.dashboard);
  });

  it('aborts change nothing', () => {
    const s = run([ok(1, ['job-1'])]);
    expect(reduce(s, fail(new ApiRequestError(0, 'Request aborted', undefined, 'abort')))).toBe(s);
  });
});

describe('employee workspace state: job lookup', () => {
  it('job found, equal job keeps identity, job missing, cleared', () => {
    const found = run([ok(1, ['job-1']), { type: 'job', job: jobResponse('job-1') }]);
    expect(found.job?.job.id).toBe('job-1');
    expect(found.jobMissing).toBe(false);
    expect(reduce(found, { type: 'job', job: jobResponse('job-1') })).toBe(found);
    const missing = reduce(found, { type: 'jobMissing' });
    expect(missing.job).toBeNull();
    expect(missing.jobMissing).toBe(true);
    expect(reduce(missing, { type: 'jobMissing' })).toBe(missing);
    const cleared = reduce(missing, { type: 'jobCleared' });
    expect(cleared.jobMissing).toBe(false);
    expect(reduce(cleared, { type: 'job', job: jobResponse('job-1') }).job?.job.id).toBe('job-1');
  });

  it('stores the business directory', () => {
    const s = reduce(init, { type: 'businesses', businesses: [{ id: 'biz-a' } as never] });
    expect(s.businesses.map((b) => b.id)).toEqual(['biz-a']);
  });
});
