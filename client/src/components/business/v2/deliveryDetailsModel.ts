// Pure model for the MVP II Business delivery details / match result panel.
// It only formats what the API returned: it never derives a status, a price or a time.
// Copy says "relay point"; the enum values hub_drop / hub_pickup / at_hub keep their names (DECISIONS pass 44).
import type { ShipmentView } from '../../../../../shared/v2/api';
import type {
  Employee, Leg, NetworkBusiness, PackageCategory, Phase, ShipmentProgress, StopKind,
} from '../../../../../shared/v2/types';
import { jobIdFor } from '../../../../../shared/v2/types';
import { carrierHref, simulatorHref } from '../trackingModel';
import { formatCents, formatDuration, formatKg, formatMin } from '../../../ui/format';

export const UNKNOWN_PLACE = 'Unknown place';
export const DASH = '—';

export type StepState = 'done' | 'current' | 'upcoming';
export type DetailStep = { key: ShipmentProgress; label: string; state: StepState };

export type PartyText = { name: string; neighborhood: string | null };

export type DetailsHeader = {
  label: string;
  shipmentId: string;
  direction: 'outgoing' | 'incoming';
  directionLabel: 'Outgoing' | 'Incoming';
  sender: PartyText;
  recipient: PartyText;
};

export type MatchResult =
  | {
    kind: 'matched';
    title: 'Delivery arranged';
    planKind: 'direct' | 'relay';
    /** "Direct" or "Relay via <name> (relay point)". */
    planText: string;
    relayPointName: string | null;
    timeLabel: 'ETA' | 'Delivered';
    timeText: string;
    /** Customer price; null unless the viewer is the sender. */
    priceText: string | null;
  }
  | { kind: 'unmatched'; title: 'No matching commute yet'; reason: string | null };

export type StopRow = { key: string; timeText: string; actionLabel: string; placeText: string; isRelay: boolean };

export type LegRow = {
  key: string;
  carrierName: string;
  carrierHref: string;
  /** "Evening commute, Day 1" / "Morning commute, Day 2". */
  tripText: string;
  stops: StopRow[];
  /** "+12 min" */
  extraText: string;
};

export type PackageFacts = {
  category: string;
  weight: string;
  description: string | null;
  pickupInstructions: string | null;
  dropoffInstructions: string | null;
  ready: string;
  deadline: string;
};

export type DeliveryDetailsModel = {
  header: DetailsHeader;
  result: MatchResult;
  steps: DetailStep[];
  legs: LegRow[];
  facts: PackageFacts;
  journeyHref: string;
  journeyLabel: 'View journey';
};

export type DetailsLookups = {
  businesses: Pick<NetworkBusiness, 'id' | 'name' | 'neighborhood'>[];
  employees: Pick<Employee, 'id' | 'name'>[];
  viewerBusinessId: string;
};

const STEP_LABEL: Record<ShipmentProgress, string> = {
  unmatched: 'Unmatched', scheduled: 'Scheduled', picked_up: 'Picked up', at_hub: 'At relay point',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};
const RELAY_STEPS: ShipmentProgress[] = ['scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered'];
const DIRECT_STEPS: ShipmentProgress[] = ['scheduled', 'picked_up', 'out_for_delivery', 'delivered'];

const CATEGORY_LABEL: Record<PackageCategory, string> = { envelope: 'Envelope', small_box: 'Small box' };

const STOP_ACTION: Record<StopKind, string> = {
  pickup: 'Pick up', hub_drop: 'Drop off', hub_pickup: 'Collect', delivery: 'Deliver',
};

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const timeText = (min: unknown) => (isNum(min) ? formatMin(min) : DASH);
const nonEmpty = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

function businessName(id: string | undefined, businesses: DetailsLookups['businesses']): string {
  return (id ? businesses.find((b) => b.id === id)?.name : undefined) ?? UNKNOWN_PLACE;
}

function party(id: string, businesses: DetailsLookups['businesses']): PartyText {
  const b = businesses.find((x) => x.id === id);
  return b ? { name: b.name, neighborhood: nonEmpty(b.neighborhood) } : { name: UNKNOWN_PLACE, neighborhood: null };
}

/** Steps for the plan kind; states come from `view.status` alone. Unmatched requests have no steps. */
export function detailSteps(view: ShipmentView): DetailStep[] {
  if (!view.plan) return [];
  const keys = view.plan.kind === 'relay' ? RELAY_STEPS : DIRECT_STEPS;
  const idx = keys.indexOf(view.status);
  return keys.map((key, i) => {
    let state: StepState = 'upcoming';
    if (idx >= 0) {
      if (view.status === 'delivered' || i < idx) state = 'done';
      else if (i === idx) state = 'current';
    }
    return { key, label: STEP_LABEL[key], state };
  });
}

/** "Evening commute, Day 1" from the trip ID convention (`<employeeId>-eve|-morn`) and the leg's first stop. */
export function tripText(leg: Pick<Leg, 'tripId' | 'stops'>): string {
  const dir = leg.tripId.endsWith('-eve') ? 'evening' : leg.tripId.endsWith('-morn') ? 'morning' : null;
  const first = leg.stops[0];
  const day = first && isNum(first.serviceStartMin)
    ? Math.floor(Math.max(0, first.serviceStartMin) / 1440) + 1
    : dir === 'evening' ? 1 : dir === 'morning' ? 2 : null;
  const name = dir === 'evening' ? 'Evening commute' : dir === 'morning' ? 'Morning commute' : 'Commute';
  return day ? `${name}, Day ${day}` : name;
}

function legRows(view: ShipmentView, lookups: DetailsLookups): LegRow[] {
  const plan = view.plan;
  if (!plan) return [];
  return plan.legs.map((leg, i) => {
    const jobId = jobIdFor(plan.id, i);
    return {
      key: `${leg.tripId}-${i}`,
      carrierName: lookups.employees.find((e) => e.id === leg.employeeId)?.name ?? 'Carrier',
      carrierHref: carrierHref(leg.employeeId, jobId),
      tripText: tripText(leg),
      stops: leg.stops.map((stop, j) => {
        const isRelay = stop.kind === 'hub_drop' || stop.kind === 'hub_pickup';
        const name = businessName(stop.placeId, lookups.businesses);
        return {
          key: `${i}-${j}`,
          timeText: timeText(stop.serviceStartMin),
          actionLabel: STOP_ACTION[stop.kind] ?? 'Stop',
          placeText: isRelay ? `Relay point: ${name}` : name,
          isRelay,
        };
      }),
      extraText: isNum(leg.extraMin) ? `+${formatDuration(leg.extraMin)}` : DASH,
    };
  });
}

function relayPointName(view: ShipmentView, businesses: DetailsLookups['businesses']): string {
  const plan = view.plan!;
  const id = plan.relayBusinessId
    ?? plan.legs.flatMap((l) => l.stops).find((s) => s.kind === 'hub_drop' || s.kind === 'hub_pickup')?.placeId;
  return businessName(id, businesses);
}

function matchResult(view: ShipmentView, outgoing: boolean, businesses: DetailsLookups['businesses']): MatchResult {
  const plan = view.plan;
  if (!plan) return { kind: 'unmatched', title: 'No matching commute yet', reason: nonEmpty(view.unmatchedReason) };
  const relay = plan.kind === 'relay' ? relayPointName(view, businesses) : null;
  const delivered = view.status === 'delivered' && isNum(view.deliveredAtMin);
  return {
    kind: 'matched',
    title: 'Delivery arranged',
    planKind: plan.kind,
    planText: relay ? `Relay via ${relay} (relay point)` : 'Direct',
    relayPointName: relay,
    timeLabel: delivered ? 'Delivered' : 'ETA',
    timeText: delivered ? formatMin(view.deliveredAtMin!) : timeText(plan.deliveryMin),
    priceText: outgoing && isNum(plan.customerPriceCents) ? formatCents(plan.customerPriceCents) : null,
  };
}

/** Everything the details panel shows, formatted from one ShipmentView. */
export function deliveryDetails(view: ShipmentView, lookups: DetailsLookups): DeliveryDetailsModel {
  const s = view.shipment;
  const outgoing = s.originBusinessId === lookups.viewerBusinessId;
  return {
    header: {
      label: nonEmpty(s.label) ?? 'Package',
      shipmentId: s.id,
      direction: outgoing ? 'outgoing' : 'incoming',
      directionLabel: outgoing ? 'Outgoing' : 'Incoming',
      sender: party(s.originBusinessId, lookups.businesses),
      recipient: party(s.destinationBusinessId, lookups.businesses),
    },
    result: matchResult(view, outgoing, lookups.businesses),
    steps: detailSteps(view),
    legs: legRows(view, lookups),
    facts: {
      category: CATEGORY_LABEL[s.category] ?? DASH,
      weight: isNum(s.weightGrams) ? formatKg(s.weightGrams) : DASH,
      description: nonEmpty(s.description),
      pickupInstructions: nonEmpty(s.pickupInstructions),
      dropoffInstructions: nonEmpty(s.dropoffInstructions),
      ready: timeText(s.readyMin),
      deadline: timeText(s.deadlineMin),
    },
    journeyHref: simulatorHref(s.id),
    journeyLabel: 'View journey',
  };
}

export const LOCKED_NOTE = 'Playback has started, so this request can’t be changed until a new planning cycle.';

/** Retry / edit actions: only for an unmatched outgoing request. While locked, no actions and one line saying why. */
export function requestActions(model: DeliveryDetailsModel, phase: Phase): { show: boolean; lockedNote: string | null } {
  const eligible = model.result.kind === 'unmatched' && model.header.direction === 'outgoing';
  if (!eligible) return { show: false, lockedNote: null };
  return phase === 'planning' ? { show: true, lockedNote: null } : { show: false, lockedNote: LOCKED_NOTE };
}
