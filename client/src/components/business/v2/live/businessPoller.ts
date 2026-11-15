// Polls one business's v2 dashboard every second (#386), plus the business and employee directories.
// The open delivery (`watch`) is read with the same poll when the dashboard does not list it (#581): a
// package held here as the relay point is in neither `outgoing` nor `incoming`.
// API functions are injected, so tests run in Node with fake timers. A poller belongs to one business:
// `stop()` aborts what is in flight and nothing reaches the sink afterwards (the hook stops it and makes
// a new poller when the business ID changes, so a late answer for the old ID is dropped).
//
// The dashboard has no run ID, so the run is read from the map (#599, DECISIONS pass 61). That request is
// large, so it runs beside the poll, at most once every 5 s, and the dashboard never waits for it.
//
// Calm rules (issue 900), so the page never loops or piles up requests:
// - one poll at a time: the next one is timed only after the last one ended, and `refetchNow()` during a
//   poll adds one poll after it, however often it is called;
// - while the server is down (no answer, a timeout or a 5xx) the wait doubles: 1 s, 2 s, 4 s, 8 s, then
//   10 s. The first good answer brings back the 1 s rate. The run check waits for that answer too;
// - while the tab is hidden nothing is timed, and the return to the tab polls once, at once;
// - `stop()` ends all of it: timers, requests in flight and the tab listener.
import type {
  BusinessDashboard, BusinessesResponse, EmployeesResponse, ShipmentView,
} from '../../../../../../shared/v2/api';
import { ApiRequestError, isAbortError, type RequestOptions } from '../../../../api/v2';
import { toDirectoryEmployees, type BusinessWorkspaceAction } from './businessWorkspaceState';

export const POLL_INTERVAL_MS = 1000;
/** The shortest time between two run checks (start to start). */
export const RUN_CHECK_INTERVAL_MS = 5000;
/** The longest wait between two polls while the server is down. */
export const MAX_BACKOFF_MS = 10_000;

/**
 * The wait before the next poll after `failures` polls in a row found the server down:
 * the normal interval after none or one, then twice as long each time, up to `maxMs`.
 */
export function pollDelayMs(failures: number, intervalMs = POLL_INTERVAL_MS, maxMs = MAX_BACKOFF_MS): number {
  if (failures <= 1) return intervalMs;
  // The exponent is capped so a long outage cannot overflow to Infinity.
  return Math.min(Math.max(maxMs, intervalMs), intervalMs * 2 ** Math.min(failures - 1, 30));
}

/** Whether the page is in a hidden tab, and a way to hear about changes. Injected in tests. */
export type PageVisibility = {
  hidden: () => boolean;
  /** Calls `onChange` whenever the tab is hidden or shown; returns the function that ends it. */
  subscribe: (onChange: () => void) => () => void;
};

/** The browser's tab visibility; null outside a browser (Node tests), where the poller never pauses. */
export function documentVisibility(): PageVisibility | null {
  if (typeof document === 'undefined') return null;
  return {
    hidden: () => document.hidden,
    subscribe: (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
  };
}

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
/** No answer (network, timeout), a 5xx, or something that is not an API error at all. A 4xx is an answer. */
const isServerDown = (e: unknown) => !(e instanceof ApiRequestError) || e.status === 0 || e.status >= 500;

export type BusinessPollerOptions = {
  intervalMs?: number;
  runCheckMs?: number;
  maxBackoffMs?: number;
  /** Default: the browser's tab visibility. Null = never pause. */
  visibility?: PageVisibility | null;
};

export function createBusinessPoller(
  businessId: string,
  api: BusinessWorkspaceApi,
  sink: BusinessPollerSink,
  {
    intervalMs = POLL_INTERVAL_MS, runCheckMs = RUN_CHECK_INTERVAL_MS, maxBackoffMs = MAX_BACKOFF_MS,
    visibility = documentVisibility(),
  }: BusinessPollerOptions = {},
): BusinessPoller {
  const ctl = new AbortController();
  const { signal } = ctl;
  let started = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiters: (() => void)[] = [];
  /** Polls in a row that found the server down; 0 after any answer. */
  let failures = 0;
  const tabHidden = () => visibility?.hidden() ?? false;
  let wasHidden = tabHidden();
  let unsubscribe: (() => void) | undefined;
  /** Reads of the open delivery are numbered: an answer older than the one shown is dropped. */
  let heldAsked = 0;
  let heldShown = 0;
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
   * While the server is down or the tab is hidden no check is sent; the next good dashboard asks again.
   */
  function checkRun(): void {
    if (!live() || !runDirty || runChecking || runCooldown || failures > 0 || tabHidden()) return;
    runDirty = false;
    runChecking = true;
    runCooldown = setTimeout(() => { runCooldown = undefined; checkRun(); }, runCheckMs);
    void api.getMap({ signal })
      .then((m) => { if (live()) onRun(m.runId); }, () => { runDirty = true; })
      .finally(() => { runChecking = false; checkRun(); });
  }

  /**
   * The open delivery, when it is not one of the dashboard's own. An answer for a delivery closed meanwhile
   * is dropped. So is a slow answer that a later read overtook (a run change reads beside the poll): the
   * older answer never replaces the newer one.
   */
  async function loadHeld(): Promise<void> {
    const id = watched;
    if (!id || !ownIds || ownIds.has(id)) return;
    heldAsked += 1;
    const asked = heldAsked;
    const current = () => live() && watched === id && asked > heldShown;
    try {
      const view = await api.getShipment(id, { signal });
      if (!current()) return;
      heldShown = asked;
      dispatch({ type: 'held', shipmentId: id, view });
    } catch (e) {
      if (isAbortError(e) || !current()) return;
      heldShown = asked;
      dispatch({ type: is404(e) ? 'heldMissing' : 'heldFailed', shipmentId: id });
    }
  }

  /** One poll. It also keeps `failures`: up by one when the server is down, back to 0 on any answer. */
  async function poll(): Promise<void> {
    // Missing directories load together with the dashboard, so the first render has the names.
    const lists = haveDirectories ? null : loadDirectories();
    let dash: BusinessDashboard;
    try {
      dash = await api.getBusinessDashboard(businessId, { signal });
    } catch (e) {
      if (!live() || isAbortError(e)) return;
      shownDash = null;
      failures = isServerDown(e) ? failures + 1 : 0;
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
    failures = 0;
    if (dash.version !== lastVersion || runId === null) runDirty = true;
    // Also sends a check that was held back while the server was down or the tab was hidden.
    checkRun();
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

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }
  function schedule(delay: number) {
    clearTimer();
    if (live()) timer = setTimeout(() => { void loop(); }, delay);
  }

  // One request chain at a time: the next tick is scheduled only after the poll finishes.
  async function loop(): Promise<void> {
    if (!live() || inFlight) return;
    clearTimer();
    inFlight = true;
    const mine = waiters;
    waiters = [];
    try { await poll(); } catch { /* sink errors must not stop polling */ } finally {
      inFlight = false;
      mine.forEach((r) => r());
    }
    if (!live()) return;
    // Someone asked during the poll: one more, now. Otherwise the timed poll, which a hidden tab does
    // not get (the return to the tab polls).
    if (waiters.length > 0) schedule(0);
    else if (!tabHidden()) schedule(pollDelayMs(failures, intervalMs, maxBackoffMs));
  }

  const refetchNow = () => new Promise<void>((resolve) => {
    if (!live()) { resolve(); return; }
    waiters.push(resolve);
    if (!inFlight) void loop();
  });

  function onVisibility(): void {
    if (!live()) return;
    const hidden = tabHidden();
    if (hidden === wasHidden) return;
    wasHidden = hidden;
    // Hidden: drop the timed poll (a poll someone is waiting for still runs). Shown again: poll once, now.
    if (hidden) { if (waiters.length === 0) clearTimer(); } else void refetchNow();
  }

  return {
    start: () => {
      if (started || !live()) return;
      started = true;
      wasHidden = tabHidden();
      unsubscribe = visibility?.subscribe(onVisibility);
      // The first poll runs in a hidden tab too, so the page has its data when the tab is opened.
      void loop();
    },
    stop: () => {
      ctl.abort();
      clearTimer();
      if (runCooldown) clearTimeout(runCooldown);
      runCooldown = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
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
