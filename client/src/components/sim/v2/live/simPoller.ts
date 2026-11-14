// The 1 s poll of GET /api/v2/simulator plus the heavier GET /api/v2/map (#380). The map is fetched when
// its key (runId + sorted plan IDs) changes, and again later (#528): while a plan leg has no route line
// (a live delivery's lines arrive after its response, DECISIONS pass 47) after 2, 4, 8, 16 and 30 s, and
// otherwise every 30 s, so a commute saved in another tab shows up. No React: the API functions and the
// sink are arguments, so tests drive it with fakes and fake timers.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { RequestOptions } from '../../../../api/v2';
import { mapKey, planLegsMissingLine, type SimDataAction } from './simDataModel';

export const SIM_POLL_MS = 1000;
/** Waits before each refetch while a plan leg has no line: 5 tries for one map key. */
export const MAP_RETRY_DELAYS_MS = [2000, 4000, 8000, 16_000, 30_000] as const;
/** Slow refresh once nothing is missing (or the tries are used up). */
export const MAP_REFRESH_MS = 30_000;
/** At most one map request per this many ms (a new key waits for the rest of the gap). */
export const MAP_MIN_GAP_MS = 2000;

export type SimPollerApi = {
  getSimulator: (opts?: RequestOptions) => Promise<SimulatorResponse>;
  getMap: (opts?: RequestOptions) => Promise<MapResponse>;
};

export type SimPollerSink = (action: SimDataAction) => void;

export type SimPoller = {
  /** Polls at once, then every `intervalMs`. A tick is skipped while the previous one is still open. */
  start(): void;
  /** Clears every timer and aborts the open request; nothing reaches the sink afterwards. */
  stop(): void;
  /**
   * Aborts the open request (its answer may predate a write that was just applied) and polls at once.
   * Resolves when that poll, and the map fetch it may trigger, has settled. No-op while stopped.
   */
  refetchNow(): Promise<void>;
};

type Entry = { ctl: AbortController; done: Promise<void>; kind: 'poll' | 'map' };

export function createSimPoller(
  api: SimPollerApi, sink: SimPollerSink, { intervalMs = SIM_POLL_MS }: { intervalMs?: number } = {},
): SimPoller {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
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
  let lastMapRequestAt = -Infinity;

  function clearMapTimer() {
    if (mapTimer !== null) clearTimeout(mapTimer);
    mapTimer = null;
  }

  function scheduleMap(delayMs: number) {
    clearMapTimer();
    if (!running) return;
    mapTimer = setTimeout(() => {
      mapTimer = null;
      if (!running) return;
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

  async function poll(signal: AbortSignal): Promise<void> {
    try {
      const sim = await api.getSimulator({ signal });
      if (signal.aborted) return;
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
    if (!running) return Promise.resolve();
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

  return {
    start() {
      if (running) return;
      running = true;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop() {
      running = false;
      if (timer !== null) clearInterval(timer);
      timer = null;
      clearMapTimer();
      abortOpen();
    },
    refetchNow() {
      if (!running) return Promise.resolve();
      abortOpen();
      return tick();
    },
  };
}
