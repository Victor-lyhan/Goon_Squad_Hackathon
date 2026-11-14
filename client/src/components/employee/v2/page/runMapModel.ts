// The Employee page's GET /api/v2/map, once per run (#463, DECISIONS pass 48). A pure reducer for
// what the route-preview slot shows, and a small loader that decides when to request: the first
// time a run ID is known, when the run ID changes, after a commute save (a new home changes the
// route lines) and on Retry. A poll with the same run never requests. Every request has its own
// AbortController; a newer request, an employee switch and unmount abort the old one, silently
// (DECISIONS pass 14).
import type { MapResponse } from '../../../../../../shared/v2/api';
import { isAbortError, isTravelUnavailable, type RequestOptions } from '../../../../api/v2';

export const MAP_LOADING_TEXT = 'Loading the map…';
export const MAP_FAILED_TEXT = "Couldn't load the map.";

export type RunMapState = {
  /** idle = no run known yet; unavailable = 503 travel_data_missing (the page already says so). */
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';
  /** The last map that arrived; kept while a refresh is pending so the slot doesn't flicker. */
  map: MapResponse | null;
  error: string | null;
};

export type RunMapAction =
  /** `keepMap`: a refresh of the same run keeps the old map on screen; a new run drops it. */
  | { type: 'start'; keepMap: boolean }
  | { type: 'loaded'; map: MapResponse }
  | { type: 'failed'; error: unknown }
  | { type: 'reset' };

export const initialRunMapState: RunMapState = { status: 'idle', map: null, error: null };

export function runMapReducer(s: RunMapState, a: RunMapAction): RunMapState {
  switch (a.type) {
    case 'start':
      return { status: 'loading', map: a.keepMap ? s.map : null, error: null };
    case 'loaded':
      return { status: 'ready', map: a.map, error: null };
    case 'failed':
      if (isAbortError(a.error)) return s; // never reached via the loader; kept so the reducer is safe on its own
      if (isTravelUnavailable(a.error) && a.error.code === 'travel_data_missing') {
        return { status: 'unavailable', map: null, error: null };
      }
      return { ...s, status: 'failed', error: a.error instanceof Error && a.error.message ? a.error.message : 'Request failed' };
    case 'reset':
      return initialRunMapState;
  }
}

export type RunMapSlot =
  | { kind: 'none' }
  | { kind: 'loading'; text: string }
  | { kind: 'failed'; text: string; map: MapResponse | null }
  | { kind: 'map'; map: MapResponse };

/** What the slot shows. A failed refresh after a save keeps the old map but still offers Retry. */
export function runMapSlot(s: RunMapState): RunMapSlot {
  if (s.status === 'unavailable' || s.status === 'idle') return s.map ? { kind: 'map', map: s.map } : { kind: 'none' };
  if (s.status === 'failed') return { kind: 'failed', text: MAP_FAILED_TEXT, map: s.map };
  if (s.map) return { kind: 'map', map: s.map };
  return { kind: 'loading', text: MAP_LOADING_TEXT };
}

export type GetMap = (opts?: RequestOptions) => Promise<MapResponse>;

export type RunMapLoader = {
  /** Called with the page's current run ID on every render/poll; requests only when it changed. */
  sync: (runId: string | null) => void;
  /** After a commute save succeeded: same run, new route lines. */
  refresh: () => void;
  /** The slot's Retry button. */
  retry: () => void;
  /** Aborts the pending request; later results are dropped. */
  stop: () => void;
};

export function createRunMapLoader(getMap: GetMap, dispatch: (a: RunMapAction) => void): RunMapLoader {
  let runId: string | null = null;
  let ctl: AbortController | null = null;
  let stopped = false;

  function load(keepMap: boolean) {
    if (stopped || runId === null) return;
    ctl?.abort();
    const mine = new AbortController();
    ctl = mine;
    dispatch({ type: 'start', keepMap });
    getMap({ signal: mine.signal }).then(
      (map) => { if (ctl === mine && !mine.signal.aborted) dispatch({ type: 'loaded', map }); },
      (e: unknown) => {
        if (ctl !== mine || mine.signal.aborted || isAbortError(e)) return; // silent
        dispatch({ type: 'failed', error: e });
      },
    );
  }

  return {
    sync(next) {
      if (next === null || next === runId) return;
      runId = next;
      load(false);
    },
    refresh: () => load(true),
    retry: () => load(true),
    stop() {
      stopped = true;
      ctl?.abort();
      ctl = null;
    },
  };
}
