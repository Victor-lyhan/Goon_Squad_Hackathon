// The simulator's words for a package (#635, DECISIONS pass 62). One place, so the left list and the
// two inspectors never name the same thing differently. The status words are those of the Business
// workspace (business/v2/deliveryDetailsModel.ts); copy says "relay point" for the relay status.
// Pure text lookups: nothing here derives a status from a plan.
import type { ShipmentProgress } from '../../../../../../shared/v2/types';

export const SHIPMENT_STATUS_TEXT: Record<ShipmentProgress, string> = {
  unmatched: 'Unmatched',
  scheduled: 'Scheduled',
  picked_up: 'Picked up',
  at_hub: 'At relay point',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/** A shipment the snapshot has no (known) status for. */
export const STATUS_UNAVAILABLE = 'Status unavailable';
/** The plan kind of a package without a plan. */
export const NO_MATCH = 'No match';
/** A package whose label is empty. */
export const UNTITLED_PACKAGE = 'Untitled package';

/** The snapshot's status when it is one of the six known values, else null. Never a guess from the plan. */
export function knownStatus(status: unknown): ShipmentProgress | null {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(SHIPMENT_STATUS_TEXT, status)
    ? (status as ShipmentProgress)
    : null;
}

/** The word for a shipment status; "Status unavailable" when the snapshot has none. */
export function shipmentStatusText(status: unknown): string {
  const known = knownStatus(status);
  return known ? SHIPMENT_STATUS_TEXT[known] : STATUS_UNAVAILABLE;
}

/** The package's own name, or "Untitled package" when it has none. */
export function packageName(label: unknown): string {
  return (typeof label === 'string' && label.trim()) || UNTITLED_PACKAGE;
}
