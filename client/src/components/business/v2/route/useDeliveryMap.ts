// React wrapper around the delivery-map loader (#549): one loader per page mount, synced with the
// page's run ID and the open delivery's plan on every render. Unmount aborts the pending request.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { DeliveryPlan } from '../../../../../../shared/v2/types';
import { getMap } from '../../../../api/v2';
import {
  createDeliveryMapLoader, deliveryMapReducer, deliveryMapSlot, initialDeliveryMapState,
  type DeliveryMapLoader, type DeliveryMapSlot, type GetMap,
} from './deliveryMapLoader';

export type DeliveryMap = { slot: DeliveryMapSlot; retry: () => void };

export function useDeliveryMap(runId: string | null, plan: DeliveryPlan | null, fetchMap: GetMap = getMap): DeliveryMap {
  const [state, dispatch] = useReducer(deliveryMapReducer, initialDeliveryMapState);
  const loader = useRef<DeliveryMapLoader | null>(null);

  useEffect(() => {
    const l = createDeliveryMapLoader(fetchMap, dispatch);
    loader.current = l;
    return () => { l.stop(); if (loader.current === l) loader.current = null; };
  }, [fetchMap]);

  // `state.map` is a dependency so a plan that arrived while a request was pending is checked again.
  useEffect(() => { loader.current?.sync(runId, plan); }, [runId, plan, state.map, fetchMap]);

  const retry = useCallback(() => loader.current?.retry(), []);
  return { slot: deliveryMapSlot(state), retry };
}
