import type { Business, Notification, Shipment } from '../../../../shared/types';
import { formatMin } from '../../ui/format';

export type NotificationBaseline = { runId: string | null; ids: ReadonlySet<string> };

/**
 * IDs that are new since the previous poll. First load (prev null) flags nothing;
 * a runId change resets the baseline (a new city is not "new notifications").
 */
export function stepNotifications(
  prev: NotificationBaseline | null, runId: string | null | undefined, current: Notification[],
): { baseline: NotificationBaseline; newIds: string[] } {
  const rid = runId ?? null;
  const ids = new Set(current.map((n) => n.id));
  const reset = prev === null || (prev.runId !== null && rid !== null && prev.runId !== rid);
  const newIds = reset ? [] : [...current].sort((a, b) => a.createdSeq - b.createdSeq).filter((n) => !prev.ids.has(n.id)).map((n) => n.id);
  return { baseline: { runId: rid ?? prev?.runId ?? null, ids }, newIds };
}

export type NotificationRow = {
  id: string; shipmentId: string; message: string;
  href: string | null; timeLabel: string | null; route: string | null;
};

/** Newest first; adds time ("ready" time of the package), sender -> recipient names and tracking link. */
export function notificationRows(
  notifications: Notification[], shipments: Shipment[] = [], businesses: Business[] = [], businessId?: string,
): NotificationRow[] {
  const ship = new Map(shipments.map((s) => [s.id, s]));
  const name = new Map(businesses.map((b) => [b.id, b.name]));
  return [...notifications]
    .sort((a, b) => b.createdSeq - a.createdSeq || (a.id < b.id ? 1 : -1))
    .map((n) => {
      const s = ship.get(n.shipmentId);
      const from = s ? name.get(s.originBusinessId) : undefined;
      const to = s ? name.get(s.destinationBusinessId) : undefined;
      const owner = businessId ?? n.audienceId;
      return {
        id: n.id, shipmentId: n.shipmentId, message: n.message,
        href: owner ? `/business/${owner}?shipment=${n.shipmentId}` : null,
        timeLabel: s && Number.isFinite(s.readyMin) ? `Ready ${formatMin(s.readyMin)}` : null,
        route: from && to ? `${from} → ${to}` : null,
      };
    });
}
