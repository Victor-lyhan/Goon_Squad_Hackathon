// The Business workspace's one data hook (#386): owns all server traffic for the page, so the
// shipments table, the New delivery form and the delivery details only receive props.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { z } from 'zod';
import type { ShipmentResponse } from '../../../../../../shared/v2/api';
import type { CreateShipmentRequest, PatchShipmentRequest } from '../../../../../../shared/v2/schemas';
import {
  createShipment as apiCreateShipment, getBusinessDashboard, getBusinesses, getEmployees, getMap, getShipment,
  matchShipment as apiMatchShipment, patchShipment as apiPatchShipment, type RequestOptions,
} from '../../../../api/v2';
import { createBusinessPoller, type BusinessPoller, type BusinessWorkspaceApi } from './businessPoller';
import {
  businessWorkspaceReducer, initialBusinessWorkspaceState,
  type BusinessWorkspaceAction, type BusinessWorkspaceState,
} from './businessWorkspaceState';

export type CreateShipmentInput = z.input<typeof CreateShipmentRequest>;

export type BusinessWorkspaceDeps = BusinessWorkspaceApi & {
  createShipment: (req: CreateShipmentInput, opts?: RequestOptions) => Promise<ShipmentResponse>;
  patchShipment: (id: string, req: PatchShipmentRequest, opts?: RequestOptions) => Promise<ShipmentResponse>;
  matchShipment: (id: string, opts?: RequestOptions) => Promise<ShipmentResponse>;
};

export const defaultBusinessWorkspaceDeps: BusinessWorkspaceDeps = {
  getBusinessDashboard, getBusinesses, getEmployees, getMap, getShipment,
  createShipment: apiCreateShipment, patchShipment: apiPatchShipment, matchShipment: apiMatchShipment,
};

export type ShipmentActions = {
  createShipment: (req: CreateShipmentInput) => Promise<ShipmentResponse>;
  patchShipment: (id: string, req: PatchShipmentRequest) => Promise<ShipmentResponse>;
  matchShipment: (id: string) => Promise<ShipmentResponse>;
};

/**
 * The three shipment actions. Each returns the server's ShipmentResponse, rethrows errors unchanged
 * (the form classifies 409 / 503 / 400 itself) and on success refetches the dashboard at once, so the
 * table shows the change without waiting for the next tick.
 */
export function shipmentActionsWith(
  deps: Pick<BusinessWorkspaceDeps, 'createShipment' | 'patchShipment' | 'matchShipment'>,
  refetchNow: () => Promise<void>,
): ShipmentActions {
  const then = (res: ShipmentResponse) => { void refetchNow(); return res; };
  return {
    createShipment: async (req) => then(await deps.createShipment(req)),
    patchShipment: async (id, req) => then(await deps.patchShipment(id, req)),
    matchShipment: async (id) => then(await deps.matchShipment(id)),
  };
}

/** State tagged with the business it belongs to, so a switch never shows the previous business's data. */
type Owned = { owner: string; state: BusinessWorkspaceState };
type OwnedAction = { owner: string; action: BusinessWorkspaceAction };

export function ownedBusinessReducer(s: Owned, a: OwnedAction): Owned {
  const base = s.owner === a.owner ? s.state : initialBusinessWorkspaceState;
  const next = businessWorkspaceReducer(base, a.action);
  return next === s.state && s.owner === a.owner ? s : { owner: a.owner, state: next };
}

export type BusinessWorkspace = BusinessWorkspaceState & ShipmentActions & {
  refetchNow: () => Promise<void>;
  /** Hides the "the city changed" note. */
  dismissRunChanged: () => void;
};

/**
 * `openShipmentId` is the page's `?shipment=`. A delivery the dashboard does not list (a package this business
 * holds as the relay point) is read into `held` and refreshed with the poll while it is open (#581).
 */
export function useBusinessWorkspace(
  businessId: string,
  deps: BusinessWorkspaceDeps = defaultBusinessWorkspaceDeps,
  openShipmentId: string | null = null,
): BusinessWorkspace {
  const [owned, send] = useReducer(ownedBusinessReducer, { owner: businessId, state: initialBusinessWorkspaceState });
  const poller = useRef<BusinessPoller | null>(null);
  const open = useRef(openShipmentId);
  open.current = openShipmentId;

  useEffect(() => {
    const p = createBusinessPoller(businessId, deps, {
      dispatch: (action) => send({ owner: businessId, action }),
    });
    poller.current = p;
    p.watch(open.current);
    p.start();
    return () => { p.stop(); if (poller.current === p) poller.current = null; };
  }, [businessId, deps]);

  useEffect(() => { poller.current?.watch(openShipmentId); }, [openShipmentId]);

  const refetchNow = useCallback(async () => { await poller.current?.refetchNow(); }, []);
  const createShipment = useCallback(
    (req: CreateShipmentInput) => shipmentActionsWith(deps, refetchNow).createShipment(req), [deps, refetchNow],
  );
  const patchShipment = useCallback(
    (id: string, req: PatchShipmentRequest) => shipmentActionsWith(deps, refetchNow).patchShipment(id, req),
    [deps, refetchNow],
  );
  const matchShipment = useCallback(
    (id: string) => shipmentActionsWith(deps, refetchNow).matchShipment(id), [deps, refetchNow],
  );
  const dismissRunChanged = useCallback(
    () => send({ owner: businessId, action: { type: 'dismissRunChanged' } }), [businessId],
  );

  // Until the first action for a new business arrives, show the loading state, not the old business.
  const state = owned.owner === businessId ? owned.state : initialBusinessWorkspaceState;
  return { ...state, createShipment, patchShipment, matchShipment, refetchNow, dismissRunChanged };
}
