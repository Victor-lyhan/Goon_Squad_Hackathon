import type { ShipmentView } from '../../../../shared/api';
import type { Business, Employee, Hub, ShipmentProgress } from '../../../../shared/types';
import { jobIdFor } from '../../../../shared/types';
import { formatMin } from '../../ui/format';

export type StepState = 'done' | 'current' | 'upcoming';
export type ProgressStep = { key: ShipmentProgress; label: string; state: StepState };

const RELAY_STEPS: ShipmentProgress[] = ['scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered'];
const DIRECT_STEPS: ShipmentProgress[] = ['scheduled', 'picked_up', 'delivered'];
const LABEL: Record<ShipmentProgress, string> = {
  unmatched: 'Unmatched', scheduled: 'Scheduled', picked_up: 'Picked up', at_hub: 'At hub',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};

/** Stepper for a shipment. Step states come from `view.status` alone; the last step, once reached, is done. */
export function progressSteps(view: ShipmentView): ProgressStep[] {
  const keys = view.plan?.kind === 'relay' ? RELAY_STEPS : DIRECT_STEPS;
  const idx = keys.indexOf(view.status); // -1 when unmatched
  return keys.map((key, i) => {
    let state: StepState = 'upcoming';
    if (idx >= 0) {
      if (view.status === 'delivered' || i < idx) state = 'done';
      else if (i === idx) state = 'current';
    }
    return { key, label: LABEL[key], state };
  });
}

export type Lookups = { businesses: Business[]; hubs: Hub[]; employees: Employee[] };

export type LegRow = {
  key: string;
  employeeName: string;
  employeeHref: string;
  pickupPlace: string;
  pickupTime: string;
  dropoffPlace: string;
  dropoffTime: string;
};

export function placeName(nodeId: string, { businesses, hubs }: Pick<Lookups, 'businesses' | 'hubs'>): string {
  return businesses.find((b) => b.nodeId === nodeId)?.name ?? hubs.find((h) => h.nodeId === nodeId)?.name ?? 'Stop';
}

/** Deep link to a carrier's job (DECISIONS pass 4). */
export function carrierHref(employeeId: string, jobId: string): string {
  return `/employee/${encodeURIComponent(employeeId)}?job=${encodeURIComponent(jobId)}`;
}

/**
 * Deep link to the simulator that opens this package's journey and plays it once (DECISIONS pass 63, 64).
 * The one builder of every simulator link on the Business page: the match result's "Watch in simulator",
 * the delivery details' "View journey" and the missing-delivery link.
 */
export function simulatorHref(shipmentId: string): string {
  return `/simulator?package=${encodeURIComponent(shipmentId)}&play=1`;
}

/** One display row per carrier leg: who carries it and where/when. */
export function legRows(view: ShipmentView, lookups: Lookups): LegRow[] {
  if (!view.plan) return [];
  return view.plan.legs.map((leg, i) => {
    const first = leg.stops[0];
    const last = leg.stops[leg.stops.length - 1];
    return {
      key: `${leg.tripId}-${i}`,
      employeeName: lookups.employees.find((e) => e.id === leg.employeeId)?.name ?? 'Carrier',
      employeeHref: carrierHref(leg.employeeId, jobIdFor(view.plan!.id, i)),
      pickupPlace: first ? placeName(first.nodeId, lookups) : 'Stop',
      pickupTime: first ? formatMin(first.serviceStartMin) : '',
      dropoffPlace: last ? placeName(last.nodeId, lookups) : 'Stop',
      dropoffTime: last ? formatMin(last.serviceStartMin) : '',
    };
  });
}

/** Text for the list's time column: delivered time, else planned ETA, else empty. */
export function etaText(view: ShipmentView): string {
  if (view.status === 'delivered' && view.deliveredAtMin != null) return `Delivered ${formatMin(view.deliveredAtMin)}`;
  if (view.plan) return `ETA ${formatMin(view.plan.deliveryMin)}`;
  return '';
}

export const UNKNOWN_BUSINESS_TITLE = "We couldn't find that business";
export const STALE_SHIPMENT_MESSAGE = "This package isn't in the current city (it may be from before a new city was generated)";

/** True once the API's business list has loaded and does not contain this id. Never uses a hardcoded id. */
export function isUnknownBusiness(id: string, businesses: Business[], listsReady: boolean): boolean {
  return listsReady && !businesses.some((b) => b.id === id);
}

/** Link target for "go to a business that exists": the first one the API returned, else null. */
export function firstBusinessHref(businesses: Business[]): string | null {
  return businesses.length > 0 ? `/business/${encodeURIComponent(businesses[0].id)}` : null;
}

export type ShipmentLookup =
  | { kind: 'none' }
  | { kind: 'found'; view: ShipmentView }
  | { kind: 'missing' };

/** Resolves ?shipment=<id> against the dashboard: nothing asked, found, or stale (not in this city). */
export function lookupShipment(selectedId: string | null, dashboard: { outgoing: ShipmentView[]; incoming: ShipmentView[] } | null): ShipmentLookup {
  if (!selectedId || !dashboard) return { kind: 'none' };
  const view = [...dashboard.outgoing, ...dashboard.incoming].find((v) => v.shipment.id === selectedId);
  return view ? { kind: 'found', view } : { kind: 'missing' };
}
