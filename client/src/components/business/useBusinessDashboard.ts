import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { BusinessDashboard } from '../../../../shared/api';
import type { Business, Employee, Hub } from '../../../../shared/types';
import { getBusinessDashboard, getBusinesses, getEmployees, getMap } from '../../api';
import { POLL_MS } from './businessPortalModel';
import {
  bizReducer, bizView, createPollGuard, friendlyError, initialBizState, isReconnecting, runDidChange, statusOf,
} from './businessDashboardState';
import { isUnknownBusiness } from './trackingModel';

export type DashboardState = {
  status: 'loading' | 'ready' | 'error' | 'not_found';
  error: string | null;
  /** True while polls fail but the last dashboard is still shown. */
  reconnecting: boolean;
  /** Run the current dashboard belongs to (null until known). */
  runId: string | null;
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
  const [state, dispatch] = useReducer(bizReducer, initialBizState);
  const [lists, setLists] = useState<{ businesses: Business[]; hubs: Hub[]; employees: Employee[] }>({ businesses: [], hubs: [], employees: [] });
  const [listsReady, setListsReady] = useState(false);
  const current = useRef(businessId);
  current.current = businessId;
  const alive = useRef(true);
  const guard = useRef(createPollGuard());
  const runIdRef = useRef<string | null>(null);
  const lastVersion = useRef<number | null>(null);
  const listsLoading = useRef(false);

  const loadLists = useCallback(async () => {
    if (listsLoading.current) return;
    listsLoading.current = true;
    try {
      const [b, e] = await Promise.all([getBusinesses(), getEmployees()]);
      if (!alive.current) return;
      setLists({ businesses: b.businesses, hubs: b.hubs, employees: e.employees });
      setListsReady(true);
    } catch (e) {
      if (alive.current) dispatch({ type: 'failure', message: msg(e), status: statusOf(e) });
    } finally {
      listsLoading.current = false;
    }
  }, []);

  const load = useCallback(async (rerun: boolean): Promise<void> => {
    const id = current.current;
    try {
      const d = await getBusinessDashboard(id);
      if (!alive.current || current.current !== id) return;
      // Versions only ever go up (even for a new city), so check the run id once per version change.
      if (lastVersion.current === null || d.version !== lastVersion.current) {
        try {
          const m = await getMap();
          if (!alive.current || current.current !== id) return;
          const changed = runDidChange(runIdRef.current, m.runId);
          runIdRef.current = m.runId;
          if (changed && !rerun) {
            // Stale data from the old run: drop it and start again from scratch.
            lastVersion.current = null;
            dispatch({ type: 'runChanged', runId: m.runId });
            void loadLists();
            await load(true);
            return;
          }
        } catch { /* keep the old run id; the next version change retries */ }
      }
      lastVersion.current = d.version;
      dispatch({ type: 'success', dashboard: d, runId: runIdRef.current });
    } catch (e) {
      if (alive.current && current.current === id) dispatch({ type: 'failure', message: msg(e), status: statusOf(e) });
    }
  }, [loadLists]);

  // Skipped while a poll is in flight, so polls never overlap.
  const refetch = useCallback(async () => { await guard.current.run(() => load(false)); }, [load]);

  useEffect(() => {
    alive.current = true;
    lastVersion.current = null;
    runIdRef.current = null;
    guard.current.release();
    dispatch({ type: 'reset' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The next poll is scheduled only after the previous one finishes.
    const tick = async () => {
      await refetch();
      if (alive.current) timer = setTimeout(() => { void tick(); }, POLL_MS);
    };
    void tick();
    return () => { alive.current = false; if (timer) clearTimeout(timer); };
  }, [businessId, refetch]);

  // Load the directories; retry while they are missing, and reload when the business is reported gone
  // (a new city may have been generated).
  const gone = state.status === 404;
  useEffect(() => {
    void loadLists();
  }, [gone, loadLists]);
  useEffect(() => {
    if (!listsReady && state.dashboard) void loadLists();
  }, [listsReady, state.dashboard, loadLists]);

  const notFound = bizView(state) === 'not_found' || (!state.dashboard && isUnknownBusiness(businessId, lists.businesses, listsReady));
  const status = notFound ? 'not_found' : state.dashboard && listsReady ? 'ready' : state.error ? 'error' : 'loading';
  const error = state.error === null ? null : state.dashboard ? state.error : friendlyError(state);
  return { status, error, reconnecting: isReconnecting(state), runId: state.runId, dashboard: state.dashboard, ...lists, refetch };
}
