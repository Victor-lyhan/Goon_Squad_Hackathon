import type { Business, Employee, Hub, ShipmentProgress, Stop } from '../../../../shared/types';
import { jobIdFor } from '../../../../shared/types';
import type { SimulatorResponse } from '../../../../shared/api';
import { STATUS_LABEL } from './packageQueueModel';
import { formatCents, formatMin } from '../../ui/format';

export type LegDetail = {
  jobId: string;
  employeeName: string;
  pickupPlace: string;
  pickupTime: string;
  dropoffPlace: string;
  dropoffTime: string;
  extraLabel: string; // "+N min"
  rewardCents: number;
  rewardLabel: string;
  href: string;
  legLabel: string; // "Evening, Day 1" | "Morning, Day 2"
};

export type TimelineState = 'past' | 'current' | 'future';
export type TimelineEntry = {
  key: string;
  text: string; // "Pickup at X"
  time: string; // formatMin
  state: TimelineState;
  stateLabel: 'Done' | 'Next' | 'Upcoming';
};

export type PackageDetailModel = {
  shipmentId: string;
  label: string;
  senderName: string;
  recipientName: string;
  route: string; // "From → To"
  status: ShipmentProgress;
  statusLabel: string;
  planKind?: string; // "Direct" | "Relay via <hub>"
  legs: LegDetail[];
  timeline: TimelineEntry[];
  timeLabel?: 'Delivered' | 'Planned ETA';
  timeValue?: string;
  priceCents?: number;
  priceLabel?: string;
  hubName?: string;
  unmatchedReason?: string;
  senderHref: string;
  recipientHref: string;
};

export function toPackageDetail(args: {
  sim: SimulatorResponse;
  businesses: Business[];
  hubs: Hub[];
  employees: Employee[];
  shipmentId: string;
}): PackageDetailModel | null {
  const { sim, businesses, hubs, employees, shipmentId } = args;
  const shipment = sim.shipments.find((s) => s.id === shipmentId);
  if (!shipment) return null;

  const bizName = new Map(businesses.map((b) => [b.id, b.name]));
  const placeByNode = new Map<string, string>();
  for (const b of businesses) placeByNode.set(b.nodeId, b.name);
  for (const h of hubs) placeByNode.set(h.nodeId, h.name);
  const place = (stop: Stop | undefined) =>
    (stop && placeByNode.get(stop.nodeId)) ?? 'Unknown place';
  const empName = new Map(employees.map((e) => [e.id, e.name]));

  const plan = sim.plans.find((p) => p.shipmentId === shipmentId);
  const status = sim.snapshot.shipmentStatus[shipmentId] ?? 'unmatched';
  const delivered = sim.snapshot.deliveredAtMin[shipmentId];

  const model: PackageDetailModel = {
    shipmentId,
    label: shipment.label,
    senderName: bizName.get(shipment.originBusinessId) ?? 'Unknown business',
    recipientName: bizName.get(shipment.destinationBusinessId) ?? 'Unknown business',
    route: `${bizName.get(shipment.originBusinessId) ?? 'Unknown business'} → ${bizName.get(shipment.destinationBusinessId) ?? 'Unknown business'}`,
    status,
    statusLabel: STATUS_LABEL[status],
    legs: [],
    timeline: [],
    senderHref: `/business/${shipment.originBusinessId}?shipment=${shipmentId}`,
    recipientHref: `/business/${shipment.destinationBusinessId}?shipment=${shipmentId}`,
  };

  if (!plan) {
    model.unmatchedReason =
      sim.unmatched.find((u) => u.shipmentId === shipmentId)?.reason ?? 'No plan found';
    return model;
  }

  const hubName = hubs.find((h) => h.id === plan.hubId)?.name;
  model.planKind = plan.kind === 'relay' ? `Relay via ${hubName ?? 'hub'}` : 'Direct';
  if (plan.kind === 'relay') model.hubName = hubName ?? 'Relay hub';
  const occurred = new Set(
    (sim.snapshot.occurredEvents ?? [])
      .filter((e) => e.shipmentId === shipmentId)
      .map((e) => `${e.jobId}:${e.kind}`),
  );
  let currentTaken = false;
  plan.legs.forEach((leg, i) => {
    const jobId = jobIdFor(plan.id, i);
    for (const st of leg.stops) {
      const evKind = st.kind === 'delivery' ? 'delivered' : st.kind;
      const done = occurred.has(`${jobId}:${evKind}`);
      const state: TimelineState = done ? 'past' : currentTaken ? 'future' : 'current';
      if (!done) currentTaken = true;
      const where = place(st);
      const text =
        st.kind === 'pickup' ? `Pickup at ${where}`
        : st.kind === 'hub_drop' ? `Dropped at hub ${where}`
        : st.kind === 'hub_pickup' ? `Picked up from hub ${where}`
        : `Delivered to ${where}`;
      model.timeline.push({
        key: `${jobId}-${st.kind}`, text, time: formatMin(st.serviceStartMin), state,
        stateLabel: state === 'past' ? 'Done' : state === 'current' ? 'Next' : 'Upcoming',
      });
    }
  });
  model.legs = plan.legs.map((leg, i) => {
    const first = leg.stops[0];
    const last = leg.stops[leg.stops.length - 1];
    const jobId = jobIdFor(plan.id, i);
    return {
      jobId,
      employeeName: empName.get(leg.employeeId) ?? leg.employeeId,
      pickupPlace: place(first),
      pickupTime: first ? formatMin(first.serviceStartMin) : '',
      dropoffPlace: place(last),
      dropoffTime: last ? formatMin(last.serviceStartMin) : '',
      extraLabel: `+${Math.round(leg.extraMin)} min added`,
      rewardCents: leg.rewardCents,
      rewardLabel: formatCents(leg.rewardCents),
      href: `/employee/${leg.employeeId}?job=${jobId}`,
      legLabel: leg.tripId.endsWith('-morn') ? 'Morning, Day 2' : 'Evening, Day 1',
    };
  });
  if (delivered !== undefined) {
    model.timeLabel = 'Delivered';
    model.timeValue = formatMin(delivered);
  } else {
    model.timeLabel = 'Planned ETA';
    model.timeValue = formatMin(plan.deliveryMin);
  }
  model.priceCents = plan.customerPriceCents;
  model.priceLabel = formatCents(plan.customerPriceCents);
  return model;
}
