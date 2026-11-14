// Display models for the simulator's right-panel inspector (docs/mvp2-ui-redesign.md §1 "Right panel").
// Pure TS, no React. Reads only SimulatorResponse + MapResponse (DECISIONS pass 46): every status, time,
// extra minute, reward and earning comes from the API. This file only looks things up and formats them.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import { jobIdFor } from '../../../../../../shared/v2/types';
import type {
  DeliveryPlan, JobStatus, Leg, NetworkBusiness, Shipment, ShipmentProgress, StopKind,
} from '../../../../../../shared/v2/types';
import { formatCents, formatMin } from '../../../../ui/format';

// ---------- Labels (UI copy says "relay point", never "hub") ----------
export const SHIPMENT_STATUS_LABEL: Record<ShipmentProgress, string> = {
  unmatched: 'Not matched',
  scheduled: 'Scheduled',
  picked_up: 'Picked up',
  at_hub: 'At relay point',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const STOP_KIND_LABEL: Record<StopKind, string> = {
  pickup: 'Pickup',
  hub_drop: 'Drop at relay point',
  hub_pickup: 'Pickup at relay point',
  delivery: 'Delivery',
};

const KIND_LABEL: Record<NetworkBusiness['kind'], string> = { office: 'Office', shop: 'Shop', cafe: 'Café' };
const UNKNOWN_PLACE = 'Unknown place';
const UNKNOWN_PERSON = 'Unknown commuter';
const NO_STATUS = '—';

// ---------- Shared shapes ----------
export type Ref = { id: string; name: string };
/** A business named inside a row. `id` is null when the place does not resolve (never shown raw). */
export type PlaceRef = { id: string | null; name: string };

export type PackageRow = {
  shipmentId: string;
  label: string;
  /** "To" for sent, "From" for received, both for a package held as relay point. */
  parties: { role: 'From' | 'To'; business: PlaceRef }[];
  planKind: 'Direct' | 'Relay' | 'Not matched';
  /** The carriers of the plan's legs, in leg order (empty when unmatched). */
  carriers: Ref[];
  statusLabel: string;
  /** "ETA Day 2, 9:10 AM" from plan.deliveryMin, "Delivered Day 2, 9:05 AM", or null when unmatched. */
  timeLabel: string | null;
  /** The matcher's reason, only for an unmatched package. */
  reason: string | null;
};

export type BusinessInspectorModel = {
  id: string;
  name: string;
  /** Small mono identifier line, e.g. "Office · Brooklyn". Never the raw place ID. */
  ident: string;
  kindLabel: string;
  address: string;
  neighborhood: string;
  borough: string;
  commuters: number;
  commutersLabel: string;
  sent: PackageRow[];
  received: PackageRow[];
  held: PackageRow[];
};

export type StopRow = {
  key: string;
  timeLabel: string;
  kindLabel: string;
  place: PlaceRef;
  isRelay: boolean;
};

export type LegBlock = {
  jobId: string;
  shipmentId: string;
  packageLabel: string;
  legLabel: string;
  stops: StopRow[];
  finishLabel: string;
  extraLabel: string;
  rewardLabel: string;
  statusLabel: string;
};

export type EmployeeInspectorModel = {
  id: string;
  name: string;
  /** Small mono identifier line: the employee ID (not a place ID). */
  ident: string;
  workplace: PlaceRef;
  homeNeighborhood: string;
  legs: LegBlock[];
  /** "No package on this commute." when the employee carries nothing. */
  emptyMessage: string | null;
  earnedLabel: string;
  totalRewardLabel: string;
};

// ---------- Helpers ----------
const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((x) => [x.id, x] as const));
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function placeRef(id: string, businesses: Map<string, NetworkBusiness>): PlaceRef {
  const b = businesses.get(id);
  return b ? { id: b.id, name: b.name } : { id: null, name: UNKNOWN_PLACE };
}

function compareShipments(a: Shipment, b: Shipment): number {
  return (finite(a.createdSeq) && finite(b.createdSeq) ? a.createdSeq - b.createdSeq : 0) || cmpStr(a.id, b.id);
}

function packageRow(
  s: Shipment,
  roles: ('From' | 'To')[],
  ctx: {
    plans: Map<string, DeliveryPlan>;
    businesses: Map<string, NetworkBusiness>;
    names: Map<string, string>;
    reasons: Map<string, string>;
    sim: SimulatorResponse;
  },
): PackageRow {
  const plan = ctx.plans.get(s.id) ?? null;
  const status = ctx.sim.snapshot.shipmentStatus[s.id];
  const deliveredAt = ctx.sim.snapshot.deliveredAtMin[s.id];
  let timeLabel: string | null = null;
  if (finite(deliveredAt)) timeLabel = `Delivered ${formatMin(deliveredAt)}`;
  else if (plan && finite(plan.deliveryMin)) timeLabel = `ETA ${formatMin(plan.deliveryMin)}`;
  return {
    shipmentId: s.id,
    label: s.label || 'Untitled package',
    parties: roles.map((role) => ({
      role,
      business: placeRef(role === 'From' ? s.originBusinessId : s.destinationBusinessId, ctx.businesses),
    })),
    planKind: plan ? (plan.kind === 'relay' ? 'Relay' : 'Direct') : 'Not matched',
    carriers: plan ? plan.legs.map((l) => ({ id: l.employeeId, name: ctx.names.get(l.employeeId) ?? UNKNOWN_PERSON })) : [],
    statusLabel: (status && SHIPMENT_STATUS_LABEL[status]) || NO_STATUS,
    timeLabel,
    reason: plan ? null : ctx.reasons.get(s.id) ?? null,
  };
}

// ---------- Business ----------
export function businessInspector(
  businessId: string,
  sim: SimulatorResponse,
  map: MapResponse,
): BusinessInspectorModel | null {
  const businesses = byId(map.businesses);
  const biz = businesses.get(businessId);
  if (!biz) return null;

  const plans = new Map(sim.plans.map((p) => [p.shipmentId, p] as const));
  const ctx = {
    plans,
    businesses,
    names: new Map(map.employees.map((e) => [e.id, e.name] as const)),
    reasons: new Map(sim.unmatched.map((u) => [u.shipmentId, u.reason] as const)),
    sim,
  };
  const shipments = [...sim.shipments].sort(compareShipments);
  const heldIds = new Set(
    sim.plans.filter((p) => p.kind === 'relay' && p.relayBusinessId === businessId).map((p) => p.shipmentId),
  );

  const commuters = map.employees.filter((e) => e.businessId === businessId).length;
  return {
    id: biz.id,
    name: biz.name,
    ident: `${KIND_LABEL[biz.kind] ?? 'Business'} · ${biz.borough}`,
    kindLabel: KIND_LABEL[biz.kind] ?? 'Business',
    address: biz.address,
    neighborhood: biz.neighborhood,
    borough: biz.borough,
    commuters,
    commutersLabel: `${commuters} ${commuters === 1 ? 'commuter works' : 'commuters work'} here`,
    sent: shipments.filter((s) => s.originBusinessId === businessId).map((s) => packageRow(s, ['To'], ctx)),
    received: shipments
      .filter((s) => s.destinationBusinessId === businessId)
      .map((s) => packageRow(s, ['From'], ctx)),
    held: shipments
      .filter((s) => heldIds.has(s.id) && s.originBusinessId !== businessId && s.destinationBusinessId !== businessId)
      .map((s) => packageRow(s, ['From', 'To'], ctx)),
  };
}

// ---------- Employee ----------
type CarriedLeg = { plan: DeliveryPlan; leg: Leg; legIndex: number };

function legLabel(plan: DeliveryPlan, legIndex: number): string {
  if (plan.kind !== 'relay') return 'Direct';
  return `Relay leg ${legIndex + 1} of ${plan.legs.length}`;
}

export function employeeInspector(
  employeeId: string,
  sim: SimulatorResponse,
  map: MapResponse,
): EmployeeInspectorModel | null {
  const employee = map.employees.find((e) => e.id === employeeId);
  if (!employee) return null;

  const businesses = byId(map.businesses);
  const shipments = byId(sim.shipments);
  const jobs = new Map(sim.jobs.map((j) => [`${j.planId}#${j.legIndex}`, j] as const));
  const home = map.homes.find((h) => h.id === employee.homeId);

  const carried: CarriedLeg[] = [];
  for (const plan of sim.plans) {
    plan.legs.forEach((leg, legIndex) => {
      if (leg.employeeId === employeeId) carried.push({ plan, leg, legIndex });
    });
  }
  const firstTime = (c: CarriedLeg) => c.leg.stops[0]?.serviceStartMin ?? c.leg.finishMin;
  carried.sort((a, b) =>
    (firstTime(a) - firstTime(b)) || cmpStr(a.plan.id, b.plan.id) || a.legIndex - b.legIndex);

  const legs: LegBlock[] = carried.map(({ plan, leg, legIndex }) => {
    const job = jobs.get(`${plan.id}#${legIndex}`);
    const jobStatus = job ? sim.snapshot.jobStatus[job.id] : undefined;
    return {
      jobId: job?.id ?? jobIdFor(plan.id, legIndex),
      shipmentId: plan.shipmentId,
      packageLabel: shipments.get(plan.shipmentId)?.label || 'Untitled package',
      legLabel: legLabel(plan, legIndex),
      stops: leg.stops.map((stop, i) => ({
        key: `${i}-${stop.kind}`,
        timeLabel: formatMin(stop.serviceStartMin),
        kindLabel: STOP_KIND_LABEL[stop.kind] ?? 'Stop',
        place: placeRef(stop.placeId, businesses),
        isRelay: stop.kind === 'hub_drop' || stop.kind === 'hub_pickup',
      })),
      finishLabel: formatMin(leg.finishMin),
      extraLabel: `+${finite(leg.extraMin) ? leg.extraMin : 0} min`,
      rewardLabel: formatCents(finite(leg.rewardCents) ? leg.rewardCents : 0),
      statusLabel: (jobStatus && JOB_STATUS_LABEL[jobStatus]) || NO_STATUS,
    };
  });

  const earned = sim.snapshot.earningsCents[employeeId];
  const totalReward = carried.reduce((sum, c) => sum + (finite(c.leg.rewardCents) ? c.leg.rewardCents : 0), 0);
  return {
    id: employee.id,
    name: employee.name,
    ident: employee.id.toUpperCase(),
    workplace: placeRef(employee.businessId, businesses),
    homeNeighborhood: home?.neighborhood || 'Unknown neighborhood',
    legs,
    emptyMessage: legs.length === 0 ? 'No package on this commute.' : null,
    earnedLabel: formatCents(finite(earned) ? earned : 0),
    totalRewardLabel: formatCents(totalReward),
  };
}
