// Polls one employee's v2 dashboard every second (#388), plus the business directory and the selected job.
// API functions are injected, so tests run in Node with fake timers. A poller belongs to one employee:
// `stop()` aborts what is in flight and nothing reaches the sink afterwards (the hook makes a new poller
// when the employee ID changes).
import type {
  BusinessesResponse, EmployeeDashboard, EmployeesResponse, JobResponse,
} from '../../../../../../shared/v2/api';
import { ApiRequestError, isAbortError, type RequestOptions } from '../../../../api/v2';
import type { WorkspaceAction } from './employeeWorkspaceState';

export const POLL_INTERVAL_MS = 1000;

/** The v2 helpers the poller needs (same signatures as `client/src/api/v2`). */
export type EmployeeWorkspaceApi = {
  getEmployeeDashboard: (id: string, opts?: RequestOptions) => Promise<EmployeeDashboard>;
  getJob: (id: string, opts?: RequestOptions) => Promise<JobResponse>;
  getBusinesses: (opts?: RequestOptions) => Promise<BusinessesResponse>;
  getEmployees: (opts?: RequestOptions) => Promise<EmployeesResponse>;
  /** Only `runId` is read: the dashboard has none, so a version change is checked against the map's run. */
  getMap: (opts?: RequestOptions) => Promise<{ runId: string }>;
};

export type EmployeePollerSink = { dispatch: (a: WorkspaceAction) => void };

export type EmployeePoller = {
  start: () => void;
  stop: () => void;
  /** Polls now (or right after the poll in flight) and resolves when that poll is done. */
  refetchNow: () => Promise<void>;
  /** The job whose detail is fetched with every tick; null for none. */
  watchJob: (jobId: string | null) => void;
};

const is404 = (e: unknown) => e instanceof ApiRequestError && e.status === 404;

export function createEmployeePoller(
  employeeId: string,
  api: EmployeeWorkspaceApi,
  sink: EmployeePollerSink,
  { intervalMs = POLL_INTERVAL_MS }: { intervalMs?: number } = {},
): EmployeePoller {
  const ctl = new AbortController();
  const { signal } = ctl;
  let started = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiters: (() => void)[] = [];
  let watched: string | null = null;
  let lastVersion: number | null = null;
  let runId: string | null = null;
  let haveBusinesses = false;

  const live = () => !signal.aborted;
  const dispatch = (a: WorkspaceAction) => { if (live()) sink.dispatch(a); };

  async function loadBusinesses(): Promise<void> {
    try {
      const b = await api.getBusinesses({ signal });
      if (!live()) return;
      haveBusinesses = true;
      dispatch({ type: 'businesses', businesses: b.businesses });
    } catch { /* retried on the next tick */ }
  }

  async function firstEmployeeId(): Promise<string | null> {
    try {
      const r = await api.getEmployees({ signal });
      return r.employees[0]?.id ?? null;
    } catch { return null; }
  }

  /** The map's run ID when the version moved; the old one if the check fails (retried at the next change). */
  async function checkRun(version: number): Promise<void> {
    if (lastVersion !== null && version === lastVersion && runId !== null) return;
    try {
      const m = await api.getMap({ signal });
      if (live()) runId = m.runId;
    } catch { /* keep the old run ID */ }
  }

  async function poll(): Promise<void> {
    const jobId = watched;
    const [dash, job] = await Promise.allSettled([
      api.getEmployeeDashboard(employeeId, { signal }),
      jobId ? api.getJob(jobId, { signal }) : Promise.resolve(null),
    ]);
    if (!live()) return;

    if (dash.status === 'rejected') {
      const e = dash.reason;
      if (isAbortError(e)) return;
      if (is404(e)) {
        const fallback = await firstEmployeeId();
        lastVersion = null;
        dispatch({ type: 'notFound', fallbackEmployeeId: fallback });
        return;
      }
      dispatch({ type: 'dashboardFailed', error: e });
    } else {
      const prevRun = runId;
      await checkRun(dash.value.version);
      if (!live()) return;
      lastVersion = dash.value.version;
      dispatch({ type: 'dashboard', dashboard: dash.value, runId });
      if (!haveBusinesses || (prevRun !== null && runId !== prevRun)) await loadBusinesses();
    }

    // The selection may have changed while this poll ran: then its result belongs to the old job.
    if (!live() || jobId === null || jobId !== watched) return;
    if (job.status === 'fulfilled' && job.value) dispatch({ type: 'job', job: job.value });
    else if (job.status === 'rejected' && is404(job.reason)) dispatch({ type: 'jobMissing' });
    // Other job failures keep the last job; the dashboard state already shows reconnecting.
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
    watchJob: (jobId) => {
      if (jobId === watched) return;
      watched = jobId;
      dispatch({ type: 'jobCleared' });
      if (jobId !== null && started) void refetchNow();
    },
  };
}
