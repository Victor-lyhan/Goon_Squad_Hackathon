// Pure model for the MVP II Business page (#461): which screen a hook state shows, which delivery
// `?shipment=` names, and the table rows for the current filters. It only reads API responses; it
// computes no status, price, ETA or count of its own.
import type { BusinessDashboard, ShipmentView } from '../../../../../../shared/v2/api';
import type { NetworkBusiness, Phase } from '../../../../../../shared/v2/types';
import type { BusinessWorkspaceState } from '../live/businessWorkspaceState';
import { TRAVEL_DATA_MISSING_TEXT } from '../live/businessWorkspaceState';
import { RESULT_COPY } from '../newDeliveryModel';
import {
  NO_FILTERS, buildRows, filterRows, sortRows, statusCounts,
  type RowFilters, type ShipmentRow, type SortDir, type SortKey, type StatusCount,
} from '../shipmentsTableModel';

// ---------- Screens ----------

export type PageScreen =
  | { kind: 'loading' }
  | { kind: 'not_found'; fallbackBusinessId: string | null }
  | { kind: 'unavailable'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'workspace' }
  /**
   * `?shipment=` names one of this business's deliveries, or (`heldHere`) a package of two other businesses
   * that this business holds overnight as the relay point (#581).
   */
  | { kind: 'delivery'; view: ShipmentView; heldHere?: true }
  /** `?shipment=` is not in the dashboard's lists and the server's answer for it is not here yet. */
  | { kind: 'delivery_loading'; shipmentId: string; failed: boolean }
  /** `?shipment=` names a delivery this business has no part in, or one the server does not know. */
  | { kind: 'delivery_missing'; shipmentId: string };

export const LOADING_TEXT = 'Loading your workspace…';
export const NOT_FOUND_TITLE = 'This business is not in the current city';
export const NOT_FOUND_TEXT = 'The city was changed, so this link is out of date.';
export const NO_BUSINESSES_TEXT = 'There are no businesses in the current city yet.';
export const ERROR_TITLE = 'The workspace could not be loaded';
/** Under that title when the failed request left no sentence of its own. */
export const ERROR_FALLBACK_TEXT = 'The Relay server did not answer. Check that it is running, then try again.';
export const UNAVAILABLE_TITLE = 'Travel data unavailable';
export const DELIVERY_MISSING_TITLE = 'This delivery is not in the current city';
export const DELIVERY_MISSING_TEXT =
  'It is not one of this business’s deliveries. The city may have changed, or the link belongs to another business.';
export const MATCH_FAILED_TEXT = 'The delivery could not be matched. Try again.';
export const DELIVERY_LOADING_TITLE = 'Loading this delivery…';
export const DELIVERY_FAILED_TEXT = 'The delivery could not be loaded. Trying again…';
/** The one line above the details of a package this business neither sends nor receives. */
export const heldHereText = (businessName: string) =>
  `Held here overnight: ${businessName} is the relay point for this package.`;
/** Why New delivery is closed while the run is locked: the form's own text for the same state. */
export const NEW_DELIVERY_CLOSED_TEXT = RESULT_COPY.locked;

type ScreenInput = Pick<BusinessWorkspaceState, 'view' | 'dashboard' | 'unavailable' | 'error' | 'fallbackBusinessId'>
  & Partial<Pick<BusinessWorkspaceState, 'held'>>;

/** Outgoing first, then incoming (a business is never both sender and recipient of one shipment). */
export function findDelivery(dashboard: BusinessDashboard, shipmentId: string): ShipmentView | null {
  return dashboard.outgoing.find((v) => v.shipment.id === shipmentId)
    ?? dashboard.incoming.find((v) => v.shipment.id === shipmentId)
    ?? null;
}

export function pageScreen(s: ScreenInput, shipmentId: string | null): PageScreen {
  switch (s.view) {
    case 'loading': return { kind: 'loading' };
    case 'not_found': return { kind: 'not_found', fallbackBusinessId: s.fallbackBusinessId };
    case 'unavailable': return { kind: 'unavailable', text: s.unavailable?.message ?? TRAVEL_DATA_MISSING_TEXT };
    case 'error': return { kind: 'error', text: s.error ?? ERROR_FALLBACK_TEXT };
    case 'ready': break;
  }
  if (!s.dashboard) return { kind: 'loading' };
  if (!shipmentId) return { kind: 'workspace' };
  const view = findDelivery(s.dashboard, shipmentId);
  if (view) return { kind: 'delivery', view };
  // Not sent or received here: the hook reads it with GET /shipments/:id (`held`).
  const held = s.held && s.held.shipmentId === shipmentId ? s.held : null;
  if (!held || held.status === 'failed') return { kind: 'delivery_loading', shipmentId, failed: held !== null };
  // Only the relay point of the plan may see it; any other delivery keeps the "another business" message.
  if (held.view && isHeldHere(held.view, s.dashboard.business.id)) return { kind: 'delivery', view: held.view, heldHere: true };
  return { kind: 'delivery_missing', shipmentId };
}

/** True when the plan's relay point is this business (the server's field; nothing is derived). */
export function isHeldHere(view: ShipmentView, businessId: string): boolean {
  return view.plan?.relayBusinessId === businessId;
}

/** The reason New delivery is closed for this phase, null while requests are open. */
export function newDeliveryClosedText(phase: Phase): string | null {
  return phase === 'planning' ? null : NEW_DELIVERY_CLOSED_TEXT;
}

// ---------- Layout ----------

/**
 * The width up to which the page is one column (businessPage.css uses the same number). There the open
 * delivery is shown above the table, so the page also puts it before the table in the document, and Tab
 * follows what the eye sees (#892).
 */
export const STACKED_MAX_WIDTH_PX = 1160;
export const STACKED_QUERY = `(max-width: ${STACKED_MAX_WIDTH_PX}px)`;

// ---------- Links ----------

/** The current path with its last segment replaced: works under /nyc/business/:id and /business/:id. */
export function siblingBusinessPath(pathname: string, businessId: string): string {
  const base = pathname.replace(/\/+$/, '').replace(/\/[^/]*$/, '');
  return `${base || '/business'}/${encodeURIComponent(businessId)}`;
}

/** Simulator link for a package, `/simulator?package=<id>&play=1`: the delivery details' one helper, not a second copy. */
export { simulatorHref } from '../links';

/** Query string with `?shipment=` set (or removed for null), keeping every other parameter. */
export function withShipment(params: URLSearchParams, shipmentId: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (shipmentId) next.set('shipment', shipmentId);
  else next.delete('shipment');
  return next;
}

// ---------- Table ----------

export type TableState = { filters: RowFilters; sort: { key: SortKey; dir: SortDir } };
export const INITIAL_TABLE: TableState = { filters: NO_FILTERS, sort: { key: 'ready', dir: 'asc' } };

export type TableModel = {
  all: ShipmentRow[];
  rows: ShipmentRow[];
  counts: StatusCount[];
};

/** Rows from the dashboard, filtered and sorted by the user's local table state. */
export function tableModel(dashboard: BusinessDashboard, businesses: NetworkBusiness[], t: TableState): TableModel {
  const all = buildRows(dashboard, businesses);
  return { all, rows: sortRows(filterRows(all, t.filters), t.sort.key, t.sort.dir), counts: statusCounts(all) };
}

/** Text of a refused "Try matching again": the server's message when it sent one. */
export function matchErrorText(e: unknown): string {
  return e instanceof Error && e.message.trim() ? e.message : MATCH_FAILED_TEXT;
}
