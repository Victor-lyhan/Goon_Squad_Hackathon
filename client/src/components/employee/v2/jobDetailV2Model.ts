// Pure view model for the MVP II delivery job detail (issue #387).
// Everything comes from the API's JobResponse; nothing is recomputed here. Places are resolved to
// network business names; a home is only ever shown as its neighborhood (SPEC MVP II rule 6), and a
// place that does not resolve reads "Unknown place" (DECISIONS pass 45), never a raw ID.
import type { JobResponse } from '../../../../../shared/v2/api';
import type { JobStatus, NetworkBusiness, StopKind } from '../../../../../shared/v2/types';
import { formatCents, formatDuration } from '../../../ui/format';

export const UNKNOWN_PLACE = 'Unknown place';

export type RouteRow = {
  key: string;
  /** 'start' and 'end' are the commute's own endpoints; the rest are stops at network businesses. */
  kind: 'start' | 'end' | StopKind;
  /** "17:15" for start, "17:32–17:34" for a stop, "17:58" for the end. */
  time: string;
  place: string;
  address: string;
  action: string;
  instructions: string;
  /** Done per the API job status only (first stop once in progress, all once completed). */
  done: boolean;
};

export type JobDetailV2Model = {
  title: string;
  legKind: string;
  trip: string;
  status: JobStatus;
  statusLabel: string;
  statusNote: string;
  route: RouteRow[];
  numbers: { label: string; value: string }[];
  relay: string | null;
  watchHref: string;
};

export const STOP_ACTION: Record<StopKind, string> = {
  pickup: 'Collect the package',
  delivery: 'Hand over the package',
  hub_drop: 'Leave it at the relay point for the morning carrier',
  hub_pickup: 'Collect it from the relay point',
};

const STATUS_LABEL: Record<JobStatus, string> = {
  assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed',
};
const STATUS_NOTE: Record<JobStatus, string> = {
  assigned: 'Not started yet. It starts when your commute leaves.',
  in_progress: 'On your commute now.',
  completed: 'Done. Thanks for carrying it.',
};

/** 24-hour "17:15" for minutes since Day 1 00:00 (the day is shown on the trip line). */
export function clock24(min: number): string {
  if (!Number.isFinite(min)) return '--:--';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const dayOf = (min: number) => (Number.isFinite(min) ? Math.floor(Math.max(0, min) / 1440) + 1 : 1);

const homeLabel = (neighborhood: string) => (neighborhood.trim() ? `Home · ${neighborhood.trim()}` : 'Home');

/** Name and address of a place: a network business, the employee's home (neighborhood only), else "Unknown place". */
export function resolvePlace(
  placeId: string | undefined,
  businesses: NetworkBusiness[],
  homeNeighborhood: string,
): { name: string; address: string } {
  const biz = placeId ? businesses.find((b) => b.id === placeId) : undefined;
  if (biz) return { name: biz.name, address: biz.address };
  if (placeId && placeId.startsWith('home-')) return { name: homeLabel(homeNeighborhood), address: '' };
  return { name: UNKNOWN_PLACE, address: '' };
}

const businessName = (id: string | undefined, businesses: NetworkBusiness[]) =>
  (id && businesses.find((b) => b.id === id)?.name) || UNKNOWN_PLACE;

/** "Direct delivery" or which relay leg this job is. */
export function legKindLabel(job: JobResponse): string {
  if (job.plan.kind !== 'relay') return 'Direct delivery';
  return job.job.legIndex === 0
    ? 'Relay leg 1 of 2: drop at the relay point'
    : 'Relay leg 2 of 2: collect from the relay point';
}

/** "Evening commute, Day 1, leaves 17:15" from the API trip. */
export function tripLine(job: JobResponse): string {
  const { direction, departureMin } = job.trip;
  const name = direction === 'evening' ? 'Evening commute' : 'Morning commute';
  return `${name}, Day ${dayOf(departureMin)}, leaves ${clock24(departureMin)}`;
}

/** One sentence naming the relay business and what the other carrier does; null for a direct plan. */
export function relaySentence(job: JobResponse, businesses: NetworkBusiness[]): string | null {
  if (job.plan.kind !== 'relay') return null;
  const relay = businessName(job.plan.relayBusinessId, businesses);
  if (job.job.legIndex === 0) {
    const dest = businessName(job.shipment.destinationBusinessId, businesses);
    return `You leave the package at ${relay}, which keeps it overnight; another carrier collects it there on their morning commute and delivers it to ${dest}.`;
  }
  const origin = businessName(job.shipment.originBusinessId, businesses);
  return `Another carrier brought the package from ${origin} to ${relay} on their evening commute; you collect it there and deliver it.`;
}

function stopDone(status: JobStatus, index: number): boolean {
  if (status === 'completed') return true;
  return status === 'in_progress' && index === 0;
}

/** Ordered rows: commute start, each stop with its window and action, commute end. */
export function routeRows(job: JobResponse, businesses: NetworkBusiness[], homeNeighborhood: string): RouteRow[] {
  const leg = job.plan.legs[job.job.legIndex];
  const stops = leg?.stops?.length ? leg.stops : [job.job.pickup, job.job.dropoff];
  const { shipment, trip, status } = job;
  const start = resolvePlace(trip.originPlaceId, businesses, homeNeighborhood);
  const end = resolvePlace(trip.destinationPlaceId, businesses, homeNeighborhood);
  const lastStop = stops[stops.length - 1];
  const finishMin = leg?.finishMin ?? lastStop?.serviceEndMin;
  const rows: RouteRow[] = [{
    key: 'start', kind: 'start', time: clock24(trip.departureMin),
    place: start.name, address: start.address,
    action: trip.direction === 'evening' ? 'Leave work' : 'Leave home',
    instructions: '', done: status !== 'assigned',
  }];
  stops.forEach((s, i) => {
    const p = resolvePlace(s.placeId, businesses, homeNeighborhood);
    const instructions = s.kind === 'pickup' ? shipment.pickupInstructions
      : s.kind === 'delivery' ? shipment.dropoffInstructions : '';
    rows.push({
      key: `${i}-${s.kind}`, kind: s.kind,
      time: `${clock24(s.arrivalMin)}–${clock24(s.serviceEndMin)}`,
      place: p.name, address: p.address, action: STOP_ACTION[s.kind],
      instructions: (instructions ?? '').trim(), done: stopDone(status, i),
    });
  });
  rows.push({
    key: 'end', kind: 'end', time: clock24(finishMin ?? Number.NaN),
    place: end.name, address: end.address,
    action: trip.direction === 'evening' ? 'Arrive home' : 'Arrive at work',
    instructions: '', done: status === 'completed',
  });
  return rows;
}

/** "3.4 km" from meters (one decimal), "0 km" for nothing. */
export function formatKm(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 km';
  const km = Math.round(meters / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/**
 * Extra distance with its sign: "+3.4 km", or "-5.5 km" when the detour route is shorter than the usual one
 * (real Google routes: the fastest path with stops can be shorter than the fastest path without). The API value
 * is shown as sent; before #513 a negative value read "+0 km".
 */
export function signedKm(meters: number): string {
  if (!Number.isFinite(meters)) return '+0 km';
  const km = formatKm(Math.abs(meters));
  return meters < 0 && km !== '0 km' ? `-${km}` : `+${km}`;
}

/** Simulator deep link with this package selected (DECISIONS pass 8). */
export const watchHref = (job: JobResponse) => `/simulator?package=${encodeURIComponent(job.shipment.id)}`;

export function jobDetail(job: JobResponse, businesses: NetworkBusiness[], homeNeighborhood: string): JobDetailV2Model {
  const leg = job.plan.legs[job.job.legIndex];
  const extraMin = leg?.extraMin ?? 0;
  const extraM = leg?.extraDistanceM ?? 0;
  return {
    title: job.shipment.label,
    legKind: legKindLabel(job),
    trip: tripLine(job),
    status: job.status,
    statusLabel: STATUS_LABEL[job.status] ?? 'Assigned',
    statusNote: STATUS_NOTE[job.status] ?? '',
    route: routeRows(job, businesses, homeNeighborhood),
    numbers: [
      { label: 'Extra time', value: `+${Number.isFinite(extraMin) ? extraMin : 0} min` },
      { label: 'Extra distance', value: signedKm(extraM) },
      { label: 'Reward', value: formatCents(Number.isFinite(job.job.rewardCents) ? job.job.rewardCents : 0) },
      { label: 'Usual commute', value: formatDuration(Number.isFinite(job.trip.baselineDurationMin) ? job.trip.baselineDurationMin : 0) },
    ],
    relay: relaySentence(job, businesses),
    watchHref: watchHref(job),
  };
}
