import type { EmployeeDashboard, MapResponse } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import { ApiRequestError, getBusinesses, getEmployeeDashboard, getMap, isAbortError } from '../../api';
import type { DashAction } from './dashboardState';
import { needsMapRefetch, POLL_MS } from './employeePortalModel';
import { stepBaseline } from './newJobsModel';
import type { JobBaseline } from './newJobsModel';

/** What the poller reports. Nothing is called after `stop()`. */
export type PollerSink = {
  dispatch: (a: DashAction) => void;
  onStatic: (map: MapResponse, businesses: Business[], hubs: Hub[]) => void;
  /** The run changed: drop arrivals and toasts. */
  onRunChanged: () => void;
  onPoll: (dash: EmployeeDashboard, newIds: string[]) => void;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');
const statusOf = (e: unknown) => (e instanceof ApiRequestError ? e.status : 0);

/**
 * Polls one employee's dashboard. A poller belongs to exactly one employee: its baseline,
 * version and run id are its own, and `stop()` aborts every request still in flight, so
 * nothing from this employee can reach the next one.
 */
export function createDashboardPoller(employeeId: string, sink: PollerSink) {
  const ctl = new AbortController();
  const { signal } = ctl;
  let baseline: JobBaseline | null = null;
  let runId: string | null = null;
  let lastVersion: number | null = null;
  let haveMap = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fail = (e: unknown) => {
    // Aborts (unmount, identity switch) are not failures. Network errors and timeouts keep the last data.
    if (signal.aborted || isAbortError(e)) return;
    sink.dispatch({ type: 'failure', message: msg(e), status: statusOf(e) });
  };

  async function loadStatic(): Promise<void> {
    try {
      const [m, b] = await Promise.all([getMap({ signal }), getBusinesses({ signal })]);
      if (signal.aborted) return;
      runId = m.runId;
      sink.onStatic(m, b.businesses, b.hubs);
      haveMap = true;
    } catch (e) { fail(e); }
  }

  async function refetch(rerun = false): Promise<void> {
    try {
      const next = await getEmployeeDashboard(employeeId, { signal });
      if (signal.aborted) return;
      let runChanged = false;
      let refetchMap = needsMapRefetch(lastVersion, next.version, haveMap);
      // Versions only ever go up (even for a new city), so check the run id once per version change.
      if (lastVersion !== null && next.version !== lastVersion && !refetchMap) {
        try {
          const m = await getMap({ signal });
          if (signal.aborted) return;
          if (m.runId !== runId) { runId = m.runId; refetchMap = true; runChanged = true; }
        } catch { /* keep the old run id; the next change retries */ }
        if (signal.aborted) return;
      }
      if (runChanged) {
        // Stale data from the old run: drop it, reset the New baseline and refetch from scratch.
        lastVersion = null;
        baseline = null;
        sink.onRunChanged();
        sink.dispatch({ type: 'runChanged', runId: runId! });
        haveMap = false;
        void loadStatic();
        if (!rerun) await refetch(true);
        return;
      }
      lastVersion = next.version;
      const step = stepBaseline(baseline, runId, next);
      baseline = step.baseline;
      sink.onPoll(next, step.newIds);
      sink.dispatch({ type: 'success', dash: next, runId });
      if (refetchMap) { haveMap = false; void loadStatic(); }
    } catch (e) { fail(e); }
  }

  // The next poll is scheduled only after the previous one finishes, so a slow request never overlaps.
  async function tick(): Promise<void> {
    if (!inFlight) {
      inFlight = true;
      try { await refetch(); } finally { inFlight = false; }
    }
    if (!signal.aborted) timer = setTimeout(() => { void tick(); }, POLL_MS);
  }

  return {
    start: () => { void tick(); },
    refetch: () => refetch(),
    stop: () => { ctl.abort(); if (timer) clearTimeout(timer); },
  };
}
