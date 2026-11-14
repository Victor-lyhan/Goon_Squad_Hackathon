// Pure model for the MVP II Business page (#461): which screen a hook state shows, which delivery
// `?shipment=` names, and the table rows for the current filters. It only reads API responses; it
// computes no status, price, ETA or count of its own.
import type { BusinessDashboard, ShipmentView } from '../../../../../../shared/v2/api';
import type { NetworkBusiness } from '../../../../../../shared/v2/types';
import type { BusinessWorkspaceState } from '../live/businessWorkspaceState';
import { TRAVEL_DATA_MISSING_TEXT } from '../live/businessWorkspaceState';
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
  /** `?shipment=` names one of this business's deliveries. */
  | { kind: 'delivery'; view: ShipmentView }
  /** `?shipment=` names a delivery that is not in this business's lists. */
  | { kind: 'delivery_missing'; shipmentId: string };

export const LOADING_TEXT = 'Loading your workspace…';
export const NOT_FOUND_TITLE = 'This business is not in the current city';
export const NOT_FOUND_TEXT = 'The city was changed, so this link is out of date.';
export const NO_BUSINESSES_TEXT = 'There are no businesses in the current city yet.';
export const ERROR_TITLE = 'The workspace could not be loaded';
export const UNAVAILABLE_TITLE = 'Travel data unavailable';
export const DELIVERY_MISSING_TITLE = 'This delivery is not in the current city';
export const DELIVERY_MISSING_TEXT =
  'It is not one of this business’s deliveries. The city may have changed, or the link belongs to another business.';
export const MATCH_FAILED_TEXT = 'The delivery could not be matched. Try again.';

type ScreenInput = Pick<BusinessWorkspaceState, 'view' | 'dashboard' | 'unavailable' | 'error' | 'fallbackBusinessId'>;

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
    case 'error': return { kind: 'error', text: s.error ?? 'Request failed' };
    case 'ready': break;
  }
  if (!s.dashboard) return { kind: 'loading' };
  if (!shipmentId) return { kind: 'workspace' };
  const view = findDelivery(s.dashboard, shipmentId);
  return view ? { kind: 'delivery', view } : { kind: 'delivery_missing', shipmentId };
}

// ---------- Links ----------

/** The current path with its last segment replaced: works under /nyc/business/:id and /business/:id. */
export function siblingBusinessPath(pathname: string, businessId: string): string {
  const base = pathname.replace(/\/+$/, '').replace(/\/[^/]*$/, '');
  return `${base || '/business'}/${encodeURIComponent(businessId)}`;
}

/** Final-path simulator link for a package (DECISIONS pass 46). */
export const simulatorHref = (shipmentId: string) => `/simulator?package=${encodeURIComponent(shipmentId)}`;

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
