// When the Business page requests GET /api/v2/map for the route map (#549, DECISIONS pass 52): once per run,
// again when the open delivery's plan is new to the loaded map, never on the poll, Retry after a failure.
import { describe, expect, it, vi } from 'vitest';
import type { MapResponse } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';
import {
  ROUTE_MAP_FAILED_TEXT, ROUTE_MAP_LOADING_TEXT, createDeliveryMapLoader, deliveryMapReducer, deliveryMapSlot,
  initialDeliveryMapState, type DeliveryMapAction, type DeliveryMapState,
} from '../../client/src/components/business/v2/route/deliveryMapLoader';
import { ApiRequestError } from '../../client/src/api/client';
import { MAP, RECIPIENT, SENDER, directPlan, relayPlan } from './business-v2-route-sample';

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(answers: (() => Promise<MapResponse>)[]) {
  let state: DeliveryMapState = initialDeliveryMapState;
  const getMap = vi.fn((_opts?: { signal?: AbortSignal }) => {
    const next = answers.shift();
    return next ? next() : Promise.resolve(MAP);
  });
  const dispatch = (a: DeliveryMapAction) => { state = deliveryMapReducer(state, a); };
  const loader = createDeliveryMapLoader(getMap, dispatch);
  return { loader, getMap, slot: () => deliveryMapSlot(state), state: () => state };
}

// A plan whose second leg uses a pair MAP does not list.
const newPlan: DeliveryPlan = {
  ...directPlan, id: 'plan-shp-9', shipmentId: 'shp-9',
  legs: [{ ...directPlan.legs[0], stops: [{ ...directPlan.legs[0].stops[0], placeId: RECIPIENT.id }, { ...directPlan.legs[0].stops[1], placeId: SENDER.id }] }],
};

describe('delivery map loader', () => {
  it('requests once per run; polls with the same run and covered plans never request', async () => {
    const h = harness([]);
    h.loader.sync(null, null);
    expect(h.getMap).not.toHaveBeenCalled();
    expect(h.slot()).toEqual({ kind: 'none' });
    h.loader.sync('run-1', null);
    expect(h.slot()).toEqual({ kind: 'loading', text: ROUTE_MAP_LOADING_TEXT });
    await flush();
    expect(h.slot()).toEqual({ kind: 'map', map: MAP });
    for (let i = 0; i < 20; i += 1) h.loader.sync('run-1', i % 2 ? relayPlan : directPlan);
    expect(h.getMap).toHaveBeenCalledTimes(1);
    h.loader.sync('run-2', relayPlan);
    expect(h.getMap).toHaveBeenCalledTimes(2);
  });

  it('requests again when the open plan is not in the loaded map, once per plan, keeping the old map', async () => {
    const h = harness([]);
    h.loader.sync('run-1', null);
    await flush();
    h.loader.sync('run-1', newPlan);
    expect(h.getMap).toHaveBeenCalledTimes(2);
    expect(h.slot()).toEqual({ kind: 'map', map: MAP }); // no flicker while it loads
    await flush();
    // The answer still does not list the pair: no loop.
    for (let i = 0; i < 5; i += 1) h.loader.sync('run-1', newPlan);
    expect(h.getMap).toHaveBeenCalledTimes(2);
  });

  it('a plan seen while a request is pending is checked when the map arrives', async () => {
    const h = harness([]);
    h.loader.sync('run-1', newPlan);
    h.loader.sync('run-1', newPlan);
    expect(h.getMap).toHaveBeenCalledTimes(1);
    await flush();
    h.loader.sync('run-1', newPlan);
    expect(h.getMap).toHaveBeenCalledTimes(2);
  });

  it('a failure shows one line with Retry; Retry requests again', async () => {
    const h = harness([() => Promise.reject(new ApiRequestError(0, 'Network error'))]);
    h.loader.sync('run-1', relayPlan);
    await flush();
    expect(h.slot()).toEqual({ kind: 'failed', text: ROUTE_MAP_FAILED_TEXT });
    h.loader.sync('run-1', relayPlan); // the poll does not retry by itself
    expect(h.getMap).toHaveBeenCalledTimes(1);
    h.loader.retry();
    await flush();
    expect(h.getMap).toHaveBeenCalledTimes(2);
    expect(h.slot()).toEqual({ kind: 'map', map: MAP });
  });

  it('a newer request and stop abort the old one silently', async () => {
    const signals: AbortSignal[] = [];
    const h = harness([]);
    h.getMap.mockImplementation((opts) => { signals.push(opts!.signal!); return new Promise(() => {}); });
    h.loader.sync('run-1', null);
    h.loader.sync('run-2', null);
    expect(signals[0].aborted).toBe(true);
    h.loader.stop();
    expect(signals[1].aborted).toBe(true);
    h.loader.sync('run-3', null);
    expect(h.getMap).toHaveBeenCalledTimes(2);
    expect(h.state().status).toBe('loading');
  });
});
