import { useCallback, useEffect, useRef, useState } from 'react';
import type { BusinessDashboard } from '../../../../shared/api';
import type { Business, Employee, Hub } from '../../../../shared/types';
import { getBusinessDashboard, getBusinesses, getEmployees } from '../../api';
import { POLL_MS } from './businessPortalModel';

export type DashboardState = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  dashboard: BusinessDashboard | null;
  businesses: Business[];
  hubs: Hub[];
  employees: Employee[];
  /** Fetch the dashboard now (call after every action). */
  refetch: () => Promise<void>;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** Loads the business dashboard + directories and polls the dashboard every second. */
export function useBusinessDashboard(businessId: string): DashboardState {
  const [dashboard, setDashboard] = useState<BusinessDashboard | null>(null);
  const [lists, setLists] = useState<{ businesses: Business[]; hubs: Hub[]; employees: Employee[] }>({ businesses: [], hubs: [], employees: [] });
  const [error, setError] = useState<string | null>(null);
  const [listsReady, setListsReady] = useState(false);
  const current = useRef(businessId);
  current.current = businessId;
  const inFlight = useRef(false);

  const refetch = useCallback(async () => {
    const id = current.current;
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await getBusinessDashboard(id);
      if (current.current === id) { setDashboard(d); setError(null); }
    } catch (e) {
      if (current.current === id) setError(msg(e));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    setDashboard(null);
    setError(null);
    inFlight.current = false;
    void refetch();
    const t = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(t);
  }, [businessId, refetch]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBusinesses(), getEmployees()])
      .then(([b, e]) => {
        if (cancelled) return;
        setLists({ businesses: b.businesses, hubs: b.hubs, employees: e.employees });
        setListsReady(true);
      })
      .catch((e: unknown) => { if (!cancelled) setError(msg(e)); });
    return () => { cancelled = true; };
  }, []);

  const status = dashboard && listsReady ? 'ready' : error ? 'error' : 'loading';
  return { status, error, dashboard, ...lists, refetch };
}
