// Polls one business's v2 dashboard every second (#386), plus the business and employee directories.
// API functions are injected, so tests run in Node with fake timers. A poller belongs to one business:
// `stop()` aborts what is in flight and nothing reaches the sink afterwards (the hook stops it and makes
// a new poller when the business ID changes, so a late answer for the old ID is dropped).
import type { BusinessDashboard, BusinessesResponse, EmployeesResponse } from '../../../../../../shared/v2/api';
import { ApiRequestError, isAbortError, type RequestOptions } from '../../../../api/v2';
import { toDirectoryEmployees, type BusinessWorkspaceAction } from './businessWorkspaceState';

export const POLL_INTERVAL_MS = 1000;

/** The v2 helpers the poller needs (same signatures as `client/src/api/v2`). */
export type BusinessWorkspaceApi = {
  getBusinessDashboard: (id: string, opts?: RequestOptions) => Promise<BusinessDashboard>;
  getBusinesses: (opts?: RequestOptions) => Promise<BusinessesResponse>;
  getEmployees: (opts?: RequestOptions) => Promise<EmployeesResponse>;
  /** Only `runId` is read: the dashboard has none, so a version change is checked against the map's run. */
  getMap: (opts?: RequestOptions) => Promise<{ runId: string }>;
};

export type BusinessPollerSink = { dispatch: (a: BusinessWorkspaceAction) => void };

export type BusinessPoller = {
  start: () => void;
  stop: () => void;
  /** Polls now (or right after the poll in flight) and resolves when that poll is done. */
  refetchNow: () => Promise<void>;
};

const is404 = (e: unknown) => e instanceof ApiRequestError && e.status === 404;

export function createBusinessPoller(
  businessId: string,
  api: BusinessWorkspaceApi,
  sink: BusinessPollerSink,
  { intervalMs = POLL_INTERVAL_MS }: { intervalMs?: number } = {},
): BusinessPoller {
  const ctl = new AbortController();
  const { signal } = ctl;
  let started = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiters: (() => void)[] = [];
  let lastVersion: number | null = null;
  let runId: string | null = null;
  let haveDirectories = false;
  let firstBusinessId: string | null = null;
  /** True while the dashboard answers 404: the directories are reloaded once, not every second. */
  let gone = false;

  const live = () => !signal.aborted;
  const dispatch = (a: BusinessWorkspaceAction) => { if (live()) sink.dispatch(a); };

  /** Both directories in one action; a failure leaves them for the next tick to retry. */
  async function loadDirectories(): Promise<void> {
    try {
      const [b, e] = await Promise.all([api.getBusinesses({ signal }), api.getEmployees({ signal })]);
      if (!live()) return;
      haveDirectories = true;
      firstBusinessId = b.businesses[0]?.id ?? null;
      dispatch({ type: 'directories', businesses: b.businesses, employees: toDirectoryEmployees(e.employees) });
    } catch { /* retried on the next tick */ }
  }

  /** Versions only go up, even for a new city, so the map's run ID is checked once per version change. */
  async function checkRun(version: number): Promise<void> {
    if (lastVersion !== null && version === lastVersion && runId !== null) return;
    try {
      const m = await api.getMap({ signal });
      if (live()) runId = m.runId;
    } catch { /* keep the old run ID; the next version change retries */ }
  }

  async function poll(): Promise<void> {
    let dash: BusinessDashboard;
    try {
      dash = await api.getBusinessDashboard(businessId, { signal });
    } catch (e) {
      if (!live() || isAbortError(e)) return;
      if (is404(e)) {
        // A stale ID usually means a new city: reload the directories to link to a valid business.
        lastVersion = null;
        if (!gone || !haveDirectories) await loadDirectories();
        gone = true;
        dispatch({ type: 'notFound', fallbackBusinessId: firstBusinessId });
        return;
      }
      dispatch({ type: 'dashboardFailed', error: e });
      return;
    }
    if (!live()) return;
    gone = false;
    const prevRun = runId;
    await checkRun(dash.version);
    if (!live()) return;
    lastVersion = dash.version;
    dispatch({ type: 'dashboard', dashboard: dash, runId });
    if (!haveDirectories || (prevRun !== null && runId !== prevRun)) await loadDirectories();
  }

  function schedule(delay: number) {
    if (timer) clearTimeout(timer);
    timer = live() ? setTimeout(() => { void loop(); }, delay) : undefined;
  }

  // One request chain at a time: the next tick is scheduled only after the poll finishes.
  async function loop(): Promise<void> {
    if (!live() || inFlight) return;
    if (timer) { clearTimeout(timer); timer = undefined; }
    inFlight = true;
    const mine = waiters;
    waiters = [];
    try { await poll(); } catch { /* sink errors must not stop polling */ } finally {
      inFlight = false;
      mine.forEach((r) => r());
    }
    if (!live()) return;
    schedule(waiters.length > 0 ? 0 : intervalMs);
  }

  const refetchNow = () => new Promise<void>((resolve) => {
    if (!live()) { resolve(); return; }
    waiters.push(resolve);
    if (!inFlight) void loop();
  });

  return {
    start: () => { if (!started && live()) { started = true; void loop(); } },
    stop: () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
      timer = undefined;
      const all = waiters; waiters = []; all.forEach((r) => r());
    },
    refetchNow,
  };
}
