// Pure state for the MVP II simulator data layer (#380). No React, no timers, no fetch: tested in Node.
// The poller (simPoller.ts) and the action runner (useSimulatorV2.ts) feed it actions; the page renders it.
import type { MapResponse, SimulatorResponse, TravelUnavailable } from '../../../../../../shared/v2/api';
import { isAbortError, isNetworkError, isTravelUnavailable } from '../../../../api/v2';

export type SimDataView = 'loading' | 'ready' | 'unavailable' | 'error';

export type SimUnavailable = { code: TravelUnavailable['code']; message: string };

export type SimDataState = {
  sim: SimulatorResponse | null;
  map: MapResponse | null;
  /** loading: nothing yet; ready: `sim` is shown; unavailable: the server answered a TravelUnavailable 503; error: the first load failed. */
  view: SimDataView;
  unavailable: SimUnavailable | null;
  /** Message for `view: 'error'` (the first load failed and polling keeps retrying). */
  error: string | null;
  /** True when a poll failed after data was shown: the last data stays on screen. */
  reconnecting: boolean;
  /** True while a control or scenario action is in flight. */
  busy: boolean;
  /** Message of the last failed action (409 and others). Never changes `view`. */
  actionError: string | null;
};

export type SimDataAction =
  | { type: 'sim'; sim: SimulatorResponse }
  | { type: 'map'; map: MapResponse }
  | { type: 'pollFailed'; error: unknown }
  | { type: 'busy'; busy: boolean }
  | { type: 'actionFailed'; message: string }
  | { type: 'dismissActionError' };

export const INITIAL_SIM_DATA: SimDataState = {
  sim: null, map: null, view: 'loading', unavailable: null, error: null,
  reconnecting: false, busy: false, actionError: null,
};

export const TRAVEL_DATA_MISSING_MESSAGE =
  'NYC travel data is not loaded on this server yet. Run npm run fetch:routes and restart.';
export const CONNECTION_LOST_MESSAGE = "Can't reach the Relay server. Retrying every second.";

/** The map depends on the run and the set of plans: `runId` plus the sorted plan IDs. */
export function mapKey(sim: Pick<SimulatorResponse, 'runId' | 'plans'>): string {
  return [sim.runId, ...sim.plans.map((p) => p.id).sort()].join('|');
}

/**
 * True when a neighbouring place pair of any plan leg has no route line in the map: no entry for the
 * ordered pair, or `encoded: null` (#528). A live delivery's lines arrive after its response
 * (DECISIONS pass 47), so the poller refetches the map while this holds. Only compares the two answers.
 */
export function planLegsMissingLine(sim: Pick<SimulatorResponse, 'plans'>, map: Pick<MapResponse, 'polylines'>): boolean {
  const drawn = new Set<string>();
  for (const p of map.polylines) if (p.encoded !== null) drawn.add(`${p.from}\u0000${p.to}`);
  for (const plan of sim.plans) {
    for (const leg of plan.legs ?? []) {
      const ids = leg.placeIds ?? [];
      for (let i = 0; i + 1 < ids.length; i++) {
        if (!drawn.has(`${ids[i]}\u0000${ids[i + 1]}`)) return true;
      }
    }
  }
  return false;
}

/** Deep equality of two JSON answers (plain objects, arrays, primitives); key order does not matter. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k) || !sameJson(ao[k], bo[k])) return false;
  }
  return true;
}

/** The page message for a TravelUnavailable 503: fixed text for missing data, the server's text otherwise. */
export function unavailableMessage(code: SimUnavailable['code'], serverText: string): string {
  return code === 'travel_data_missing' ? TRAVEL_DATA_MISSING_MESSAGE : serverText;
}

/** Message for any failed request; also used for action errors. */
export function errorMessage(e: unknown): string {
  if (isNetworkError(e)) return CONNECTION_LOST_MESSAGE;
  if (isTravelUnavailable(e)) return unavailableMessage(e.code, e.message);
  return e instanceof Error && e.message ? e.message : 'Request failed';
}

/** True when `next` is older than or equal to `shown` (same run, version not higher). */
export function isNotNewer(shown: SimulatorResponse | null, next: SimulatorResponse): boolean {
  return shown !== null && shown.runId === next.runId && next.version <= shown.version;
}

function acceptSim(state: SimDataState, sim: SimulatorResponse): SimDataState {
  const healthy = state.view === 'ready' && !state.reconnecting;
  if (isNotNewer(state.sim, sim)) {
    // Equal or stale: keep what is shown. Only leave a failure state, and keep the identity otherwise
    // so a poll with nothing new never re-renders the page.
    if (healthy) return state;
    return { ...state, view: 'ready', unavailable: null, error: null, reconnecting: false };
  }
  // A new run drops the old map until the refetch lands; within a run the old map stays until then.
  const map = state.map && state.map.runId === sim.runId ? state.map : null;
  return { ...state, sim, map, view: 'ready', unavailable: null, error: null, reconnecting: false };
}

function pollFailed(state: SimDataState, e: unknown): SimDataState {
  if (isAbortError(e)) return state;
  if (isTravelUnavailable(e)) {
    const message = unavailableMessage(e.code, e.message);
    if (state.view === 'unavailable' && state.unavailable?.code === e.code && state.unavailable.message === message
      && !state.reconnecting) return state;
    return { ...state, view: 'unavailable', unavailable: { code: e.code, message }, error: null, reconnecting: false };
  }
  if (state.sim !== null && state.view !== 'unavailable') {
    // After a first success: keep the last data and say we are reconnecting.
    return state.reconnecting ? state : { ...state, reconnecting: true };
  }
  if (state.view === 'unavailable') {
    // The 503 screen stays; a dropped connection on top of it only adds the reconnecting note.
    return state.reconnecting ? state : { ...state, reconnecting: true };
  }
  const error = errorMessage(e);
  const reconnecting = isNetworkError(e);
  if (state.view === 'error' && state.error === error && state.reconnecting === reconnecting) return state;
  return { ...state, view: 'error', error, reconnecting };
}

export function simDataReducer(state: SimDataState, action: SimDataAction): SimDataState {
  switch (action.type) {
    case 'sim':
      return acceptSim(state, action.sim);
    case 'map':
      // A late map of another run is dropped; the poller fetches the right one.
      if (state.sim && action.map.runId !== state.sim.runId) return state;
      // A refetch with the same content keeps the loaded object, so the layers are not rebuilt and the
      // map does not re-fit (#528). A new line, a moved home or another employee list replaces it.
      if (state.map === action.map || (state.map !== null && sameJson(state.map, action.map))) return state;
      return { ...state, map: action.map };
    case 'pollFailed':
      return pollFailed(state, action.error);
    case 'busy':
      return state.busy === action.busy ? state : { ...state, busy: action.busy, actionError: action.busy ? null : state.actionError };
    case 'actionFailed':
      return { ...state, actionError: action.message };
    case 'dismissActionError':
      return state.actionError === null ? state : { ...state, actionError: null };
    default:
      return state;
  }
}
