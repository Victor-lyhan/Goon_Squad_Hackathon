// Deliveries a business removed from its own list (#949). Remove only hides a row here: nothing is
// cancelled or matched again, the server is never told and the simulator shows the same packages.
// What is kept is a view preference, the IDs of the hidden rows, per business, in the browser's
// localStorage. No delivery data is stored: the rows themselves always come from the dashboard.
import { useCallback, useEffect, useMemo, useState } from 'react';

export const HIDDEN_KEY_PREFIX = 'relay.business.hiddenDeliveries.';
export const hiddenKey = (businessId: string) => `${HIDDEN_KEY_PREFIX}${businessId}`;

/** More than a business ever lists; the oldest IDs go first, so the stored value cannot grow for ever. */
export const MAX_HIDDEN_IDS = 500;

/**
 * `runId`: the run the IDs were hidden in, null when it was not known yet. Shipment IDs are numbered per
 * run (`shp-1`, `shp-2`, …), so an ID hidden in one run is another package in the next.
 */
export type HiddenDeliveries = { runId: string | null; ids: readonly string[] };

export const NO_HIDDEN: HiddenDeliveries = { runId: null, ids: [] };

function storage(): Storage | null {
  try {
    // Only in a browser: a static render in Node has no window (and Node warns about its own localStorage).
    if (typeof window === 'undefined') return null;
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** What is stored for this business; nothing hidden when there is no storage or the value is not ours. */
export function readHidden(businessId: string): HiddenDeliveries {
  try {
    const raw = storage()?.getItem(hiddenKey(businessId));
    if (!raw) return NO_HIDDEN;
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return NO_HIDDEN;
    const o = v as { runId?: unknown; ids?: unknown };
    if (!Array.isArray(o.ids)) return NO_HIDDEN;
    const ids = [...new Set(o.ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
    if (ids.length === 0) return NO_HIDDEN;
    return { runId: typeof o.runId === 'string' ? o.runId : null, ids: ids.slice(-MAX_HIDDEN_IDS) };
  } catch {
    return NO_HIDDEN;
  }
}

/** Best effort: where the browser refuses (private mode, full storage) the rows stay hidden until a reload. */
export function writeHidden(businessId: string, hidden: HiddenDeliveries): void {
  try {
    const store = storage();
    if (!store) return;
    if (hidden.ids.length === 0) store.removeItem(hiddenKey(businessId));
    else store.setItem(hiddenKey(businessId), JSON.stringify({ runId: hidden.runId, ids: hidden.ids }));
  } catch {
    /* storage unavailable: the choice just does not survive a reload */
  }
}

/**
 * The hidden IDs that count in the run on screen. IDs from another run are dropped: after "Start new
 * planning cycle" the next delivery is `shp-1` again, and it must not start out hidden. Returns the same
 * object when nothing changes, and keeps everything while the run is not known yet.
 */
export function hiddenForRun(hidden: HiddenDeliveries, runId: string | null): HiddenDeliveries {
  if (runId === null || hidden.runId === runId) return hidden;
  if (hidden.ids.length === 0) return hidden;
  return hidden.runId === null ? { runId, ids: hidden.ids } : NO_HIDDEN;
}

export function withHidden(hidden: HiddenDeliveries, shipmentId: string, runId: string | null): HiddenDeliveries {
  if (hidden.ids.includes(shipmentId)) return hidden;
  return { runId: hidden.runId ?? runId, ids: [...hidden.ids, shipmentId].slice(-MAX_HIDDEN_IDS) };
}

export type HiddenDeliveriesApi = {
  /** IDs of the deliveries this business removed from its list. */
  ids: ReadonlySet<string>;
  hide: (shipmentId: string) => void;
  showAll: () => void;
};

type Held = { businessId: string | null; hidden: HiddenDeliveries };

const load = (businessId: string | null, runId: string | null): Held =>
  ({ businessId, hidden: businessId ? hiddenForRun(readHidden(businessId), runId) : NO_HIDDEN });

/**
 * The hidden rows of one business. Memory holds the truth for the page that is open, so Remove works where
 * storage does not; storage carries it over a reload. `businessId` is null until the dashboard is here.
 */
export function useHiddenDeliveries(businessId: string | null, runId: string | null): HiddenDeliveriesApi {
  const [held, setHeld] = useState<Held>(() => load(businessId, runId));
  let current = held;
  if (held.businessId !== businessId) {
    current = load(businessId, runId);
  } else {
    const hidden = hiddenForRun(held.hidden, runId);
    if (hidden !== held.hidden) current = { businessId, hidden };
  }
  // Another business, or another run: the state follows during this render, not one render late.
  if (current !== held) setHeld(current);

  const { hidden } = current;
  useEffect(() => {
    if (businessId) writeHidden(businessId, hidden);
  }, [businessId, hidden]);

  const hide = useCallback((shipmentId: string) => {
    setHeld((h) => {
      if (h.businessId !== businessId) return h;
      const next = withHidden(h.hidden, shipmentId, runId);
      return next === h.hidden ? h : { businessId, hidden: next };
    });
  }, [businessId, runId]);
  const showAll = useCallback(() => {
    setHeld((h) => (h.businessId !== businessId || h.hidden.ids.length === 0 ? h : { businessId, hidden: NO_HIDDEN }));
  }, [businessId]);

  const ids = useMemo(() => new Set(hidden.ids), [hidden]);
  return { ids, hide, showAll };
}
