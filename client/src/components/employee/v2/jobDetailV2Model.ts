// Pure view model for the MVP II delivery job detail (issue #387).
// Everything comes from the API's JobResponse; nothing is recomputed here. Places are resolved to
// network business names; a home is only ever shown as its neighborhood (SPEC MVP II rule 6), and a
// place that does not resolve reads "Unknown place" (DECISIONS pass 45), never a raw ID.
import type { JobResponse } from '../../../../../shared/v2/api';
import type { JobStatus, NetworkBusiness, StopKind } from '../../../../../shared/v2/types';
import { formatCents, formatDuration, formatMin } from '../../../ui/format';

export const UNKNOWN_PLACE = 'Unknown place';

// A `?job=` that this employee cannot open (#634). The job request answers 404 after a re-match
// (Recompute, a commute save) as well as after a new run, so the text names both and never says that
// the city changed. The words are "delivery" and "carrier", as on the rest of the page.
export const JOB_MISSING_TITLE = 'This delivery is no longer assigned to you';
export const JOB_MISSING_TEXT = 'It was re-matched or the run changed. Your current deliveries are on your page.';
export const JOB_OTHER_TITLE = 'This delivery is assigned to another carrier';
export const JOB_OTHER_TEXT = 'Your current deliveries are on your page.';
// The job's request failed before any answer arrived (#882). The page asks again every second, so the
// text says so and offers the way back; it never shows the HTTP client's own error.
export const JOB_FAILED_TITLE = 'This delivery could not be loaded';
export const JOB_FAILED_TEXT = 'The request to the Relay server failed. Trying again every second.';

// The route is a checklist (#882): each row has a tick box drawn by CSS, and its state in words for
// people who do not see the box. A done row keeps " (done)" after its action (#781); a row that is not
// done says so in text only a screen reader gets.
export const ROW_DONE_SUFFIX = ' (done)';
export const ROW_NOT_DONE_TEXT = 'Not done yet';

export type RouteRow = {
  key: string;
  /** 'start' and 'end' are the commute's own endpoints; the rest are stops at network businesses. */
  kind: 'start' | 'end' | StopKind;
  /**
   * One moment per row, as "Day 1, 5:15 PM" (DECISIONS pass 60): the departure for the start, the stop's
   * `serviceStartMin` (the same time the assigned row shows), the leg's `finishMin` for the end.
   */
  time: string;
  place: string;
  address: string;
  action: string;
  instructions: string;
  /**
   * A stop is done per the API's `stopsDone` count (#781); without it, per the job status (first stop once
   * in progress, all once completed). The start row is done per the API's `departed` (#791); without it,
   * once the job is no longer assigned. The end row is done per the API's `arrived` (#836); without it, once
   * the job is completed.
   */
  done: boolean;
};

export type NumberKey = 'reward' | 'extra-time' | 'extra-distance' | 'usual-commute';

export type JobDetailV2Model = {
  title: string;
  legKind: string;
  trip: string;
  status: JobStatus;
  statusLabel: string;
  statusNote: string;
  route: RouteRow[];
  /** "What it adds", reward first (#551). `key` is a stable hook for styling and tests. */
  numbers: { key: NumberKey; label: string; value: string }[];
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
/** Still "Assigned" (no stop handled yet) but the API says the commute has left (`departed`, #791). */
export const STATUS_NOTE_LEFT = 'Your commute has left. The package is not collected yet.';

/** The line under the status label. Only the words depend on `departed`; the status itself is the API's. */
function statusNote(job: JobResponse): string {
  if (job.status === 'assigned' && job.departed === true) return STATUS_NOTE_LEFT;
  return STATUS_NOTE[job.status] ?? '';
}

export const TIME_UNAVAILABLE = 'Time unavailable';

/**
 * A moment of the delivery as "Day 2, 8:05 AM" (`formatMin`, the one format of all three workspaces, DECISIONS
 * pass 60); "Time unavailable" for a value that is not a number, never a made-up time.
 */
export function momentText(min: number | null | undefined): string {
  return typeof min === 'number' && Number.isFinite(min) ? formatMin(min) : TIME_UNAVAILABLE;
}

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

/** "Evening commute, leaves Day 1, 5:15 PM" from the API trip: this job's departure, so it carries its day. */
export function tripLine(job: JobResponse): string {
  const { direction, departureMin } = job.trip;
  const name = direction === 'evening' ? 'Evening commute' : 'Morning commute';
  return `${name}, leaves ${momentText(departureMin)}`;
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

/**
 * Is stop `index` of the leg done? The server's count decides (`stopsDone`, #781): the first `stopsDone`
 * stops are done. An answer without the count (an older sample) falls back to the job status: the first
 * stop once in progress, all once completed.
 */
function stopDone(status: JobStatus, index: number, stopsDone: number | undefined): boolean {
  if (typeof stopsDone === 'number' && Number.isFinite(stopsDone)) return index < stopsDone;
  if (status === 'completed') return true;
  return status === 'in_progress' && index === 0;
}

/** Ordered rows: commute start, each stop with its time and action, commute end. */
export function routeRows(job: JobResponse, businesses: NetworkBusiness[], homeNeighborhood: string): RouteRow[] {
  const leg = job.plan.legs[job.job.legIndex];
  const stops = leg?.stops?.length ? leg.stops : [job.job.pickup, job.job.dropoff];
  const { shipment, trip, status, stopsDone, departed, arrived } = job;
  const start = resolvePlace(trip.originPlaceId, businesses, homeNeighborhood);
  const end = resolvePlace(trip.destinationPlaceId, businesses, homeNeighborhood);
  const lastStop = stops[stops.length - 1];
  const finishMin = leg?.finishMin ?? lastStop?.serviceEndMin;
  const rows: RouteRow[] = [{
    key: 'start', kind: 'start', time: momentText(trip.departureMin),
    place: start.name, address: start.address,
    action: trip.direction === 'evening' ? 'Leave work' : 'Leave home',
    // The server says when the commute has left (`departed`, #791). An answer without it (an older sample)
    // keeps the old rule: left once the first stop is handled, which is when the job stops being "assigned".
    instructions: '', done: typeof departed === 'boolean' ? departed : status !== 'assigned',
  }];
  stops.forEach((s, i) => {
    const p = resolvePlace(s.placeId, businesses, homeNeighborhood);
    const instructions = s.kind === 'pickup' ? shipment.pickupInstructions
      : s.kind === 'delivery' ? shipment.dropoffInstructions : '';
    rows.push({
      key: `${i}-${s.kind}`, kind: s.kind,
      time: momentText(s.serviceStartMin),
      place: p.name, address: p.address, action: STOP_ACTION[s.kind],
      instructions: (instructions ?? '').trim(), done: stopDone(status, i, stopsDone),
    });
  });
  rows.push({
    key: 'end', kind: 'end', time: momentText(finishMin),
    place: end.name, address: end.address,
    action: trip.direction === 'evening' ? 'Arrive home' : 'Arrive at work',
    // The server says when the commute has arrived (`arrived`, #836): a job is "completed" when its last stop
    // is handled, and the carrier may still be driving. An answer without it (an older sample) keeps the old
    // rule: arrived once the job is completed.
    instructions: '', done: typeof arrived === 'boolean' ? arrived : status === 'completed',
  });
  return rows;
}

/** "3.4 km" from meters (one decimal), "0 km" for nothing. */
export function formatKm(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 km';
  const km = Math.round(meters / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

export const NO_EXTRA_DISTANCE = 'No extra distance';
export const DISTANCE_UNAVAILABLE = 'Distance unavailable';

/**
 * The API's extra distance in plain words (#551, DECISIONS pass 58): "+3.4 km" when the detour is longer,
 * "5.5 km shorter" when the route with the stops is shorter than the usual one (real Google routes: the fastest
 * path with stops can be shorter than the fastest path without), "No extra distance" for zero (or a value that
 * rounds to 0.0 km), "Distance unavailable" for a value that is not a number. Only formatting: the number is the
 * matcher's `extraDistanceM`.
 */
export function extraDistanceText(meters: number | null | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return DISTANCE_UNAVAILABLE;
  const km = formatKm(Math.abs(meters));
  if (km === '0 km') return NO_EXTRA_DISTANCE;
  return meters < 0 ? `${km} shorter` : `+${km}`;
}

/** Extra minutes as sent: "+8 min" ("+0 min" for zero), "3 min shorter" if a matcher ever sends less. */
export function extraTimeText(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return 'Time unavailable';
  return minutes < 0 ? `${Math.abs(minutes)} min shorter` : `+${minutes} min`;
}

/**
 * The Employee page's one "watch" link: the simulator opens on this package and plays its journey once
 * (DECISIONS pass 8, 63 and 64). The delivery list and the job view both build their link here.
 */
export const simulatorHref = (shipmentId: string) => `/simulator?package=${encodeURIComponent(shipmentId)}&play=1`;

/** The job view's "Watch this package" link. */
export const watchHref = (job: JobResponse) => simulatorHref(job.shipment.id);

export function jobDetail(job: JobResponse, businesses: NetworkBusiness[], homeNeighborhood: string): JobDetailV2Model {
  const leg = job.plan.legs[job.job.legIndex];
  return {
    title: job.shipment.label,
    legKind: legKindLabel(job),
    trip: tripLine(job),
    status: job.status,
    statusLabel: STATUS_LABEL[job.status] ?? 'Assigned',
    statusNote: statusNote(job),
    route: routeRows(job, businesses, homeNeighborhood),
    numbers: [
      // Reward first: it is what the carrier gets; then what it costs them (#551).
      { key: 'reward', label: 'Reward', value: formatCents(Number.isFinite(job.job.rewardCents) ? job.job.rewardCents : 0) },
      { key: 'extra-time', label: 'Extra time', value: extraTimeText(leg?.extraMin) },
      { key: 'extra-distance', label: 'Extra distance', value: extraDistanceText(leg?.extraDistanceM) },
      { key: 'usual-commute', label: 'Usual commute', value: formatDuration(Number.isFinite(job.trip.baselineDurationMin) ? job.trip.baselineDurationMin : 0) },
    ],
    relay: relaySentence(job, businesses),
    watchHref: watchHref(job),
  };
}
