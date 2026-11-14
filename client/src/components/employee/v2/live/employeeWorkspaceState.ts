// Pure state for the MVP II Employee workspace (#388). Tested in Node; no React, no fetch.
// Rules: a poll with the same version returns the same state object (DECISIONS pass 43/46),
// the "New" highlight lives in memory only (pass 9), and errors after the first success keep the data.
// The workspace is 'ready' only when the business list has arrived once (#712): until then a dashboard
// is kept but the view stays 'loading', so no place reads "Unknown place" for a list that is on its way.
import type { EmployeeDashboard, JobResponse } from '../../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../../shared/v2/types';
import { ApiRequestError, isTravelUnavailable, type TravelUnavailableCode } from '../../../../api/v2';

export const TRAVEL_DATA_MISSING_TEXT = 'NYC travel data is not loaded on this server yet.';
export const RECONNECTING_TEXT = 'Reconnecting…';
export const RUN_CHANGED_NOTE = 'The city changed, so your workspace was reloaded.';

export type WorkspaceView = 'loading' | 'ready' | 'not_found' | 'unavailable' | 'error';

export type EmployeeWorkspaceState = {
  dashboard: EmployeeDashboard | null;
  businesses: NetworkBusiness[];
  /** true once a business list has arrived (also an empty one). A later reload keeps it true. */
  businessesLoaded: boolean;
  job: JobResponse | null;
  jobMissing: boolean;
  view: WorkspaceView;
  unavailable: { code: TravelUnavailableCode; message: string } | null;
  reconnecting: boolean;
  newJobIds: string[];
  runChanged: boolean;
  /** Text for the 'error' view (HTTP or network failure before the first success). */
  error: string | null;
  /** For the 'not_found' view: a valid employee ID to link to, null if none is known. */
  fallbackEmployeeId: string | null;
  /** Baseline of the "New" highlight: run, employee and the job IDs seen so far. null = first load next. */
  baseline: { runId: string | null; employeeId: string; jobIds: string[] } | null;
};

export type WorkspaceAction =
  | { type: 'reset' }
  | { type: 'dashboard'; dashboard: EmployeeDashboard; runId: string | null }
  | { type: 'dashboardFailed'; error: unknown }
  | { type: 'notFound'; fallbackEmployeeId: string | null }
  | { type: 'businesses'; businesses: NetworkBusiness[] }
  | { type: 'job'; job: JobResponse }
  | { type: 'jobMissing' }
  | { type: 'jobCleared' }
  | { type: 'seen'; jobId: string };

export const initialWorkspaceState: EmployeeWorkspaceState = {
  dashboard: null, businesses: [], businessesLoaded: false, job: null, jobMissing: false, view: 'loading', unavailable: null,
  reconnecting: false, newJobIds: [], runChanged: false, error: null, fallbackEmployeeId: null, baseline: null,
};

const jobIdsOf = (d: EmployeeDashboard) => [...d.assigned, ...d.completed].map((v) => v.job.id);

/** The text a TravelUnavailable 503 shows: fixed copy for missing travel data, the server's text otherwise. */
export function unavailableText(code: TravelUnavailableCode, serverMessage: string): string {
  return code === 'travel_data_missing' ? TRAVEL_DATA_MISSING_TEXT : serverMessage;
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Request failed');

function onDashboard(s: EmployeeWorkspaceState, d: EmployeeDashboard, runId: string | null): EmployeeWorkspaceState {
  const b = s.baseline;
  const sameRun = b !== null && (b.runId === null || runId === null || b.runId === runId);
  const sameEmployee = b !== null && b.employeeId === d.employee.id;
  // Before the first business list the dashboard is kept, but the page still shows the loading view.
  const view: WorkspaceView = s.businessesLoaded ? 'ready' : 'loading';
  const unchanged = s.dashboard !== null && s.view === view && !s.reconnecting && s.unavailable === null
    && s.dashboard.version === d.version && sameRun && sameEmployee;
  if (unchanged) return s; // equal poll: same object, so forms keep their draft
  // Recovering on the same version keeps the old dashboard object too.
  const sameData = s.dashboard !== null && s.dashboard.version === d.version && sameRun && sameEmployee;

  const ids = jobIdsOf(d);
  // A different run or employee (or an older version: reset/import) starts a new baseline: nothing is new.
  // So does a dashboard that was never on screen (the business list is still missing).
  const restart = b === null || !s.businessesLoaded || !sameRun || !sameEmployee
    || (s.dashboard !== null && d.version < s.dashboard.version);
  const runChanged = b !== null && !sameRun;
  let newJobIds: string[];
  if (restart) newJobIds = [];
  else {
    const known = new Set(b!.jobIds);
    const live = new Set(ids);
    const kept = s.newJobIds.filter((id) => live.has(id));
    const added = d.assigned.map((v) => v.job.id).filter((id) => !known.has(id) && !kept.includes(id));
    newJobIds = added.length === 0 && kept.length === s.newJobIds.length ? s.newJobIds : [...kept, ...added];
  }
  const knownIds = restart ? ids : [...new Set([...b!.jobIds, ...ids])];
  return {
    ...s,
    dashboard: sameData ? s.dashboard : d,
    view,
    unavailable: null,
    reconnecting: false,
    error: null,
    fallbackEmployeeId: null,
    newJobIds,
    // The note is for a workspace that was on screen when the city changed.
    runChanged: (runChanged && s.businessesLoaded) || s.runChanged,
    // A changed run drops the old run's job and its missing flag; the poller refetches it.
    ...(runChanged ? { job: null, jobMissing: false } : {}),
    baseline: { runId: runId ?? b?.runId ?? null, employeeId: d.employee.id, jobIds: knownIds },
  };
}

function onFailure(s: EmployeeWorkspaceState, e: unknown): EmployeeWorkspaceState {
  const hadData = s.dashboard !== null && s.view === 'ready';
  if (e instanceof ApiRequestError && e.kind === 'abort') return s; // aborts are never failures
  // The poller sends a 404 as 'notFound' (with a link target); this keeps a bare 404 friendly too.
  if (e instanceof ApiRequestError && e.status === 404) {
    return employeeWorkspaceReducer(s, { type: 'notFound', fallbackEmployeeId: s.fallbackEmployeeId });
  }
  if (isTravelUnavailable(e)) {
    const unavailable = { code: e.code, message: unavailableText(e.code, e.message) };
    if (hadData) return { ...s, unavailable, reconnecting: true };
    return { ...s, view: 'unavailable', unavailable, error: null };
  }
  if (hadData) return s.reconnecting && s.unavailable === null ? s : { ...s, reconnecting: true, unavailable: null };
  const error = errorText(e);
  if (s.view === 'error' && s.error === error) return s;
  return { ...s, view: 'error', error, unavailable: null };
}

export function employeeWorkspaceReducer(s: EmployeeWorkspaceState, a: WorkspaceAction): EmployeeWorkspaceState {
  switch (a.type) {
    case 'reset':
      return initialWorkspaceState;
    case 'dashboard':
      return onDashboard(s, a.dashboard, a.runId);
    case 'dashboardFailed':
      return onFailure(s, a.error);
    case 'notFound':
      // The employee is not in the current city (stale link): drop its data and the highlight baseline.
      if (s.view === 'not_found' && s.fallbackEmployeeId === a.fallbackEmployeeId) return s;
      return {
        ...initialWorkspaceState, businesses: s.businesses, businessesLoaded: s.businessesLoaded,
        view: 'not_found', fallbackEmployeeId: a.fallbackEmployeeId,
      };
    case 'businesses':
      // The first list shows a dashboard that was waiting for it. Every other view stays as it is.
      return {
        ...s, businesses: a.businesses, businessesLoaded: true,
        view: s.view === 'loading' && s.dashboard !== null ? 'ready' : s.view,
      };
    case 'job':
      if (s.job !== null && !s.jobMissing && JSON.stringify(s.job) === JSON.stringify(a.job)) return s;
      return { ...s, job: a.job, jobMissing: false };
    case 'jobMissing':
      return s.jobMissing && s.job === null ? s : { ...s, job: null, jobMissing: true };
    case 'jobCleared':
      return s.job === null && !s.jobMissing ? s : { ...s, job: null, jobMissing: false };
    case 'seen':
      return s.newJobIds.includes(a.jobId) ? { ...s, newJobIds: s.newJobIds.filter((id) => id !== a.jobId) } : s;
  }
}
