import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { EmployeeDashboard, MapResponse } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import { dashReducer, initialDashState, isReconnecting } from './dashboardState';
import type { DashAction, DashState } from './dashboardState';
import { createDashboardPoller } from './dashboardPoller';
import { arrivalsFor, nextArrivals } from './newJobsModel';
import type { Arrivals, JobArrival } from './newJobsModel';

export type EmployeeData = {
  dash: EmployeeDashboard | null;
  map: MapResponse | null;
  businesses: Business[];
  hubs: Hub[];
  error: string | null;
  /** True while polls fail but the last dashboard is still shown. */
  reconnecting: boolean;
  /** Run the current data belongs to (null until known). */
  runId: string | null;
  /** Jobs that arrived in the latest poll (for toasts). */
  arrived: JobArrival[];
  /** Job IDs still wearing the New badge. */
  newJobIds: ReadonlySet<string>;
  onSeenJob: (jobId: string) => void;
  refetch: () => Promise<void>;
};

/** Everything the hook shows, tagged with the employee it was loaded for. */
type Owned = {
  owner: string;
  dash: DashState;
  map: MapResponse | null;
  directory: { businesses: Business[]; hubs: Hub[] };
  arrived: JobArrival[];
  arrivals: Arrivals;
};
type Action =
  | { owner: string; kind: 'dash'; action: DashAction }
  | { owner: string; kind: 'static'; map: MapResponse; businesses: Business[]; hubs: Hub[] }
  | { owner: string; kind: 'runChanged' }
  | { owner: string; kind: 'poll'; dash: EmployeeDashboard; newIds: string[]; now: number }
  | { owner: string; kind: 'seen'; jobId: string };

export const freshOwned = (owner: string): Owned => ({
  owner, dash: initialDashState, map: null, directory: { businesses: [], hubs: [] }, arrived: [], arrivals: {},
});

export function ownedReducer(s: Owned, a: Action): Owned {
  if (a.kind === 'dash' && a.action.type === 'reset') return freshOwned(a.owner);
  if (a.owner !== s.owner) return s; // a late event for another employee is dropped
  switch (a.kind) {
    case 'dash': return { ...s, dash: dashReducer(s.dash, a.action) };
    case 'static': return { ...s, map: a.map, directory: { businesses: a.businesses, hubs: a.hubs } };
    case 'runChanged': return { ...s, arrivals: {}, arrived: [] };
    case 'poll': return { ...s, arrivals: nextArrivals(s.arrivals, a.newIds, a.dash, a.now), arrived: arrivalsFor(a.dash, a.newIds) };
    case 'seen': {
      if (!(a.jobId in s.arrivals)) return s;
      const { [a.jobId]: _gone, ...rest } = s.arrivals;
      return { ...s, arrivals: rest };
    }
  }
}

export function useEmployeeDashboard(employeeId: string): EmployeeData {
  const [raw, send] = useReducer(ownedReducer, employeeId, freshOwned);
  // On the render right after an identity switch the state still belongs to the old employee: show loading.
  const s = raw.owner === employeeId ? raw : freshOwned(employeeId);
  const poller = useRef<ReturnType<typeof createDashboardPoller> | null>(null);

  useEffect(() => {
    send({ owner: employeeId, kind: 'dash', action: { type: 'reset' } });
    const p = createDashboardPoller(employeeId, {
      dispatch: (action) => send({ owner: employeeId, kind: 'dash', action }),
      onStatic: (map, businesses, hubs) => send({ owner: employeeId, kind: 'static', map, businesses, hubs }),
      onRunChanged: () => send({ owner: employeeId, kind: 'runChanged' }),
      onPoll: (dash, newIds) => send({ owner: employeeId, kind: 'poll', dash, newIds, now: Date.now() }),
    });
    poller.current = p;
    p.start();
    return () => { p.stop(); if (poller.current === p) poller.current = null; };
  }, [employeeId]);

  const onSeenJob = useCallback((jobId: string) => send({ owner: employeeId, kind: 'seen', jobId }), [employeeId]);
  const refetch = useCallback(async () => { await poller.current?.refetch(); }, []);
  const newJobIds = useMemo(() => new Set(Object.keys(s.arrivals)), [s.arrivals]);

  return {
    dash: s.dash.dash, map: s.map, businesses: s.directory.businesses, hubs: s.directory.hubs,
    error: s.dash.error, reconnecting: isReconnecting(s.dash), runId: s.dash.runId,
    arrived: s.arrived, newJobIds, onSeenJob, refetch,
  };
}
