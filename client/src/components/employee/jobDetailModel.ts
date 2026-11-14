import type { JobResponse } from '../../../../shared/api';
import type { Business, Hub, Node, ShipmentProgress, StopKind } from '../../../../shared/types';
import { formatCents, formatKg, formatMin } from '../../ui/format';

export type JobLookups = { businesses: Business[]; hubs: Hub[]; nodes?: Node[] };

export type StopRow = {
  key: string;
  kind: StopKind;
  action: string;
  place: string;
  arrival: string;
  service: string;
  instructions: string;
};

export type JobDetailModel = {
  statusLabel: string;
  packageName: string;
  category: string;
  weight: string;
  finish: string;
  added: string;
  reward: string;
  relay: string | null;
  progress: string;
  trackHref: string;
  watchHref: string;
  stops: StopRow[];
};

const ACTION: Record<StopKind, string> = {
  pickup: 'Pick up', hub_drop: 'Drop at hub', hub_pickup: 'Collect from hub', delivery: 'Deliver',
};

/** Friendly place name for a node: business, hub, node label, else generic. Never a raw ID. */
export function placeName(nodeId: string, l: JobLookups): string {
  return l.businesses.find((b) => b.nodeId === nodeId)?.name
    ?? l.hubs.find((h) => h.nodeId === nodeId)?.name
    ?? l.nodes?.find((n) => n.id === nodeId)?.label
    ?? 'Stop';
}

/** Explains the relay for this job's leg; null for direct plans. */
export function relayExplanation(job: JobResponse, l: JobLookups): string | null {
  const { plan, shipment, job: j } = job;
  if (plan.kind !== 'relay') return null;
  const hub = l.hubs.find((h) => h.id === plan.hubId)?.name ?? 'the hub';
  if (j.legIndex === 0) return `Drop at ${hub}; another employee completes delivery`;
  const dest = l.businesses.find((b) => b.id === shipment.destinationBusinessId)?.name ?? 'the destination';
  return `Collect from ${hub} and deliver to ${dest}`;
}

/** Ordered stops of this job's leg with names, times and instructions. */
export function stopRows(job: JobResponse, l: JobLookups): StopRow[] {
  const leg = job.plan.legs[job.job.legIndex];
  const { shipment } = job;
  return (leg?.stops ?? []).map((s, i) => ({
    key: `${i}-${s.kind}`,
    kind: s.kind,
    action: ACTION[s.kind],
    place: placeName(s.nodeId, l),
    arrival: formatMin(s.arrivalMin),
    service: `${formatMin(s.serviceStartMin)} to ${formatMin(s.serviceEndMin)}`,
    instructions: s.kind === 'pickup' ? shipment.pickupInstructions
      : s.kind === 'delivery' ? shipment.dropoffInstructions : '',
  }));
}

/** Deep link to the sender's tracking drawer (DECISIONS pass 4). */
export const trackHref = (job: JobResponse) =>
  `/business/${encodeURIComponent(job.shipment.originBusinessId)}?shipment=${encodeURIComponent(job.shipment.id)}`;
/** Deep link to the simulator with the package selected (DECISIONS pass 8). */
export const watchHref = (job: JobResponse) => `/simulator?package=${encodeURIComponent(job.shipment.id)}`;

/**
 * One-line "where is the package" note. Everything comes from the API: the shipment's own
 * progress when the caller has it, else this job's API status plus the plan. Nothing is computed.
 */
export function progressNote(job: JobResponse, l: JobLookups, progress?: ShipmentProgress): string {
  const { plan, shipment, job: j } = job;
  const hub = l.hubs.find((h) => h.id === plan.hubId)?.name ?? 'the hub';
  const origin = l.businesses.find((b) => b.id === shipment.originBusinessId)?.name ?? 'the sender';
  const dest = l.businesses.find((b) => b.id === shipment.destinationBusinessId)?.name ?? 'the destination';
  if (progress) {
    switch (progress) {
      case 'unmatched': return 'Package is not matched to a carrier yet';
      case 'scheduled': return `Package is waiting at ${origin} for pickup`;
      case 'picked_up': return plan.kind === 'relay' ? `Package is on its way to ${hub}` : `Package is on its way to ${dest}`;
      case 'at_hub': return `Package is at ${hub}, waiting for the next leg`;
      case 'out_for_delivery': return `Package is on its way to ${dest}`;
      case 'delivered': return `Package was delivered to ${dest}`;
    }
  }
  if (job.status === 'completed') {
    return plan.kind === 'relay' && j.legIndex === 0 ? `Your leg is done, package is at ${hub}` : `Package was delivered to ${dest}`;
  }
  if (job.status === 'in_progress') {
    return plan.kind === 'relay' && j.legIndex === 0 ? `Package is with you, on its way to ${hub}` : `Package is with you, on its way to ${dest}`;
  }
  return plan.kind === 'relay' && j.legIndex === 1
    ? `Package is at ${hub}, waiting for your pickup`
    : `Package is waiting at ${origin} for pickup`;
}

const STATUS_LABEL = { assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' } as const;

export function toJobDetailModel(job: JobResponse, l: JobLookups, progress?: ShipmentProgress): JobDetailModel {
  const leg = job.plan.legs[job.job.legIndex];
  return {
    statusLabel: STATUS_LABEL[job.status],
    packageName: job.shipment.label,
    category: job.shipment.category === 'envelope' ? 'Envelope' : 'Small box',
    weight: formatKg(job.shipment.weightGrams),
    finish: leg ? formatMin(leg.finishMin) : '',
    added: `+${leg?.extraMin ?? 0} min`,
    reward: formatCents(job.job.rewardCents),
    relay: relayExplanation(job, l),
    progress: progressNote(job, l, progress),
    trackHref: trackHref(job),
    watchHref: watchHref(job),
    stops: stopRows(job, l),
  };
}
