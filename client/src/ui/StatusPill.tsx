import type { JobStatus, ShipmentProgress } from '../../../shared/types';
import './ui.css';

export type PillStatus = ShipmentProgress | JobStatus | 'direct' | 'relay';

export type StatusPillProps = {
  /** Shipment progress, job status, or plan type to display. */
  status: PillStatus;
};

type Tone = 'neutral' | 'info' | 'warn' | 'success' | 'danger';
const MAP: Record<PillStatus, { label: string; tone: Tone }> = {
  unmatched: { label: 'Unmatched', tone: 'danger' },
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  picked_up: { label: 'Picked up', tone: 'info' },
  at_hub: { label: 'At hub', tone: 'warn' },
  out_for_delivery: { label: 'Out for delivery', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  assigned: { label: 'Assigned', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  direct: { label: 'Direct', tone: 'info' },
  relay: { label: 'Relay', tone: 'warn' },
};

/** Text label for a status (shared so tests/other UI can reuse it). */
export function statusLabel(status: PillStatus): string {
  return MAP[status].label;
}

export function StatusPill({ status }: StatusPillProps) {
  const { label, tone } = MAP[status];
  return <span className={`ui-pill ui-pill--${tone}`}>{label}</span>;
}
