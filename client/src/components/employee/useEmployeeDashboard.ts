import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmployeeDashboard, MapResponse } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import { getBusinesses, getEmployeeDashboard, getMap } from '../../api';
import { needsMapRefetch, POLL_MS } from './employeePortalModel';

export type EmployeeData = {
  dash: EmployeeDashboard | null;
  map: MapResponse | null;
  businesses: Business[];
  hubs: Hub[];
  error: string | null;
  refetch: () => Promise<void>;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

export function useEmployeeDashboard(employeeId: string): EmployeeData {
  const [dash, setDash] = useState<EmployeeDashboard | null>(null);
  const [map, setMap] = useState<MapResponse | null>(null);
  const [directory, setDirectory] = useState<{ businesses: Business[]; hubs: Hub[] }>({ businesses: [], hubs: [] });
  const [error, setError] = useState<string | null>(null);
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

  return { dash, map, businesses: directory.businesses, hubs: directory.hubs, error, refetch };
}
