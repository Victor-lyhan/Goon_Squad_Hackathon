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

export function filterRows(rows: QueueRow[], filter: QueueFilter): QueueRow[] {
  return filter === 'all' ? rows : rows.filter((r) => r.status === filter);
}
