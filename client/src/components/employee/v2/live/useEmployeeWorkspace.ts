// The Employee workspace's one data hook (#388): owns all server traffic for the page, so the
// workspace view, the commute form, the address search and the job detail only receive props.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { CommuteResponse } from '../../../../../../shared/v2/api';
import type { PutCommuteRequest } from '../../../../../../shared/v2/schemas';
import {
  getBusinesses, getEmployeeDashboard, getEmployees, getJob, getMap, putCommute, type RequestOptions,
} from '../../../../api/v2';
import { createEmployeePoller, type EmployeePoller, type EmployeeWorkspaceApi } from './employeePoller';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState, type WorkspaceAction,
} from './employeeWorkspaceState';

/** A new home waits for a live Google request on the server, so the save gets more than the 8 s default. */
export const COMMUTE_SAVE_TIMEOUT_MS = 20000;

export type EmployeeWorkspaceDeps = EmployeeWorkspaceApi & {
  putCommute: (id: string, req: PutCommuteRequest, opts?: RequestOptions) => Promise<CommuteResponse>;
};

export const defaultEmployeeWorkspaceDeps: EmployeeWorkspaceDeps = {
  getEmployeeDashboard, getJob, getBusinesses, getEmployees, getMap, putCommute,
};

/**
 * Saves a commute with the long timeout. Errors are rethrown unchanged (the form maps 409 and 503);
 * on success the dashboard is refetched at once so the new trips and matches show without waiting.
 */
export async function saveCommuteWith(
  deps: Pick<EmployeeWorkspaceDeps, 'putCommute'>,
  employeeId: string,
  req: PutCommuteRequest,
  refetchNow: () => Promise<void>,
): Promise<CommuteResponse> {
  const res = await deps.putCommute(employeeId, req, { timeoutMs: COMMUTE_SAVE_TIMEOUT_MS });
  void refetchNow();
  return res;
}

/** State tagged with the employee it belongs to, so a switch never shows the previous employee's data. */
type Owned = { owner: string; state: EmployeeWorkspaceState };
type OwnedAction = { owner: string; action: WorkspaceAction };

export function ownedWorkspaceReducer(s: Owned, a: OwnedAction): Owned {
  const base = s.owner === a.owner ? s.state : initialWorkspaceState;
  const next = employeeWorkspaceReducer(base, a.action);
  return next === s.state && s.owner === a.owner ? s : { owner: a.owner, state: next };
}

export type EmployeeWorkspace = EmployeeWorkspaceState & {
  saveCommute: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  refetchNow: () => Promise<void>;
  /** Clears the "New" highlight of a job the employee opened. */
  markSeen: (jobId: string) => void;
};

export function useEmployeeWorkspace(
  employeeId: string,
  jobId: string | null,
  deps: EmployeeWorkspaceDeps = defaultEmployeeWorkspaceDeps,
): EmployeeWorkspace {
  const [owned, send] = useReducer(ownedWorkspaceReducer, { owner: employeeId, state: initialWorkspaceState });
  const poller = useRef<EmployeePoller | null>(null);
  const jobRef = useRef(jobId);
  jobRef.current = jobId;

  useEffect(() => {
    const p = createEmployeePoller(employeeId, deps, {
      dispatch: (action) => send({ owner: employeeId, action }),
    });
    poller.current = p;
    p.watchJob(jobRef.current);
    p.start();
    return () => { p.stop(); if (poller.current === p) poller.current = null; };
  }, [employeeId, deps]);

  useEffect(() => { poller.current?.watchJob(jobId); }, [jobId, employeeId]);

  const refetchNow = useCallback(async () => { await poller.current?.refetchNow(); }, []);
  const saveCommute = useCallback(
    (req: PutCommuteRequest) => saveCommuteWith(deps, employeeId, req, refetchNow),
    [deps, employeeId, refetchNow],
  );
  const markSeen = useCallback((id: string) => send({ owner: employeeId, action: { type: 'seen', jobId: id } }), [employeeId]);

  // Until the first action for a new employee arrives, show the loading state, not the old employee.
  const state = owned.owner === employeeId ? owned.state : initialWorkspaceState;
  return { ...state, saveCommute, refetchNow, markSeen };
}
