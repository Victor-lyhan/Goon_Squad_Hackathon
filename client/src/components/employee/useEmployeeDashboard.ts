import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { EmployeeDashboard, MapResponse } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import { ApiRequestError, getBusinesses, getEmployeeDashboard, getMap } from '../../api';
import { dashReducer, initialDashState, isReconnecting } from './dashboardState';
import { needsMapRefetch, POLL_MS } from './employeePortalModel';
import { arrivalsFor, nextArrivals, stepBaseline } from './newJobsModel';
import type { Arrivals, JobArrival, JobBaseline } from './newJobsModel';

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

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

export function useEmployeeDashboard(employeeId: string): EmployeeData {
  const [state, dispatch] = useReducer(dashReducer, initialDashState);
  const { dash, error } = state;
  const [map, setMap] = useState<MapResponse | null>(null);
  const [directory, setDirectory] = useState<{ businesses: Business[]; hubs: Hub[] }>({ businesses: [], hubs: [] });
  const [arrived, setArrived] = useState<JobArrival[]>([]);
  const [arrivals, setArrivals] = useState<Arrivals>({});
  const baseline = useRef<JobBaseline | null>(null);
  const runIdRef = useRef<string | null>(null);
  const lastVersion = useRef<number | null>(null);
  const haveMap = useRef(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const idRef = useRef(employeeId);
  idRef.current = employeeId;

  const loadStatic = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([getMap(), getBusinesses()]);
      if (!alive.current) return;
      runIdRef.current = m.runId;
      setMap(m);
      setDirectory({ businesses: b.businesses, hubs: b.hubs });
      haveMap.current = true;
    } catch (e) {
      if (alive.current) dispatch({ type: 'failure', message: msg(e), status: e instanceof ApiRequestError ? e.status : 0 });
    }
  }, []);

  const refetch = useCallback(async (rerun = false): Promise<void> => {
    const id = idRef.current;
    try {
      const next = await getEmployeeDashboard(id);
      if (!alive.current || idRef.current !== id) return;
      let runChanged = false;
      let refetchMap = needsMapRefetch(lastVersion.current, next.version, haveMap.current);
      // Versions only ever go up (even for a new city), so check the run id once per version change.
      if (lastVersion.current !== null && next.version !== lastVersion.current && !refetchMap) {
        try {
          const m = await getMap();
          if (!alive.current || idRef.current !== id) return;
          if (m.runId !== runIdRef.current) { runIdRef.current = m.runId; refetchMap = true; runChanged = true; }
        } catch { /* keep the old run id; the next change retries */ }
      }
      if (runChanged) {
        // Stale data from the old run: drop it, reset the New baseline and refetch from scratch.
        lastVersion.current = null;
        baseline.current = null;
        setArrivals({});
        setArrived([]);
        dispatch({ type: 'runChanged', runId: runIdRef.current! });
        haveMap.current = false;
        void loadStatic();
        if (!rerun) await refetch(true);
        return;
      }
      lastVersion.current = next.version;
      const step = stepBaseline(baseline.current, runIdRef.current, next);
      baseline.current = step.baseline;
      setArrivals((a) => nextArrivals(a, step.newIds, next, Date.now()));
      setArrived(arrivalsFor(next, step.newIds));
      dispatch({ type: 'success', dash: next, runId: runIdRef.current });
      if (refetchMap) { haveMap.current = false; void loadStatic(); }
    } catch (e) {
      if (alive.current && idRef.current === id) dispatch({ type: 'failure', message: msg(e), status: e instanceof ApiRequestError ? e.status : 0 });
    }
  }, [loadStatic]);

  useEffect(() => {
    alive.current = true;
    lastVersion.current = null;
    baseline.current = null;
    setArrivals({});
    setArrived([]);
    dispatch({ type: 'reset' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Next poll is scheduled only after the previous one finishes, so a slow request never overlaps.
    const tick = async () => {
      if (!inFlight.current) {
        inFlight.current = true;
        try { await refetch(); } finally { inFlight.current = false; }
      }
      if (alive.current) timer = setTimeout(() => { void tick(); }, POLL_MS);
    };
    void tick();
    return () => { alive.current = false; if (timer) clearTimeout(timer); };
  }, [employeeId, refetch]);

  const onSeenJob = useCallback((jobId: string) => {
    setArrivals((a) => { if (!(jobId in a)) return a; const { [jobId]: _gone, ...rest } = a; return rest; });
  }, []);
  const newJobIds = useMemo(() => new Set(Object.keys(arrivals)), [arrivals]);

  return { dash, map, businesses: directory.businesses, hubs: directory.hubs, error, reconnecting: isReconnecting(state), runId: state.runId, arrived, newJobIds, onSeenJob, refetch };
}
