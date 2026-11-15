// The 1 s poll of GET /api/v2/simulator plus the heavier GET /api/v2/map (#380). The map is fetched when
// its key (runId + sorted plan IDs) changes, and again later (#528): while a plan leg has no route line
// (a live delivery's lines arrive after its response, DECISIONS pass 47) after 2, 4, 8, 16 and 30 s, and
// otherwise every 30 s, so a commute saved in another tab shows up. No React: the API functions and the
// sink are arguments, so tests drive it with fakes and fake timers.
//
// Calm in every state (#921): while the tab is hidden nothing is asked (the open request is aborted, the
// 1 s poll and the map timer pause; a Play keeps running on the server) and on return it polls at once.
// While the server cannot be reached the poll backs off (1, 2, 4, 8, 10, 10… s) and goes back to 1 s on
// the first answer of any kind. stop() on leave clears every timer and the visibility listener.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import { isNetworkError, type RequestOptions } from '../../../../api/v2';
import { mapKey, planLegsMissingLine, type SimDataAction } from './simDataModel';

export const SIM_POLL_MS = 1000;
/** Waits before each refetch while a plan leg has no line: 5 tries for one map key. */
export const MAP_RETRY_DELAYS_MS = [2000, 4000, 8000, 16_000, 30_000] as const;
/** Slow refresh once nothing is missing (or the tries are used up). */
export const MAP_REFRESH_MS = 30_000;
/** At most one map request per this many ms (a new key waits for the rest of the gap). */
export const MAP_MIN_GAP_MS = 2000;
/** Longest wait between two polls while the server cannot be reached. */
export const SIM_BACKOFF_MAX_MS = 10_000;

/** Wait before the next poll after `failures` network failures in a row: 1, 2, 4, 8 s, then the cap. */
export function backoffDelayMs(failures: number, intervalMs = SIM_POLL_MS, maxMs = SIM_BACKOFF_MAX_MS): number {
  if (failures <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** Math.min(failures - 1, 20), maxMs);
}

/** Whether the page is hidden, and a way to hear when that changes. Returns the unsubscribe function. */
export type PageVisibility = { hidden(): boolean; onChange(listener: () => void): () => void };

/** The browser tab's visibility; null where there is no `document` (node tests), which counts as visible. */
export function documentVisibility(): PageVisibility | null {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return null;
  return {
    hidden: () => document.hidden === true,
    onChange(listener) {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

export type SimPollerApi = {
  getSimulator: (opts?: RequestOptions) => Promise<SimulatorResponse>;
  getMap: (opts?: RequestOptions) => Promise<MapResponse>;
};

export type SimPollerSink = (action: SimDataAction) => void;

export type SimPoller = {
  /**
   * Polls at once, then every `intervalMs`. A tick is skipped while the previous one is still open.
   * In a hidden tab the first poll waits until the tab is shown.
   */
  start(): void;
  /** Clears every timer and the visibility listener and aborts the open request; nothing reaches the sink afterwards. */
  stop(): void;
  /**
   * Aborts the open request (its answer may predate a write that was just applied) and polls at once.
   * Resolves when that poll, and the map fetch it may trigger, has settled. No-op while stopped or hidden
   * (the poll on return picks up whatever changed).
   */
  refetchNow(): Promise<void>;
};

type Entry = { ctl: AbortController; done: Promise<void>; kind: 'poll' | 'map' };

export type SimPollerOptions = {
  intervalMs?: number;
  /** Longest back-off wait while the server cannot be reached. */
  backoffMaxMs?: number;
  /** Defaults to the browser tab (`documentVisibility()`); null = always visible. */
  visibility?: PageVisibility | null;
};

type PollTimer =
  | { kind: 'interval'; id: ReturnType<typeof setInterval> }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

export function createSimPoller(
  api: SimPollerApi, sink: SimPollerSink,
  { intervalMs = SIM_POLL_MS, backoffMaxMs = SIM_BACKOFF_MAX_MS, visibility = documentVisibility() }: SimPollerOptions = {},
): SimPoller {
  let running = false;
  /** The 1 s interval, or the one back-off timeout after a network failure. */
  let pollTimer: PollTimer | null = null;
  /** Network failures of the poll in a row; any answer from the server resets it. */
  let failures = 0;
  let hidden = false;
  let unsubscribe: (() => void) | null = null;
  let open: Entry | null = null;
  /** A 1 s tick that arrived while a map-only refetch was open: it runs right after, so no tick is lost. */
  let queuedPoll: Promise<void> | null = null;
  /** Key of the last map that reached the sink; a different key on a poll triggers a map fetch. */
  let loadedMapKey: string | null = null;
  let loadedMap: MapResponse | null = null;
  let lastSim: SimulatorResponse | null = null;
  /** Refetches already scheduled for `loadedMapKey` because a plan leg had no line. */
  let tries = 0;
  /** A refetch is due: the next poll (or the map timer, when nothing is open) fetches the map. */
  let mapDue = false;
  let mapTimer: ReturnType<typeof setTimeout> | null = null;
  /** When `mapTimer` fires (Date.now() time); kept while hidden so the timer resumes on return. */
  let mapTimerAt: number | null = null;
  let lastMapRequestAt = -Infinity;

  function clearMapTimer() {
    if (mapTimer !== null) clearTimeout(mapTimer);
    mapTimer = null;
    mapTimerAt = null;
  }

  function scheduleMap(delayMs: number) {
    clearMapTimer();
    if (!running) return;
    mapTimerAt = Date.now() + Math.max(0, delayMs);
    if (hidden) return; // armed again from `mapTimerAt` when the tab is shown
    mapTimer = setTimeout(() => {
      mapTimer = null;
      mapTimerAt = null;
      if (!running || hidden) return;
      mapDue = true;
      // Nothing open: fetch now. A poll that is open waits for its answer and then sees `mapDue`.
      if (!open) void startEntry('map', refreshMap);
    }, Math.max(0, delayMs));
  }

  /** After a map reached the sink, or a refetch failed: the next retry or the slow refresh. */
  function scheduleNext() {
    const missing = lastSim !== null && loadedMap !== null && planLegsMissingLine(lastSim, loadedMap);
    if (missing && tries < MAP_RETRY_DELAYS_MS.length) scheduleMap(MAP_RETRY_DELAYS_MS[tries++]);
    else scheduleMap(MAP_REFRESH_MS);
  }

  /**
   * Fetches the map for `key`, or, when the last map request is less than MAP_MIN_GAP_MS old, marks it
   * due and fetches it once the gap has passed (so a new key waits at most 2 s).
   */
  async function maybeLoadMap(signal: AbortSignal, key: string): Promise<void> {
    const wait = lastMapRequestAt + MAP_MIN_GAP_MS - Date.now();
    if (wait > 0) {
      mapDue = true;
      scheduleMap(wait);
      return;
    }
    const refresh = key === loadedMapKey;
    mapDue = false;
    clearMapTimer();
    lastMapRequestAt = Date.now();
    let map: MapResponse;
    try {
      map = await api.getMap({ signal });
    } catch (e) {
      if (signal.aborted) { mapDue = true; return; } // our own abort: the next poll fetches it
      if (refresh) {
        // A failed refetch keeps the loaded map, counts as one try and shows no page error.
        scheduleNext();
        return;
      }
      sink({ type: 'pollFailed', error: e });
      return; // the key still differs, so the next poll tries again
    }
    if (signal.aborted) { mapDue = true; return; }
    if (!refresh) { loadedMapKey = key; tries = 0; }
    loadedMap = map;
    sink({ type: 'map', map });
    scheduleNext();
  }

  function clearPollTimer() {
    if (pollTimer?.kind === 'interval') clearInterval(pollTimer.id);
    else if (pollTimer) clearTimeout(pollTimer.id);
    pollTimer = null;
  }

  /** The 1 s interval while the server answers, one back-off timeout after a network failure. */
  function armPollTimer() {
    clearPollTimer();
    if (!running || hidden) return;
    if (failures === 0) {
      pollTimer = { kind: 'interval', id: setInterval(() => void tick(), intervalMs) };
      return;
    }
    const id = setTimeout(() => { pollTimer = null; void tick(); }, backoffDelayMs(failures, intervalMs, backoffMaxMs));
    pollTimer = { kind: 'timeout', id };
  }

  /** The server answered (data or an HTTP error): back to the 1 s rhythm if it was backing off. */
  function serverAnswered() {
    if (failures === 0) return;
    failures = 0;
    armPollTimer();
  }

  async function poll(signal: AbortSignal): Promise<void> {
    try {
      let sim: SimulatorResponse;
      try {
        sim = await api.getSimulator({ signal });
      } catch (e) {
        if (signal.aborted) return; // our own abort (stop, hide or refetchNow): silent
        if (isNetworkError(e)) { failures++; armPollTimer(); } else serverAnswered();
        throw e;
      }
      if (signal.aborted) return;
      serverAnswered();
      lastSim = sim;
      sink({ type: 'sim', sim });
      const key = mapKey(sim);
      if (key === loadedMapKey && !mapDue) return;
      // Same tick, one request at a time: the map waits for the poll and the next tick waits for the map.
      await maybeLoadMap(signal, key);
    } catch (e) {
      if (signal.aborted) return; // our own abort (stop or refetchNow): silent
      sink({ type: 'pollFailed', error: e });
    }
  }

  async function refreshMap(signal: AbortSignal): Promise<void> {
    if (lastSim === null) return;
    await maybeLoadMap(signal, mapKey(lastSim));
  }

  function startEntry(kind: Entry['kind'], body: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const ctl = new AbortController();
    const entry: Entry = { ctl, done: Promise.resolve(), kind };
    open = entry;
    entry.done = body(ctl.signal).finally(() => {
      if (open === entry) open = null;
    });
    return entry.done;
  }

  function tick(): Promise<void> {
    if (!running || hidden) return Promise.resolve();
    if (open?.kind === 'map') {
      // The 1 s poll keeps its rhythm: it runs as soon as the map refetch is done.
      queuedPoll ??= open.done.then(() => { queuedPoll = null; return tick(); });
      return queuedPoll;
    }
    if (open) return open.done; // never two requests in flight
    return startEntry('poll', poll);
  }

  function abortOpen() {
    open?.ctl.abort();
    open = null;
  }

  function onVisibilityChange() {
    if (!running || !visibility) return;
    const nowHidden = visibility.hidden();
    if (nowHidden === hidden) return;
    hidden = nowHidden;
    if (hidden) {
      // Stop asking: no timer runs and the open request is dropped (an aborted map fetch stays due).
      clearPollTimer();
      if (mapTimer !== null) clearTimeout(mapTimer);
      mapTimer = null; // `mapTimerAt` is kept
      abortOpen();
      return;
    }
    // Back: poll once at once, then the usual rhythm (or the back-off, if the server was away).
    void tick();
    armPollTimer();
    if (mapTimerAt !== null) scheduleMap(mapTimerAt - Date.now());
  }

  return {
    start() {
      if (running) return;
      running = true;
      hidden = visibility?.hidden() ?? false;
      unsubscribe = visibility?.onChange(onVisibilityChange) ?? null;
      void tick();
      armPollTimer();
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      clearPollTimer();
      failures = 0;
      clearMapTimer();
      abortOpen();
    },
    refetchNow() {
      if (!running || hidden) return Promise.resolve();
      abortOpen();
      return tick();
    },
  };
}
