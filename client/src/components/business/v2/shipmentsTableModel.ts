// Pure model for the MVP II Business workspace shipments table.
// It only formats, filters and sorts what the API returned: it never derives a status, a price or an ETA.
import type { BusinessDashboard, ShipmentView } from '../../../../../shared/v2/api';
import type { NetworkBusiness, ShipmentProgress } from '../../../../../shared/v2/types';
import type { BusinessWorkspaceState } from './live/businessWorkspaceState';
import { formatCents, formatMin } from '../../../ui/format';

export type Direction = 'outgoing' | 'incoming';
export type DirectionFilter = 'all' | Direction;
export type StatusFilter = 'all' | ShipmentProgress;
export type StatusTone = 'neutral' | 'info' | 'warn' | 'success' | 'danger';

export type ShipmentRow = {
  /** Shipment ID (unique per row: a business is never both sender and recipient). */
  id: string;
  direction: Direction;
  directionLabel: 'Outgoing' | 'Incoming';
  label: string;
  /** The other business: recipient for outgoing, sender for incoming. */
  counterpart: string;
  status: ShipmentProgress;
  statusLabel: string;
  statusTone: StatusTone;
  planKind: 'direct' | 'relay' | null;
  planLabel: string;
  relayPointName: string | null;
  readyMin: number;
  deadlineMin: number;
  readyText: string;
  deadlineText: string;
  /** `plan.deliveryMin` from the API; null without a plan. */
  etaMin: number | null;
  deliveredAtMin: number | null;
  /** "Delivered Day 2, 9:10 AM", "ETA Day 2, 9:10 AM" or "—". */
  deliveryText: string;
  /** Customer price for outgoing matched shipments only. */
  priceCents: number | null;
  priceText: string;
  unmatchedReason: string | null;
  createdSeq: number;
};

export const DASH = '—';
/** The Plan column of a delivery without a plan: the simulator's word for it (sim/v2/packages/statusText.ts). */
export const NO_MATCH = 'No match';

// ---------- Copy of the list (#881): "deliveries" everywhere, as on the rest of the page ----------
export const LIST_TITLE = 'Deliveries';
export const LIST_LOADING_TEXT = 'Loading deliveries…';
export const LIST_EMPTY_TITLE = 'No deliveries yet';
export const LIST_EMPTY_TEXT = 'Choose New delivery and describe your package in a sentence. Relay matches it to an employee’s commute.';
export const LIST_FILTERED_TITLE = 'No deliveries match the filters';
export const LIST_ERROR_TITLE = 'Deliveries could not be loaded';
export const LIST_ERROR_TEXT = 'Check that the Relay server is running, then try again.';
/** Rows are on screen but the last update failed: they stay, with this line and the retry above them. */
export const LIST_STALE_TEXT = 'This list could not be updated, so it may be out of date.';
export const LIST_RETRY_LABEL = 'Try again';
export const LIST_RETRYING_LABEL = 'Trying again…';

/** Display order of statuses (also the sort order for the status column). */
export const STATUS_ORDER: ShipmentProgress[] = [
  'unmatched', 'scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered',
];

const STATUS_META: Record<ShipmentProgress, { label: string; tone: StatusTone }> = {
  unmatched: { label: 'Unmatched', tone: 'danger' },
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  picked_up: { label: 'Picked up', tone: 'info' },
  at_hub: { label: 'At relay point', tone: 'warn' },
  out_for_delivery: { label: 'Out for delivery', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
};

/** UI label for a shipment status. Says "At relay point", never "hub". */
export function shipmentStatusLabel(status: ShipmentProgress): string {
  const meta = STATUS_META[status];
  if (meta) return meta.label;
  // Unknown future value: readable text, and never the internal word "hub".
  const text = String(status).replace(/hub/gi, 'relay point').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusTone(status: ShipmentProgress): StatusTone {
  return STATUS_META[status]?.tone ?? 'neutral';
}

function timeText(min: number | null | undefined): string {
  return typeof min === 'number' && Number.isFinite(min) ? formatMin(min) : DASH;
}

function toRow(view: ShipmentView, direction: Direction, names: Map<string, string>): ShipmentRow {
  const { shipment, plan, status } = view;
  const counterpartId = direction === 'outgoing' ? shipment.destinationBusinessId : shipment.originBusinessId;
  const relayPointName = plan?.kind === 'relay'
    ? (plan.relayBusinessId ? names.get(plan.relayBusinessId) : undefined) ?? 'Unknown place'
    : null;
  const etaMin = plan && Number.isFinite(plan.deliveryMin) ? plan.deliveryMin : null;
  const deliveredAtMin = typeof view.deliveredAtMin === 'number' && Number.isFinite(view.deliveredAtMin)
    ? view.deliveredAtMin : null;
  const deliveryText = deliveredAtMin !== null
    ? `Delivered ${formatMin(deliveredAtMin)}`
    : etaMin !== null ? `ETA ${formatMin(etaMin)}` : DASH;
  const priceCents = direction === 'outgoing' && plan && Number.isFinite(plan.customerPriceCents)
    ? plan.customerPriceCents : null;
  return {
    id: shipment.id,
    direction,
    directionLabel: direction === 'outgoing' ? 'Outgoing' : 'Incoming',
    label: shipment.label || 'Untitled package',
    counterpart: names.get(counterpartId) ?? 'Unknown business',
    status,
    statusLabel: shipmentStatusLabel(status),
    statusTone: statusTone(status),
    planKind: plan ? plan.kind : null,
    planLabel: plan ? (plan.kind === 'relay' ? 'Relay' : 'Direct') : NO_MATCH,
    relayPointName,
    readyMin: shipment.readyMin,
    deadlineMin: shipment.deadlineMin,
    readyText: timeText(shipment.readyMin),
    deadlineText: timeText(shipment.deadlineMin),
    etaMin,
    deliveredAtMin,
    deliveryText,
    priceCents,
    priceText: priceCents !== null ? formatCents(priceCents) : DASH,
    unmatchedReason: plan ? null : view.unmatchedReason ?? null,
    createdSeq: shipment.createdSeq,
  };
}

const newestFirst = (a: ShipmentView, b: ShipmentView) =>
  b.shipment.createdSeq - a.shipment.createdSeq || (a.shipment.id < b.shipment.id ? -1 : a.shipment.id > b.shipment.id ? 1 : 0);

/**
 * One row per outgoing and incoming shipment: outgoing first, then incoming, each newest first.
 * `businesses` resolves names (the dashboard's own business is added, so it always resolves).
 */
export function buildRows(dashboard: BusinessDashboard, businesses: NetworkBusiness[]): ShipmentRow[] {
  const names = new Map<string, string>();
  for (const b of businesses) names.set(b.id, b.name);
  names.set(dashboard.business.id, dashboard.business.name);
  return [
    ...[...dashboard.outgoing].sort(newestFirst).map((v) => toRow(v, 'outgoing', names)),
    ...[...dashboard.incoming].sort(newestFirst).map((v) => toRow(v, 'incoming', names)),
  ];
}

export type RowFilters = { query: string; direction: DirectionFilter; status: StatusFilter };
export const NO_FILTERS: RowFilters = { query: '', direction: 'all', status: 'all' };

export function hasActiveFilters(f: RowFilters): boolean {
  return f.query.trim() !== '' || f.direction !== 'all' || f.status !== 'all';
}

/**
 * Query matches label, shipment ID, counterpart and relay point (case-insensitive). The list no longer shows
 * the ID (#881), but the New delivery result and the notifications name a delivery by it, so it still finds one.
 */
export function filterRows(rows: ShipmentRow[], filters: RowFilters): ShipmentRow[] {
  const q = filters.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.direction !== 'all' && r.direction !== filters.direction) return false;
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (!q) return true;
    return [r.label, r.id, r.counterpart, r.relayPointName ?? '']
      .some((text) => text.toLowerCase().includes(q));
  });
}

export type SortKey = 'label' | 'id' | 'counterpart' | 'status' | 'plan' | 'ready' | 'deadline' | 'delivery' | 'price';
export type SortDir = 'asc' | 'desc';

function statusRank(s: ShipmentProgress): number {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? STATUS_ORDER.length : i;
}

function sortValue(r: ShipmentRow, key: SortKey): string | number | null {
  switch (key) {
    case 'label': return r.label.toLowerCase();
    case 'id': return r.id;
    case 'counterpart': return r.counterpart.toLowerCase();
    case 'status': return statusRank(r.status);
    case 'plan': return r.planKind;
    case 'ready': return r.readyMin;
    case 'deadline': return r.deadlineMin;
    case 'delivery': return r.deliveredAtMin ?? r.etaMin;
    case 'price': return r.priceCents;
  }
}

/** Sorted copy. Missing values go last in both directions; ties keep the input order (stable). */
export function sortRows(rows: ShipmentRow[], key: SortKey, dir: SortDir): ShipmentRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: sortValue(row, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
      return c !== 0 ? c * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

/** Next sort state when a header is activated: same key flips direction, a new key starts ascending. */
export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

export type StatusCount = { status: ShipmentProgress; label: string; count: number };

/** Count per status, in STATUS_ORDER (zeros included); the counts add up to rows.length. */
export function statusCounts(rows: ShipmentRow[]): StatusCount[] {
  const counts = new Map<ShipmentProgress, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const known = STATUS_ORDER.map((status) => ({ status, label: shipmentStatusLabel(status), count: counts.get(status) ?? 0 }));
  const extra = [...counts.keys()].filter((s) => !STATUS_ORDER.includes(s))
    .map((status) => ({ status, label: shipmentStatusLabel(status), count: counts.get(status) ?? 0 }));
  return [...known, ...extra];
}

/** "3 deliveries" / "1 delivery". */
export function shipmentCountText(n: number): string {
  return `${n} ${n === 1 ? 'delivery' : 'deliveries'}`;
}

// ---------- What the list shows instead of, or above, its rows (#881) ----------

export type ListLoadKind = 'ready' | 'loading' | 'error';

/**
 * How long the list waits for the business names before it shows its rows without them. The page polls
 * every second and asks for the names again on each poll, so this is about three failed tries.
 */
export const NAMES_WAIT_MS = 3000;

/** True while the deliveries are here but the business names are not: rows would read "Unknown business". */
export function namesMissing(s: Pick<BusinessWorkspaceState, 'dashboard' | 'businesses'>): boolean {
  if (!s.dashboard) return false;
  return s.dashboard.outgoing.length + s.dashboard.incoming.length > 0 && s.businesses.length === 0;
}

/**
 * The list's own state, read from the workspace state alone (nothing is asked of the server here):
 * `error` when the deliveries could not be read or the last update failed, `loading` before the first answer
 * and while the deliveries are here but the business names are not, else `ready`.
 * `namesLate`: the names have been missing for NAMES_WAIT_MS. The list then stops waiting: it is `error`,
 * which keeps the rows on screen under the "could not be updated" line and its retry.
 */
export function listLoadKind(
  s: Pick<BusinessWorkspaceState, 'view' | 'dashboard' | 'businesses' | 'reconnecting'>,
  namesLate = false,
): ListLoadKind {
  if (s.view === 'error' || s.view === 'unavailable' || s.reconnecting) return 'error';
  // A business that is not in this city has no list at all; the page shows its own screen for it.
  if (s.view === 'not_found') return 'ready';
  if (s.view === 'loading' || !s.dashboard) return 'loading';
  if (!namesMissing(s)) return 'ready';
  return namesLate ? 'error' : 'loading';
}
