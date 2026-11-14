// The 1 s poll of GET /api/v2/simulator plus the heavier GET /api/v2/map, fetched only when its key
// (runId + sorted plan IDs) changes (#380). No React: the API functions and the sink are arguments,
// so tests drive it with fakes and fake timers.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { RequestOptions } from '../../../../api/v2';
import { mapKey, type SimDataAction } from './simDataModel';

export const SIM_POLL_MS = 1000;

export type SimPollerApi = {
  getSimulator: (opts?: RequestOptions) => Promise<SimulatorResponse>;
  getMap: (opts?: RequestOptions) => Promise<MapResponse>;
};

export type SimPollerSink = (action: SimDataAction) => void;

export type SimPoller = {
  /** Polls at once, then every `intervalMs`. A tick is skipped while the previous one is still open. */
  start(): void;
  /** Clears the timer and aborts the open request; nothing reaches the sink afterwards. */
  stop(): void;
  /**
   * Aborts the open request (its answer may predate a write that was just applied) and polls at once.
   * Resolves when that poll, and the map fetch it may trigger, has settled. No-op while stopped.
   */
  refetchNow(): Promise<void>;
};

export function createSimPoller(
  api: SimPollerApi, sink: SimPollerSink, { intervalMs = SIM_POLL_MS }: { intervalMs?: number } = {},
): SimPoller {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let open: { ctl: AbortController; done: Promise<void> } | null = null;
  /** Key of the last map that reached the sink; a different key on a poll triggers a map fetch. */
  let loadedMapKey: string | null = null;

  async function poll(signal: AbortSignal): Promise<void> {
    try {
      const sim = await api.getSimulator({ signal });
      if (signal.aborted) return;
      sink({ type: 'sim', sim });
      const key = mapKey(sim);
      if (key === loadedMapKey) return;
      // Same tick, one request at a time: the map waits for the poll and the next tick waits for the map.
      const map = await api.getMap({ signal });
      if (signal.aborted) return;
      loadedMapKey = key;
      sink({ type: 'map', map });
    } catch (e) {
      if (signal.aborted) return; // our own abort (stop or refetchNow): silent
      sink({ type: 'pollFailed', error: e });
    }
  }

  function tick(): Promise<void> {
    if (!running) return Promise.resolve();
    if (open) return open.done; // never two requests in flight
    const ctl = new AbortController();
    const entry: { ctl: AbortController; done: Promise<void> } = { ctl, done: Promise.resolve() };
    open = entry;
    entry.done = poll(ctl.signal).finally(() => {
      if (open === entry) open = null;
    });
    return entry.done;
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
      abortOpen();
    },
    refetchNow() {
      if (!running) return Promise.resolve();
      abortOpen();
      return tick();
    },
  };
}
