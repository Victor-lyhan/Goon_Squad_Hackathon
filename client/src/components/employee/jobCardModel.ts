import type { EmployeeJobView } from '../../../../shared/api';
import type { Business, Hub, JobStatus } from '../../../../shared/types';
import { formatCents, formatKg, formatMin } from '../../ui/format';

export type JobCardModel = {
  jobId: string;
  /** Link target for the View job action. */
  href: string;
  title: string;
  status: JobStatus;
  statusLabel: string;
  packageName: string;
  category: string;
  weight: string;
  senderName: string;
  recipientName: string;
  pickupPlace: string;
  pickupTime: string;
  dropoffPlace: string;
  dropoffTime: string;
  addedTime: string;
  reward: string;
  tag: string;
  isRelay: boolean;
  /** Ultimate destination business; only set on relay legs. */
  finalDestination: string | null;
  /** Spec §3B relay copy for this leg; null for direct jobs. */
  relayNote: string | null;
};

const STATUS_LABEL: Record<JobStatus, string> = {
  assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed',
};

/** Pure display model: resolves names and formats values; computes nothing about status or money. */
export function toJobCardModel(view: EmployeeJobView, businesses: Business[], hubs: Hub[]): JobCardModel {
  const { job, shipment, plan, status } = view;
  const bizName = (id: string) => businesses.find((b) => b.id === id)?.name ?? 'Business';
  const place = (nodeId: string) =>
    businesses.find((b) => b.nodeId === nodeId)?.name ?? hubs.find((h) => h.nodeId === nodeId)?.name ?? 'Stop';
  const isRelay = plan.kind === 'relay';
  const hubName = hubs.find((h) => h.id === plan.hubId)?.name ?? 'the hub';
  const relayNote = !isRelay ? null
    : job.legIndex === 0 ? `Drop at ${hubName}; another employee completes delivery to ${bizName(shipment.destinationBusinessId)}`
    : `Collect from ${hubName} and deliver to ${bizName(shipment.destinationBusinessId)}`;
  return {
    jobId: job.id,
    href: `/employee/${encodeURIComponent(job.employeeId)}?job=${encodeURIComponent(job.id)}`,
    title: 'New delivery job',
    status,
    statusLabel: STATUS_LABEL[status],
    packageName: shipment.label,
    category: shipment.category === 'envelope' ? 'Envelope' : 'Small box',
    weight: formatKg(shipment.weightGrams),
    senderName: bizName(shipment.originBusinessId),
    recipientName: bizName(shipment.destinationBusinessId),
    pickupPlace: place(job.pickup.nodeId),
    pickupTime: formatMin(job.pickup.serviceStartMin),
    dropoffPlace: place(job.dropoff.nodeId),
    dropoffTime: formatMin(job.dropoff.serviceStartMin),
    addedTime: `+${plan.legs[job.legIndex]?.extraMin ?? 0} min`,
    reward: formatCents(job.rewardCents),
    tag: isRelay ? `Relay leg ${job.legIndex + 1} of ${plan.legs.length}` : 'Direct',
    isRelay,
    finalDestination: isRelay ? bizName(shipment.destinationBusinessId) : null,
    relayNote,
  };
}
