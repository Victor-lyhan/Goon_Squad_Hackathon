import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EmployeeDashboard, MapResponse } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import { getBusinesses, getEmployeeDashboard, getMap } from '../../api';
import { needsMapRefetch, POLL_MS } from './employeePortalModel';
import { arrivalsFor, nextArrivals, stepBaseline } from './newJobsModel';
import type { Arrivals, JobArrival, JobBaseline } from './newJobsModel';

export type EmployeeData = {
  dash: EmployeeDashboard | null;
  map: MapResponse | null;
  businesses: Business[];
  hubs: Hub[];
  error: string | null;
  /** Jobs that arrived in the latest poll (for toasts). */
  arrived: JobArrival[];
  /** Job IDs still wearing the New badge. */
  newJobIds: ReadonlySet<string>;
  onSeenJob: (jobId: string) => void;
  refetch: () => Promise<void>;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

export function useEmployeeDashboard(employeeId: string): EmployeeData {
  const [dash, setDash] = useState<EmployeeDashboard | null>(null);
  const [map, setMap] = useState<MapResponse | null>(null);
  const [directory, setDirectory] = useState<{ businesses: Business[]; hubs: Hub[] }>({ businesses: [], hubs: [] });
  const [error, setError] = useState<string | null>(null);
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
      if (alive.current) setError(msg(e));
    }
  }, []);

  const refetch = useCallback(async () => {
    const id = idRef.current;
    try {
      const next = await getEmployeeDashboard(id);
      if (!alive.current || idRef.current !== id) return;
      const refetchMap = needsMapRefetch(lastVersion.current, next.version, haveMap.current);
      lastVersion.current = next.version;
      const step = stepBaseline(baseline.current, runIdRef.current, next);
      baseline.current = step.baseline;
      setArrivals((a) => nextArrivals(a, step.newIds, next, Date.now()));
      setArrived(arrivalsFor(next, step.newIds));
      setDash(next);
      setError(null);
      if (refetchMap) { haveMap.current = false; void loadStatic(); }
    } catch (e) {
      if (alive.current && idRef.current === id) setError(msg(e));
    }
  }, [loadStatic]);

  useEffect(() => {
    alive.current = true;
    lastVersion.current = null;
    baseline.current = null;
    setArrivals({});
    setArrived([]);
    setDash(null);
    setError(null);
    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try { await refetch(); } finally { inFlight.current = false; }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [employeeId, refetch]);

  const onSeenJob = useCallback((jobId: string) => {
    setArrivals((a) => { if (!(jobId in a)) return a; const { [jobId]: _gone, ...rest } = a; return rest; });
  }, []);
  const newJobIds = useMemo(() => new Set(Object.keys(arrivals)), [arrivals]);

  return { dash, map, businesses: directory.businesses, hubs: directory.hubs, error, arrived, newJobIds, onSeenJob, refetch };
}
