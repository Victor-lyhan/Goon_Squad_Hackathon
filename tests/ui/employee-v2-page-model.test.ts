import { describe, expect, it } from 'vitest';
import type { CommuteResponse } from '../../shared/v2/api';
import { ApiRequestError } from '../../client/src/api/v2';
import { unavailableMessage } from '../../client/src/components/employee/v2/commuteFormModel';
import {
  TRAVEL_DATA_MISSING_TEXT, employeeWorkspaceReducer, initialWorkspaceState,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import {
  NETWORK_TEXT, SAVING_TEXT, TIMEOUT_TEXT, outcomeFromError, outcomeFromResponse, pageScreen, saveNotice,
  searchFromGeocode, showRunNote, siblingEmployeePath,
} from '../../client/src/components/employee/v2/page/employeePageModel';
import { dash, jobResponse } from './employeeV2DataSample';

const res = (ids: string[]): CommuteResponse => {
  const d = dash(1, []);
  return { employee: d.employee, home: d.home, trips: [], rematchedShipmentIds: ids };
};
const notice = (e: unknown) => saveNotice(outcomeFromError(e));

describe('save outcomes', () => {
  it('saving keeps the form open with the slow-home hint', () => {
    expect(saveNotice({ kind: 'saving' })).toEqual({ at: 'page', role: 'status', text: SAVING_TEXT, formOpen: true });
    expect(SAVING_TEXT).toBe('Saving. A new home address can take a few seconds.');
  });

  it('success with 0 rematched closes the form and says only "Commute saved"', () => {
    const n = saveNotice(outcomeFromResponse(res([])));
    expect(n).toEqual({ at: 'page', role: 'status', text: 'Commute saved.', formOpen: false });
  });

  it('success with 2 rematched reads the count from the response', () => {
    const n = saveNotice(outcomeFromResponse(res(['shp-1', 'shp-2'])));
    expect(n.text).toBe('Commute saved. 2 waiting deliveries were matched.');
    expect(n.formOpen).toBe(false);
    expect(saveNotice(outcomeFromResponse(res(['shp-9']))).text).toBe('Commute saved. 1 waiting delivery was matched.');
  });

  it('400 is shown at the form, which stays open', () => {
    const n = notice(new ApiRequestError(400, 'Morning departure must be on Day 2', { morningDepartureMin: 'x' }));
    expect(n).toEqual({ at: 'form', role: 'alert', text: 'Morning departure must be on Day 2', formOpen: true });
  });

  it("409 shows the server's text and keeps the form open", () => {
    const n = notice(new ApiRequestError(409, 'Planning is locked while the run plays.'));
    expect(n).toEqual({ at: 'page', role: 'alert', text: 'Planning is locked while the run plays.', formOpen: true });
  });

  it('each 503 code shows its unavailable text', () => {
    const e = (code: string) => new ApiRequestError(503, 'server text', undefined, 'http', code);
    expect(notice(e('travel_data_missing')).text).toBe(TRAVEL_DATA_MISSING_TEXT);
    expect(notice(e('google_key_missing')).text).toBe(unavailableMessage('google_key_missing'));
    expect(notice(e('google_unavailable')).text).toBe(unavailableMessage('google_unavailable'));
    for (const c of ['travel_data_missing', 'google_key_missing', 'google_unavailable']) {
      expect(notice(e(c))).toMatchObject({ at: 'page', role: 'alert', formOpen: true });
    }
  });

  it('timeout after the 20 s limit', () => {
    const n = notice(new ApiRequestError(0, 'Request timed out', undefined, 'timeout'));
    expect(n).toEqual({ at: 'page', role: 'alert', text: TIMEOUT_TEXT, formOpen: true });
    expect(TIMEOUT_TEXT).toContain('20 seconds');
  });

  it('network error', () => {
    expect(notice(new ApiRequestError(0, 'Failed to fetch'))).toEqual({ at: 'page', role: 'alert', text: NETWORK_TEXT, formOpen: true });
  });

  it('other failures show the server text or a fallback', () => {
    expect(notice(new ApiRequestError(500, 'Boom')).text).toBe('Boom');
    expect(notice('weird').text).toBe('The commute could not be saved. Try again.');
  });
});

describe('pageScreen', () => {
  const ready = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: dash(1, ['j1']), runId: 'run-1' });

  it('maps every hook view', () => {
    expect(pageScreen(initialWorkspaceState, null)).toEqual({ kind: 'loading' });
    expect(pageScreen({ ...initialWorkspaceState, view: 'not_found', fallbackEmployeeId: 'emp-02' }, null))
      .toEqual({ kind: 'not_found', fallbackEmployeeId: 'emp-02' });
    expect(pageScreen({ ...initialWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT } }, null))
      .toEqual({ kind: 'unavailable', text: TRAVEL_DATA_MISSING_TEXT });
    expect(pageScreen({ ...initialWorkspaceState, view: 'error', error: 'Server error' }, null)).toEqual({ kind: 'error', text: 'Server error' });
    expect(pageScreen(ready, null)).toEqual({ kind: 'workspace' });
  });

  it('job screens: loading, own, missing, other employee', () => {
    expect(pageScreen(ready, 'j1')).toEqual({ kind: 'job_loading' });
    const own = employeeWorkspaceReducer(ready, { type: 'job', job: jobResponse('j1') });
    expect(pageScreen(own, 'j1')).toEqual({ kind: 'job' });
    // A previous job's detail never shows for a new ?job=.
    expect(pageScreen(own, 'j2')).toEqual({ kind: 'job_loading' });
    expect(pageScreen(employeeWorkspaceReducer(ready, { type: 'jobMissing' }), 'zz')).toEqual({ kind: 'job_missing' });
    const other = jobResponse('j9');
    other.job = { ...other.job, employeeId: 'emp-07' };
    expect(pageScreen(employeeWorkspaceReducer(ready, { type: 'job', job: other }), 'j9')).toEqual({ kind: 'job_other', employeeId: 'emp-07' });
  });

  it('a failed poll after a first success stays on the workspace', () => {
    const failed = employeeWorkspaceReducer(ready, { type: 'dashboardFailed', error: new ApiRequestError(0, 'Failed to fetch') });
    expect(failed.reconnecting).toBe(true);
    expect(pageScreen(failed, null)).toEqual({ kind: 'workspace' });
  });
});

describe('helpers', () => {
  it('run note shows once per run', () => {
    const changed = { runChanged: true, baseline: { runId: 'run-2', employeeId: 'emp-01', jobIds: [] } };
    expect(showRunNote({ runChanged: false, baseline: null }, undefined)).toBe(false);
    expect(showRunNote(changed, undefined)).toBe(true);
    expect(showRunNote(changed, 'run-2')).toBe(false);
    expect(showRunNote({ ...changed, baseline: { ...changed.baseline, runId: 'run-3' } }, 'run-2')).toBe(true);
  });

  it('employee links keep the current route prefix', () => {
    expect(siblingEmployeePath('/nyc/employee/emp-01', 'emp-02')).toBe('/nyc/employee/emp-02');
    expect(siblingEmployeePath('/employee/emp-01/', 'emp 3')).toBe('/employee/emp%203');
  });

  it('address search calls geocode with the signal and returns its results', async () => {
    const calls: unknown[] = [];
    const results = [{ label: '1 Main St', neighborhood: 'Astoria', lat: 40.7, lng: -73.9 }];
    const search = searchFromGeocode(async (q, opts) => { calls.push([q, opts?.signal]); return { results }; });
    const ctl = new AbortController();
    await expect(search('1 Main', ctl.signal)).resolves.toEqual(results);
    expect(calls).toEqual([['1 Main', ctl.signal]]);
  });
});
