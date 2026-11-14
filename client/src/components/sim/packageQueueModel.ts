import type { Business, DeliveryPlan, Shipment, ShipmentProgress } from '../../../../shared/types';

export type QueueFilter = 'all' | ShipmentProgress;
export type QueueRow = {
  id: string;
  label: string;
  sender: string;
  recipient: string;
  status: ShipmentProgress;
  tag?: 'Direct' | 'Relay';
};

export const STATUS_ORDER: ShipmentProgress[] = [
  'unmatched', 'scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered',
];

export const STATUS_LABEL: Record<ShipmentProgress, string> = {
  unmatched: 'Unmatched',
  scheduled: 'Scheduled',
  picked_up: 'Picked up',
  at_hub: 'At hub',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

export function toQueueRows(
  shipments: Shipment[],
  plans: DeliveryPlan[],
  shipmentStatus: Record<string, ShipmentProgress>,
  businesses: Business[],
): QueueRow[] {
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const planByShipment = new Map(plans.map((p) => [p.shipmentId, p]));
  return [...shipments]
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((s) => {
      const plan = planByShipment.get(s.id);
      return {
        id: s.id,
        label: s.label,
        sender: names.get(s.originBusinessId) ?? 'Unknown business',
        recipient: names.get(s.destinationBusinessId) ?? 'Unknown business',
        status: shipmentStatus[s.id] ?? 'unmatched',
        tag: plan ? (plan.kind === 'relay' ? 'Relay' : 'Direct') : undefined,
      };
    });
}

export function countByStatus(rows: QueueRow[]): Record<QueueFilter, number> {
  const counts = { all: rows.length } as Record<QueueFilter, number>;
  for (const s of STATUS_ORDER) counts[s] = 0;
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

export function filterRows(rows: QueueRow[], filter: QueueFilter, query = ''): QueueRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (q === '' || [r.id, r.label, r.sender, r.recipient].some((t) => t.toLowerCase().includes(q))),
  );
}

export type QueueKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';
export const QUEUE_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'Home', 'End'];

/**
 * Next selected id for a navigation key over the visible ids, or null when the
 * key is not a queue key or the list is empty. Up/Down clamp at the ends; with
 * no (or a filtered-out) current id, Down/Home pick the first and Up/End the last.
 */
export function moveSelection(ids: string[], currentId: string | undefined, key: string): string | null {
  if (!QUEUE_KEYS.includes(key) || ids.length === 0) return null;
  const i = currentId === undefined ? -1 : ids.indexOf(currentId);
  switch (key) {
    case 'Home': return ids[0];
    case 'End': return ids[ids.length - 1];
    case 'ArrowDown': return ids[i < 0 ? 0 : Math.min(ids.length - 1, i + 1)];
    default: return ids[i < 0 ? ids.length - 1 : Math.max(0, i - 1)];
  }
}
