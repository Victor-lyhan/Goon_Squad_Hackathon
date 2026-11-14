// Polls one business's v2 dashboard every second (#386), plus the business and employee directories.
// The open delivery (`watch`) is read with the same poll when the dashboard does not list it (#581): a
// package held here as the relay point is in neither `outgoing` nor `incoming`.
// API functions are injected, so tests run in Node with fake timers. A poller belongs to one business:
// `stop()` aborts what is in flight and nothing reaches the sink afterwards (the hook stops it and makes
// a new poller when the business ID changes, so a late answer for the old ID is dropped).
//
// The dashboard has no run ID, so the run is read from the map (#599, DECISIONS pass 61). That request is
// large, so it runs beside the poll, at most once every 5 s, and the dashboard never waits for it.
import type {
  BusinessDashboard, BusinessesResponse, EmployeesResponse, ShipmentView,
} from '../../../../../../shared/v2/api';
import { ApiRequestError, isAbortError, type RequestOptions } from '../../../../api/v2';
import { toDirectoryEmployees, type BusinessWorkspaceAction } from './businessWorkspaceState';

export const POLL_INTERVAL_MS = 1000;
/** The shortest time between two run checks (start to start). */
export const RUN_CHECK_INTERVAL_MS = 5000;

/** The v2 helpers the poller needs (same signatures as `client/src/api/v2`). */
export type BusinessWorkspaceApi = {
  getBusinessDashboard: (id: string, opts?: RequestOptions) => Promise<BusinessDashboard>;
  getBusinesses: (opts?: RequestOptions) => Promise<BusinessesResponse>;
  getEmployees: (opts?: RequestOptions) => Promise<EmployeesResponse>;
  /** Only `runId` is read: the dashboard has none, so version changes are checked against the map's run. */
  getMap: (opts?: RequestOptions) => Promise<{ runId: string }>;
  /** GET /api/v2/shipments/:id, for the open delivery the dashboard does not list. */
  getShipment: (id: string, opts?: RequestOptions) => Promise<ShipmentView>;
};

export type BusinessPollerSink = { dispatch: (a: BusinessWorkspaceAction) => void };

export type BusinessPoller = {
  start: () => void;
  stop: () => void;
  /** Polls now (or right after the poll in flight) and resolves when that poll is done. */
  refetchNow: () => Promise<void>;
  /**
   * Names the open delivery (`?shipment=`), null when none is open. One the dashboard does not list is read
   * with `getShipment` on every poll while it is open, and at once when it is opened.
   */
  watch: (shipmentId: string | null) => void;
};

const is404 = (e: unknown) => e instanceof ApiRequestError && e.status === 404;

export function createBusinessPoller(
  businessId: string,
  api: BusinessWorkspaceApi,
  sink: BusinessPollerSink,
  { intervalMs = POLL_INTERVAL_MS, runCheckMs = RUN_CHECK_INTERVAL_MS }: { intervalMs?: number; runCheckMs?: number } = {},
): BusinessPoller {
  const ctl = new AbortController();
  const { signal } = ctl;
  let started = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiters: (() => void)[] = [];
  let lastVersion: number | null = null;
  let runId: string | null = null;
  /** The dashboard on screen; null before the first one and after a failed poll. */
  let shownDash: BusinessDashboard | null = null;
  /** True once a dashboard was dispatched: only the first one waits for the directories. */
  let shown = false;
  let haveDirectories = false;
  let firstBusinessId: string | null = null;
  /** True while the dashboard answers 404: the directories are reloaded once, not every second. */
  let gone = false;
  let watched: string | null = null;
  /** IDs of the last dashboard's own deliveries; null until a dashboard arrived. */
  let ownIds: Set<string> | null = null;
  let dirLoad: Promise<void> | null = null;
  let dirStale = false;
  /** Run check: wanted, in flight, and the 5 s wait that starts with each check. */
  let runDirty = false;
  let runChecking = false;
  let runCooldown: ReturnType<typeof setTimeout> | undefined;

  const live = () => !signal.aborted;
  const dispatch = (a: BusinessWorkspaceAction) => { if (live()) sink.dispatch(a); };

  /**
   * Both directories in one action; a failure leaves them for the next tick to retry. One load at a
   * time: a second caller gets the load in flight, and `fresh` repeats it when it may be out of date.
   */
  function loadDirectories(fresh = false): Promise<void> {
    if (dirLoad) { if (fresh) dirStale = true; return dirLoad; }
    dirLoad = (async () => {
      do {
        dirStale = false;
        try {
          const [b, e] = await Promise.all([api.getBusinesses({ signal }), api.getEmployees({ signal })]);
          if (!live()) return;
          haveDirectories = true;
          firstBusinessId = b.businesses[0]?.id ?? null;
          dispatch({ type: 'directories', businesses: b.businesses, employees: toDirectoryEmployees(e.employees) });
        } catch { /* retried on the next tick */ }
      } while (dirStale && live());
    })().finally(() => { dirLoad = null; });
    return dirLoad;
  }

  /** The check's answer. The dashboard on screen gets the run at once, not at the next poll. */
  function onRun(next: string): void {
    const prev = runId;
    if (next === prev) return;
    runId = next;
    try {
      if (shownDash) dispatch({ type: 'dashboard', dashboard: shownDash, runId });
    } catch { /* sink errors must not stop the reload */ }
    if (prev === null) return;
    // Another run has other businesses and employees. Until the reload works, every poll retries it.
    haveDirectories = false;
    void loadDirectories(true);
    // The state forgot the open held delivery with the old run: read it again now, not at the next poll.
    void loadHeld().catch(() => { /* sink errors; the next poll reads it again */ });
  }

  /**
   * Versions only go up, even for a new city, and they go up on every simulator tick, so the map's run
   * ID is read at most once per `runCheckMs`. A change during the wait or during a check leaves
   * `runDirty` set, so one more check always follows the last change. A failed check is repeated.
   */
  function checkRun(): void {
    if (!live() || !runDirty || runChecking || runCooldown) return;
    runDirty = false;
    runChecking = true;
    runCooldown = setTimeout(() => { runCooldown = undefined; checkRun(); }, runCheckMs);
    void api.getMap({ signal })
      .then((m) => { if (live()) onRun(m.runId); }, () => { runDirty = true; })
      .finally(() => { runChecking = false; checkRun(); });
  }

  /** The open delivery, when it is not one of the dashboard's own. An answer for a delivery closed meanwhile is dropped. */
  async function loadHeld(): Promise<void> {
    const id = watched;
    if (!id || !ownIds || ownIds.has(id)) return;
    try {
      const view = await api.getShipment(id, { signal });
      if (live() && watched === id) dispatch({ type: 'held', shipmentId: id, view });
    } catch (e) {
      if (!live() || isAbortError(e) || watched !== id) return;
      dispatch({ type: is404(e) ? 'heldMissing' : 'heldFailed', shipmentId: id });
    }
  }

  async function poll(): Promise<void> {
    // Missing directories load together with the dashboard, so the first render has the names.
    const lists = haveDirectories ? null : loadDirectories();
    let dash: BusinessDashboard;
    try {
      dash = await api.getBusinessDashboard(businessId, { signal });
    } catch (e) {
      if (!live() || isAbortError(e)) return;
      shownDash = null;
      if (is404(e)) {
        // A stale ID usually means a new city: reload the directories to link to a valid business.
        lastVersion = null;
        ownIds = null;
        if (lists) await lists; else if (!gone) await loadDirectories(true);
        gone = true;
        dispatch({ type: 'notFound', fallbackBusinessId: firstBusinessId });
        return;
      }
      dispatch({ type: 'dashboardFailed', error: e });
      return;
    }
    if (!live()) return;
    gone = false;
    if (dash.version !== lastVersion || runId === null) { runDirty = true; checkRun(); }
    lastVersion = dash.version;
    // Only the first dashboard waits for the names; a failed load does not hold it back.
    if (!shown && lists) await lists;
    if (!live()) return;
    shown = true;
    ownIds = new Set([...dash.outgoing, ...dash.incoming].map((v) => v.shipment.id));
    shownDash = dash;
    try {
      dispatch({ type: 'dashboard', dashboard: dash, runId });
    } finally {
      if (lists) await lists;
    }
    // After the dashboard is on screen, so a held package never delays it.
    if (live()) await loadHeld();
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
      if (runCooldown) clearTimeout(runCooldown);
      runCooldown = undefined;
      const all = waiters; waiters = []; all.forEach((r) => r());
    },
    refetchNow,
    watch: (shipmentId) => {
      if (shipmentId === watched) return;
      watched = shipmentId;
      // Before the first dashboard the running poll reads it; afterwards a click must not wait for the next tick.
      if (shipmentId && started && ownIds && !ownIds.has(shipmentId)) void refetchNow();
    },
  };
}
