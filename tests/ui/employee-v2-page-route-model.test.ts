import { describe, expect, it } from 'vitest';
import type { MapResponse } from '../../shared/v2/api';
import { ApiRequestError, type RequestOptions } from '../../client/src/api/v2';
import {
  MAP_FAILED_TEXT, MAP_LOADING_TEXT, createRunMapLoader, initialRunMapState, runMapReducer, runMapSlot,
  type RunMapAction, type RunMapState,
} from '../../client/src/components/employee/v2/page/runMapModel';

const mapFor = (runId: string): MapResponse => ({ runId, businesses: [], homes: [], employees: [], polylines: [] });

type Call = { signal: AbortSignal; resolve: (m: MapResponse) => void; reject: (e: unknown) => void };

/** A fake getMap that records every request and lets the test settle it; rejects on abort like `request`. */
function harness() {
  const calls: Call[] = [];
  let state: RunMapState = initialRunMapState;
  const actions: RunMapAction[] = [];
  const getMap = (opts?: RequestOptions) => new Promise<MapResponse>((resolve, reject) => {
    const signal = opts!.signal!;
    signal.addEventListener('abort', () => reject(new ApiRequestError(0, 'Request aborted', undefined, 'abort')));
    calls.push({ signal, resolve, reject });
  });
  const loader = createRunMapLoader(getMap, (a) => { actions.push(a); state = runMapReducer(state, a); });
  return { calls, actions, loader, get state() { return state; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('run map loader', () => {
  it('waits for a run ID, then requests once on first load', async () => {
    const h = harness();
    h.loader.sync(null);
    expect(h.calls).toHaveLength(0);
    expect(runMapSlot(h.state)).toEqual({ kind: 'none' });
    h.loader.sync('run-1');
    expect(h.calls).toHaveLength(1);
    expect(runMapSlot(h.state)).toEqual({ kind: 'loading', text: MAP_LOADING_TEXT });
    h.calls[0].resolve(mapFor('run-1'));
    await flush();
    expect(runMapSlot(h.state)).toEqual({ kind: 'map', map: mapFor('run-1') });
  });

  it('never requests again on a poll with the same run', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.calls[0].resolve(mapFor('run-1'));
    await flush();
    for (let i = 0; i < 10; i++) h.loader.sync('run-1');
    h.loader.sync(null); // a poll before the run is known again is not a change either
    h.loader.sync('run-1');
    expect(h.calls).toHaveLength(1);
  });

  it('requests again on a run change, aborting the pending request and dropping the old map', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.calls[0].resolve(mapFor('run-1'));
    await flush();
    h.loader.sync('run-2');
    expect(h.calls).toHaveLength(2);
    expect(runMapSlot(h.state).kind).toBe('loading'); // the old city's map is not shown for the new run
    h.loader.sync('run-3');
    expect(h.calls[1].signal.aborted).toBe(true);
    h.calls[2].resolve(mapFor('run-3'));
    await flush();
    expect(h.state.map?.runId).toBe('run-3');
    expect(h.actions.filter((a) => a.type === 'failed')).toHaveLength(0); // the abort was silent
  });

  it('requests again after a commute save and keeps the old map on screen meanwhile', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.calls[0].resolve(mapFor('run-1'));
    await flush();
    h.loader.refresh();
    expect(h.calls).toHaveLength(2);
    expect(runMapSlot(h.state)).toEqual({ kind: 'map', map: mapFor('run-1') });
    const fresh = { ...mapFor('run-1'), polylines: [{ from: 'biz-a', to: 'home-c-1_2', encoded: null }] };
    h.calls[1].resolve(fresh);
    await flush();
    expect(h.state.map).toBe(fresh);
  });

  it('a refresh before any run is known does nothing', () => {
    const h = harness();
    h.loader.refresh();
    expect(h.calls).toHaveLength(0);
  });

  it('stop (unmount or employee switch) aborts silently and drops late results', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.loader.stop();
    expect(h.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(h.actions.map((a) => a.type)).toEqual(['start']);
    h.loader.sync('run-2');
    h.loader.retry();
    expect(h.calls).toHaveLength(1);
  });

  it('a failure shows a message, and Retry requests again', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.calls[0].reject(new ApiRequestError(500, 'Server error'));
    await flush();
    expect(runMapSlot(h.state)).toEqual({ kind: 'failed', text: MAP_FAILED_TEXT, map: null });
    h.loader.retry();
    expect(h.calls).toHaveLength(2);
    expect(runMapSlot(h.state).kind).toBe('loading');
    h.calls[1].resolve(mapFor('run-1'));
    await flush();
    expect(runMapSlot(h.state).kind).toBe('map');
  });

  it('a failed refresh after a save keeps the old map with the Retry message', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.calls[0].resolve(mapFor('run-1'));
    await flush();
    h.loader.refresh();
    h.calls[1].reject(new ApiRequestError(0, 'Network down'));
    await flush();
    expect(runMapSlot(h.state)).toEqual({ kind: 'failed', text: MAP_FAILED_TEXT, map: mapFor('run-1') });
  });

  it('a 503 travel_data_missing shows nothing extra in the slot', async () => {
    const h = harness();
    h.loader.sync('run-1');
    h.calls[0].reject(new ApiRequestError(503, 'NYC travel data is missing', undefined, 'http', 'travel_data_missing'));
    await flush();
    expect(runMapSlot(h.state)).toEqual({ kind: 'none' });
  });
});

describe('runMapReducer', () => {
  it('ignores an abort and resets to idle', () => {
    const loading = runMapReducer(initialRunMapState, { type: 'start', keepMap: false });
    expect(runMapReducer(loading, { type: 'failed', error: new ApiRequestError(0, 'x', undefined, 'abort') })).toBe(loading);
    expect(runMapReducer(loading, { type: 'reset' })).toEqual(initialRunMapState);
  });
});
