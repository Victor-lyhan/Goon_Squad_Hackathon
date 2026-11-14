// Rows for the simulator's left-panel package list (#418). Pure: no React, no DOM.
// It only reads the polled SimulatorResponse and the MapResponse. Status, kind and the unmatched
// reason come from the server; nothing about a delivery is computed here. The words are those of
// statusText.ts, shared with the inspectors (#635).
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { ShipmentProgress } from '../../../../../../shared/v2/types';
import type { PackageListItem } from '../PackageList';
import { knownStatus, NO_MATCH, packageName, shipmentStatusText } from './statusText';

export const UNKNOWN_PLACE = 'Unknown place';

export type PackageRow = {
  id: string;
  /** The package's own name, "Untitled package" when it has none. */
  label: string;
  senderName: string;
  recipientName: string;
  /** "Sender → Recipient" by business name. */
  routeLabel: string;
  kind: 'direct' | 'relay' | 'none';
  /** "Direct", "Relay via <business name>" or "No match". */
  kindLabel: string;
  /** Relay business name for a relay plan, else null. */
  relayName: string | null;
  /** The snapshot's status; null when the snapshot has none for this shipment (never guessed from the plan). */
  status: ShipmentProgress | null;
  /** The status word of statusText.ts, "Status unavailable" for a null status. */
  statusLabel: string;
  /** The server's unmatched reason for a shipment without a plan, else null. */
  reason: string | null;
};

export type StatusFilter = 'all' | ShipmentProgress;
export type StatusFilterOption = { value: StatusFilter; label: string; count: number };
export type PackageFilters = { status: StatusFilter; query: string };
export const NO_FILTERS: PackageFilters = { status: 'all', query: '' };

/** Fixed display order of the status filters. */
export const STATUS_ORDER: ShipmentProgress[] = [
  'unmatched', 'scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered',
];

/** UI label for a shipment status (statusText.ts); "Status unavailable" when the snapshot has none. */
export function packageStatusLabel(status: ShipmentProgress | null | undefined): string {
  return shipmentStatusText(status);
}

export function buildPackageRows(sim: SimulatorResponse, map: MapResponse): PackageRow[] {
  const names = new Map(map.businesses.map((b) => [b.id, b.name]));
  const nameOf = (id: string | undefined) => (id && names.get(id)) || UNKNOWN_PLACE;
  const plans = new Map(sim.plans.map((p) => [p.shipmentId, p]));
  const reasons = new Map(sim.unmatched.map((u) => [u.shipmentId, u.reason]));

  const shipments = [...sim.shipments].sort(
    (a, b) => a.createdSeq - b.createdSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return shipments.map((s) => {
    const plan = plans.get(s.id) ?? null;
    const senderName = nameOf(s.originBusinessId);
    const recipientName = nameOf(s.destinationBusinessId);
    const relayName = plan?.kind === 'relay' ? nameOf(plan.relayBusinessId) : null;
    const kind: PackageRow['kind'] = plan ? plan.kind : 'none';
    const kindLabel = kind === 'direct' ? 'Direct' : kind === 'relay' ? `Relay via ${relayName}` : NO_MATCH;
    const status = knownStatus(sim.snapshot.shipmentStatus[s.id]);
    return {
      id: s.id,
      label: packageName(s.label),
      senderName,
      recipientName,
      routeLabel: `${senderName} → ${recipientName}`,
      kind,
      kindLabel,
      relayName,
      status,
      statusLabel: packageStatusLabel(status),
      reason: plan ? null : reasons.get(s.id) ?? null,
    };
  });
}

/**
 * "All" plus one entry per status that occurs, with counts, in STATUS_ORDER. A row whose status the
 * snapshot does not have counts under "All" only.
 * `keep` is always listed (count 0 if absent), so a chosen filter never disappears after a poll.
 */
export function statusFilters(rows: PackageRow[], keep?: StatusFilter): StatusFilterOption[] {
  const counts = new Map<ShipmentProgress, number>();
  for (const r of rows) if (r.status) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const options: StatusFilterOption[] = [{ value: 'all', label: 'All', count: rows.length }];
  for (const status of STATUS_ORDER) {
    const count = counts.get(status) ?? 0;
    if (count > 0 || status === keep) options.push({ value: status, label: packageStatusLabel(status), count });
  }
  return options;
}

export function filterPackageRows(rows: PackageRow[], filters: PackageFilters): PackageRow[] {
  const q = filters.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (!q) return true;
    return [r.label, r.senderName, r.recipientName, r.relayName ?? '']
      .some((text) => text.toLowerCase().includes(q));
  });
}

/** The frame's list items. `statusLabel` carries the kind and the status; an unmatched row adds the reason. */
export function toListItems(rows: PackageRow[]): PackageListItem[] {
  return rows.map((r) => {
    const statusLabel = r.kind === 'none' && r.status === 'unmatched'
      ? r.kindLabel
      : `${r.kindLabel} · ${r.statusLabel}`;
    const routeLabel = r.reason ? `${r.routeLabel} · ${r.reason}` : r.routeLabel;
    return { id: r.id, label: r.label, statusLabel, routeLabel };
  });
}
