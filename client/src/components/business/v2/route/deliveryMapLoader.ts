// When the Business page requests GET /api/v2/map for the delivery route map (#549, DECISIONS pass 52):
// once per run, and again when the open delivery's plan is one the loaded map does not list (a new
// delivery or a re-match since the map was fetched). Never on the 1 s poll: a sync with the same run and
// a plan the map already covers does nothing, and a plan is refetched for at most once.
// A pure reducer for what the slot shows and a small loader; every request has its own AbortController
// and a newer request or unmount aborts the old one silently (DECISIONS pass 14).
import type { MapResponse } from '../../../../../../shared/v2/api';
import type { DeliveryPlan } from '../../../../../../shared/v2/types';
import { isAbortError, type RequestOptions } from '../../../../api/v2';
import { LOAD_ERROR_TEXT, MAP_LOADING_TEXT } from '../../../map/mapModel';
import { mapCoversPlan, planKey } from './deliveryRouteModel';

// The words of the shared map placeholder (#890), so the line does not change when the map takes over.
export const ROUTE_MAP_LOADING_TEXT = MAP_LOADING_TEXT;
export const ROUTE_MAP_FAILED_TEXT = LOAD_ERROR_TEXT;

export type DeliveryMapState = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** The last map that arrived; kept while a refetch is pending so the map doesn't flicker. */
  map: MapResponse | null;
  /** The pending request was started by Retry (set only then). */
  retrying?: true;
};

export type DeliveryMapAction =
  | { type: 'start'; keepMap: boolean; retry?: true }
  | { type: 'loaded'; map: MapResponse }
  | { type: 'failed' };

export const initialDeliveryMapState: DeliveryMapState = { status: 'idle', map: null };

export function deliveryMapReducer(s: DeliveryMapState, a: DeliveryMapAction): DeliveryMapState {
  switch (a.type) {
    case 'start': return { status: 'loading', map: a.keepMap ? s.map : null, ...(a.retry ? { retrying: true as const } : {}) };
    case 'loaded': return { status: 'ready', map: a.map };
    case 'failed': return { status: 'failed', map: s.map };
  }
}

export type DeliveryMapSlot =
  | { kind: 'none' }
  | { kind: 'loading'; text: string; retrying?: true }
  | { kind: 'failed'; text: string }
  | { kind: 'map'; map: MapResponse };

/** A failed request shows the placeholder with Retry, even when an older map is kept. */
export function deliveryMapSlot(s: DeliveryMapState): DeliveryMapSlot {
  if (s.status === 'failed') return { kind: 'failed', text: ROUTE_MAP_FAILED_TEXT };
  if (s.map) return { kind: 'map', map: s.map };
  if (s.status === 'loading') return { kind: 'loading', text: ROUTE_MAP_LOADING_TEXT, ...(s.retrying ? { retrying: true as const } : {}) };
  return { kind: 'none' };
}

export type GetMap = (opts?: RequestOptions) => Promise<MapResponse>;

export type DeliveryMapLoader = {
  /** Called on every render with the page's run ID and the open delivery's plan (null if none). */
  sync: (runId: string | null, plan: DeliveryPlan | null) => void;
  retry: () => void;
  stop: () => void;
};

export function createDeliveryMapLoader(getMap: GetMap, dispatch: (a: DeliveryMapAction) => void): DeliveryMapLoader {
  let runId: string | null = null;
  let map: MapResponse | null = null;
  let ctl: AbortController | null = null;
  let stopped = false;
  /** Plan keys already refetched for in this run. */
  const tried = new Set<string>();

  function load(keepMap: boolean, retry = false) {
    if (stopped || runId === null) return;
    ctl?.abort();
    const mine = new AbortController();
    ctl = mine;
    if (!keepMap) map = null;
    dispatch({ type: 'start', keepMap, ...(retry ? { retry: true as const } : {}) });
    getMap({ signal: mine.signal }).then(
      (m) => {
        if (ctl !== mine || mine.signal.aborted) return;
        ctl = null;
        map = m;
        dispatch({ type: 'loaded', map: m });
      },
      (e: unknown) => {
        if (ctl !== mine || mine.signal.aborted || isAbortError(e)) return;
        ctl = null;
        dispatch({ type: 'failed' });
      },
    );
  }

  return {
    sync(nextRun, plan) {
      if (stopped || nextRun === null) return;
      if (nextRun !== runId) {
        runId = nextRun;
        tried.clear();
        load(false);
        return;
      }
      // Wait for the pending request; a failed one waits for Retry.
      if (!plan || !map || ctl) return;
      const key = planKey(plan);
      if (tried.has(key) || mapCoversPlan(map, plan)) return;
      tried.add(key);
      load(true);
    },
    retry: () => load(true, true),
    stop() {
      stopped = true;
      ctl?.abort();
      ctl = null;
    },
  };
}
