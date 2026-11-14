// Polls one employee's v2 dashboard every second (#388), plus the business directory and the selected job.
// API functions are injected, so tests run in Node with fake timers. A poller belongs to one employee:
// `stop()` aborts what is in flight and nothing reaches the sink afterwards (the hook makes a new poller
// when the employee ID changes).
// The dashboard carries no run ID, so the run is read from the map, which is the whole set of route lines.
// Only the first dashboard waits for it. After that a dashboard is dispatched as soon as it arrives, with
// the last known run ID, and the run is checked in the background: at most once per RUN_CHECK_INTERVAL_MS
// while the version keeps changing, and once more after the last change (#597, DECISIONS pass 61).
import type {
  BusinessesResponse, EmployeeDashboard, EmployeesResponse, JobResponse,
} from '../../../../../../shared/v2/api';
import { ApiRequestError, isAbortError, type RequestOptions } from '../../../../api/v2';
import type { WorkspaceAction } from './employeeWorkspaceState';

export const POLL_INTERVAL_MS = 1000;
/** The shortest time between two run checks (map requests). */
export const RUN_CHECK_INTERVAL_MS = 5000;

/** The v2 helpers the poller needs (same signatures as `client/src/api/v2`). */
export type EmployeeWorkspaceApi = {
  getEmployeeDashboard: (id: string, opts?: RequestOptions) => Promise<EmployeeDashboard>;
  getJob: (id: string, opts?: RequestOptions) => Promise<JobResponse>;
  getBusinesses: (opts?: RequestOptions) => Promise<BusinessesResponse>;
  getEmployees: (opts?: RequestOptions) => Promise<EmployeesResponse>;
  /** Only `runId` is read: the dashboard has none, so version changes are checked against the map's run. */
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
  { intervalMs = POLL_INTERVAL_MS, runCheckMs = RUN_CHECK_INTERVAL_MS }: {
    intervalMs?: number; runCheckMs?: number;
  } = {},
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
  /** Rises when a check finds another run, so a business list requested before it does not count. */
  let runEpoch = 0;
  let haveBusinesses = false;
  // Run check: `runAsked` = the first dashboard has waited for it; `checkWanted` = the version changed
  // (or a check failed) since the last check began; `cooldown` runs for `runCheckMs` from each check.
  let runAsked = false;
  let checkWanted = false;
  let checking = false;
  let cooldown: ReturnType<typeof setTimeout> | undefined;

  const live = () => !signal.aborted;
  const dispatch = (a: WorkspaceAction) => { if (live()) sink.dispatch(a); };

  async function loadBusinesses(): Promise<void> {
    const epoch = runEpoch;
    try {
      const b = await api.getBusinesses({ signal });
      if (!live()) return;
      if (epoch === runEpoch) haveBusinesses = true; // else the run changed meanwhile: loaded again next tick
      dispatch({ type: 'businesses', businesses: b.businesses });
    } catch { /* retried on the next tick */ }
  }

  async function firstEmployeeId(): Promise<string | null> {
    try {
      const r = await api.getEmployees({ signal });
      return r.employees[0]?.id ?? null;
    } catch { return null; }
  }

  function startCooldown() {
    cooldown = setTimeout(() => { cooldown = undefined; maybeCheckRun(); }, runCheckMs);
  }

  /**
   * Reads the run ID from the map. Another run ID marks the business list for a reload; the next dashboard
   * dispatch carries it. A failed check keeps the old run ID and is repeated after the cooldown.
   */
  async function checkRun(): Promise<void> {
    checkWanted = false;
    checking = true;
    startCooldown();
    try {
      const m = await api.getMap({ signal });
      if (!live()) return;
      if (runId !== null && m.runId !== runId) { runEpoch += 1; haveBusinesses = false; }
      runId = m.runId;
    } catch {
      if (live()) { checkWanted = true; if (cooldown === undefined) startCooldown(); }
    } finally {
      checking = false;
      maybeCheckRun();
    }
  }

  /** Starts a wanted check unless one is in flight or the last one began less than `runCheckMs` ago. */
  function maybeCheckRun() {
    if (live() && checkWanted && !checking && cooldown === undefined) void checkRun();
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
      if (!runAsked) {
        runAsked = true;
        await checkRun();
        if (!live()) return;
      } else if (dash.value.version !== lastVersion || runId === null) {
        checkWanted = true;
        maybeCheckRun(); // not awaited: the dashboard never waits for the map
      }
      lastVersion = dash.value.version;
      dispatch({ type: 'dashboard', dashboard: dash.value, runId });
      if (!haveBusinesses) await loadBusinesses();
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
      if (cooldown) clearTimeout(cooldown);
      cooldown = undefined;
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
