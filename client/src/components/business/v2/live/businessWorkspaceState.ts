// Pure state for the MVP II Business workspace (#386). Tested in Node; no React, no fetch.
// Rules: a poll with the same version returns the same state object (DECISIONS pass 43), a stale
// business ID shows a friendly state with a link to a valid one (pass 9), and errors after the
// first success keep the data and only set `reconnecting`.
import type { BusinessDashboard } from '../../../../../../shared/v2/api';
import type { Employee, NetworkBusiness } from '../../../../../../shared/v2/types';
import { ApiRequestError, isTravelUnavailable, type TravelUnavailableCode } from '../../../../api/v2';

export const TRAVEL_DATA_MISSING_TEXT = 'NYC travel data is not loaded on this server yet.';
export const RECONNECTING_TEXT = 'Reconnecting…';
export const RUN_CHANGED_NOTE = 'The city changed, so your workspace was reloaded.';

export type BusinessWorkspaceView = 'loading' | 'ready' | 'not_found' | 'unavailable' | 'error';
export type DirectoryEmployee = Pick<Employee, 'id' | 'name'>;

export type BusinessWorkspaceState = {
  dashboard: BusinessDashboard | null;
  businesses: NetworkBusiness[];
  employees: DirectoryEmployee[];
  view: BusinessWorkspaceView;
  unavailable: { code: TravelUnavailableCode; message: string } | null;
  reconnecting: boolean;
  /** True once the run changed under an open workspace (never on the first load). */
  runChanged: boolean;
  /** Text for the 'error' view (HTTP or network failure before the first success). */
  error: string | null;
  /** For the 'not_found' view: a valid business ID to link to, null if none is known. */
  fallbackBusinessId: string | null;
  /** Run the dashboard belongs to (from the map), null until known. */
  runId: string | null;
};

export type BusinessWorkspaceAction =
  | { type: 'reset' }
  | { type: 'dashboard'; dashboard: BusinessDashboard; runId: string | null }
  | { type: 'dashboardFailed'; error: unknown }
  | { type: 'notFound'; fallbackBusinessId: string | null }
  | { type: 'directories'; businesses: NetworkBusiness[]; employees: DirectoryEmployee[] }
  | { type: 'dismissRunChanged' };

export const initialBusinessWorkspaceState: BusinessWorkspaceState = {
  dashboard: null, businesses: [], employees: [], view: 'loading', unavailable: null,
  reconnecting: false, runChanged: false, error: null, fallbackBusinessId: null, runId: null,
};

/** The text a TravelUnavailable 503 shows: fixed copy for missing travel data, the server's text otherwise. */
export function unavailableText(code: TravelUnavailableCode, serverMessage: string): string {
  return code === 'travel_data_missing' ? TRAVEL_DATA_MISSING_TEXT : serverMessage;
}

/** Only the fields the directory needs (the full Employee is not kept in memory). */
export const toDirectoryEmployees = (list: readonly Employee[]): DirectoryEmployee[] =>
  list.map((e) => ({ id: e.id, name: e.name }));

/**
 * True when the dashboard belongs to a different run than the one shown: the map's run ID moved
 * (MVP 1 rule: the first sighting is not a change), or the version went down (reset / import).
 */
export function isRunChange(s: BusinessWorkspaceState, d: BusinessDashboard, runId: string | null): boolean {
  if (s.runId !== null && runId !== null && s.runId !== runId) return true;
  return s.dashboard !== null && d.version < s.dashboard.version;
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Request failed');

function onDashboard(s: BusinessWorkspaceState, d: BusinessDashboard, runId: string | null): BusinessWorkspaceState {
  const runChange = isRunChange(s, d, runId);
  const sameBusiness = s.dashboard !== null && s.dashboard.business.id === d.business.id;
  const sameData = sameBusiness && !runChange && s.dashboard!.version === d.version;
  const nextRunId = runId ?? s.runId;
  // Equal poll: same object, so open forms and typed filters keep their draft.
  if (sameData && s.view === 'ready' && !s.reconnecting && s.unavailable === null && nextRunId === s.runId) return s;
  return {
    ...s,
    // Recovering on the same version keeps the old dashboard object too.
    dashboard: sameData ? s.dashboard : d,
    view: 'ready',
    unavailable: null,
    reconnecting: false,
    error: null,
    fallbackBusinessId: null,
    runChanged: s.runChanged || runChange,
    runId: nextRunId,
  };
}

function onFailure(s: BusinessWorkspaceState, e: unknown): BusinessWorkspaceState {
  if (e instanceof ApiRequestError && e.kind === 'abort') return s; // aborts are never failures
  // The poller sends a 404 as 'notFound' (with a link target); this keeps a bare 404 friendly too.
  if (e instanceof ApiRequestError && e.status === 404) {
    return businessWorkspaceReducer(s, { type: 'notFound', fallbackBusinessId: s.businesses[0]?.id ?? null });
  }
  const hadData = s.dashboard !== null && s.view === 'ready';
  if (isTravelUnavailable(e)) {
    const unavailable = { code: e.code, message: unavailableText(e.code, e.message) };
    if (hadData) {
      const same = s.reconnecting && s.unavailable?.code === unavailable.code && s.unavailable.message === unavailable.message;
      return same ? s : { ...s, unavailable, reconnecting: true };
    }
    if (s.view === 'unavailable' && s.unavailable?.code === unavailable.code && s.unavailable.message === unavailable.message) return s;
    return { ...s, view: 'unavailable', unavailable, error: null };
  }
  if (hadData) return s.reconnecting && s.unavailable === null ? s : { ...s, reconnecting: true, unavailable: null };
  const error = errorText(e);
  if (s.view === 'error' && s.error === error) return s;
  return { ...s, view: 'error', error, unavailable: null };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function businessWorkspaceReducer(s: BusinessWorkspaceState, a: BusinessWorkspaceAction): BusinessWorkspaceState {
  switch (a.type) {
    case 'reset':
      return initialBusinessWorkspaceState;
    case 'dashboard':
      return onDashboard(s, a.dashboard, a.runId);
    case 'dashboardFailed':
      return onFailure(s, a.error);
    case 'notFound':
      // The business is not in the current city (stale link): drop its data, keep the directories.
      if (s.view === 'not_found' && s.fallbackBusinessId === a.fallbackBusinessId) return s;
      return {
        ...initialBusinessWorkspaceState,
        businesses: s.businesses, employees: s.employees, runId: s.runId, runChanged: s.runChanged,
        view: 'not_found', fallbackBusinessId: a.fallbackBusinessId,
      };
    case 'directories': {
      if (sameJson(s.businesses, a.businesses) && sameJson(s.employees, a.employees)) return s;
      const next = { ...s, businesses: a.businesses, employees: a.employees };
      // A not_found state without a link target gets one as soon as the directory is known.
      if (s.view === 'not_found' && s.fallbackBusinessId === null) next.fallbackBusinessId = a.businesses[0]?.id ?? null;
      return next;
    }
    case 'dismissRunChanged':
      return s.runChanged ? { ...s, runChanged: false } : s;
  }
}
