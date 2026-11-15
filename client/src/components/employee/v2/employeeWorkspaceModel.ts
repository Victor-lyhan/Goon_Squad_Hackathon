// Pure display model for the MVP II Employee workspace (docs/mvp2-ui-redesign.md §2).
// Resolves names and formats API values; never computes statuses, earnings or travel times.
import type { EmployeeDashboard, EmployeeJobView } from '../../../../../shared/v2/api';
import type { JobStatus, NetworkBusiness, Stop, Trip } from '../../../../../shared/v2/types';
import { formatCents, formatClock, formatDuration } from '../../../ui/format';
import { extraTimeText, momentText, relayPointName, simulatorHref } from './jobDetailV2Model';

export const UNKNOWN_PLACE = 'Unknown place';

export type TripSummary = {
  direction: 'evening' | 'morning';
  /** "Evening" / "Morning". */
  label: string;
  /** Route in words: "Acme Co → Astoria" (evening) or "Astoria → Acme Co" (morning). */
  from: string;
  to: string;
  available: boolean;
  /** "5:30 PM": the saved daily departure, a setting and not a moment of one day; null when not available. */
  departure: string | null;
  /** "34 min"; null when not available. */
  duration: string | null;
  /** "8.4 km"; null when not available. */
  distance: string | null;
  /** "Not available in the evening"; null when available. */
  unavailableText: string | null;
};

export type CommuteSummaryModel = {
  workplaceName: string;
  workplaceNeighborhood: string;
  workplaceAddress: string;
  homeNeighborhood: string;
  trips: TripSummary[]; // evening first, then morning
  detourLimit: string; // "Up to 15 min extra per trip"
};

export type DeliveryRow = {
  jobId: string;
  packageLabel: string;
  status: JobStatus;
  statusLabel: string;
  /** "Day 1, 6:12 PM · Joe's Coffee" or "Day 1, 6:12 PM · Relay point: Joe's Coffee". */
  pickup: string;
  dropoff: string;
  /** A moment of the delivery: "Day 2, 8:05 AM" (DECISIONS pass 60), so a morning leg says Day 2. */
  pickupTime: string;
  pickupPlace: string;
  dropoffTime: string;
  dropoffPlace: string;
  /** The leg's extra minutes in the words of the job view: "+7 min", "+0 min", "3 min shorter" (#633). */
  extraMin: string;
  /** "$8.00". */
  reward: string;
  /** "Direct", "Relay: you take it to Joe's Coffee", "Relay: you take it from Joe's Coffee" (#916). */
  legKind: string;
  /** "Evening commute to Astoria" / "Morning commute from Astoria". */
  commute: string;
  jobHref: string;
  simulatorHref: string;
  /** Names of the row's two links for a screen reader, so two rows do not both read "View job" (#882). */
  jobLinkLabel: string;
  simulatorLinkLabel: string;
};

export type EarningsModel = { earned: string; projected: string };

const STATUS_LABEL: Record<JobStatus, string> = {
  assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed',
};

const businessById = (businesses: NetworkBusiness[]) => {
  const map = new Map(businesses.map((b) => [b.id, b]));
  return (id: string | undefined) => (id ? map.get(id) : undefined);
};

/** Meters -> "850 m" below 1 km, else "8.4 km". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = Math.round(m / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

export function commuteSummary(dashboard: EmployeeDashboard, businesses: NetworkBusiness[]): CommuteSummaryModel {
  const { employee, home, trips } = dashboard;
  const work = businessById(businesses)(employee.businessId);
  const workplaceName = work?.name ?? UNKNOWN_PLACE;
  const homeNeighborhood = home.neighborhood || 'Home';
  const tripFor = (direction: Trip['direction']): TripSummary => {
    const trip = trips.find((t) => t.direction === direction);
    const flag = direction === 'evening' ? employee.availableEvening : employee.availableMorning;
    const label = direction === 'evening' ? 'Evening' : 'Morning';
    const [from, to] = direction === 'evening' ? [workplaceName, homeNeighborhood] : [homeNeighborhood, workplaceName];
    if (!trip || !flag) {
      return {
        direction, label, from, to, available: false,
        departure: null, duration: null, distance: null,
        unavailableText: `Not available in the ${direction}`,
      };
    }
    return {
      direction, label, from, to, available: true,
      departure: formatClock(trip.departureMin),
      duration: formatDuration(trip.baselineDurationMin),
      distance: formatDistance(trip.baselineDistanceM),
      unavailableText: null,
    };
  };
  return {
    workplaceName,
    workplaceNeighborhood: work?.neighborhood ?? '',
    workplaceAddress: work?.address ?? '',
    homeNeighborhood,
    trips: [tripFor('evening'), tripFor('morning')],
    detourLimit: `Up to ${employee.maxExtraMin} min extra per trip`,
  };
}

const RELAY_KINDS: Stop['kind'][] = ['hub_drop', 'hub_pickup'];

export function deliveryRows(
  views: EmployeeJobView[], businesses: NetworkBusiness[], homeNeighborhood: string,
): DeliveryRow[] {
  const biz = businessById(businesses);
  const stopPlace = (stop: Stop) => {
    const name = biz(stop.placeId)?.name ?? UNKNOWN_PLACE;
    return RELAY_KINDS.includes(stop.kind) ? `Relay point: ${name}` : name;
  };
  const nbh = homeNeighborhood || 'home';
  return views.map(({ job, status, shipment, plan }) => {
    const isRelay = plan.kind === 'relay';
    // #916: who carries the package where, in the job view's words: the first carrier takes it to the
    // relay point, the second takes it from there.
    const relayLine = `Relay: you take it ${job.legIndex === 0 ? 'to' : 'from'} ${relayPointName(plan.relayBusinessId, businesses)}`;
    const morning = job.tripId.endsWith('-morn');
    const pickupTime = momentText(job.pickup.serviceStartMin);
    const pickupPlace = stopPlace(job.pickup);
    const dropoffTime = momentText(job.dropoff.serviceStartMin);
    const dropoffPlace = stopPlace(job.dropoff);
    return {
      jobId: job.id,
      packageLabel: shipment.label,
      status,
      statusLabel: STATUS_LABEL[status] ?? 'Assigned',
      pickup: `${pickupTime} · ${pickupPlace}`,
      dropoff: `${dropoffTime} · ${dropoffPlace}`,
      pickupTime, pickupPlace, dropoffTime, dropoffPlace,
      extraMin: extraTimeText(plan.legs[job.legIndex]?.extraMin),
      reward: formatCents(job.rewardCents),
      legKind: isRelay ? relayLine : 'Direct',
      commute: morning ? `Morning commute from ${nbh}` : `Evening commute to ${nbh}`,
      jobHref: `/employee/${encodeURIComponent(job.employeeId)}?job=${encodeURIComponent(job.id)}`,
      simulatorHref: simulatorHref(job.shipmentId),
      // The visible words come first, so voice control still finds the link by what is on screen.
      jobLinkLabel: `View job: ${shipment.label}`,
      simulatorLinkLabel: `Watch in simulator: ${shipment.label}`,
    };
  });
}

/** One sentence of the live region: the notification's ID (a stable key) and its message as sent. */
export type JobAnnouncement = { id: string; message: string };

/**
 * What the workspace's live region says (#633): the API's `job_assigned` sentence of every job that
 * carries the "New" tag, word for word and in the order of `dashboard.notifications`. Nothing is
 * composed here. `newJobIds` is empty on the first load and after a run change, and loses a job once
 * its tag is cleared (DECISIONS pass 9), so the region is empty in those cases too.
 */
export function newJobAnnouncements(
  dashboard: EmployeeDashboard, newJobIds: ReadonlySet<string> | readonly string[] | undefined,
): JobAnnouncement[] {
  if (!newJobIds) return [];
  const isNew = new Set<string>(newJobIds);
  if (isNew.size === 0) return [];
  return (dashboard.notifications ?? [])
    .filter((n) => n.kind === 'job_assigned' && n.jobId !== undefined && isNew.has(n.jobId)
      && typeof n.message === 'string' && n.message !== '')
    .map((n) => ({ id: n.id, message: n.message }));
}

export function earnings(dashboard: EmployeeDashboard): EarningsModel {
  return { earned: formatCents(dashboard.earnedCents), projected: formatCents(dashboard.projectedCents) };
}

/** "Back to start" is the simulator's control that returns a locked run to planning (#734, DECISIONS pass 74). */
export const LOCKED_TEXT = 'The run is playing, so commute edits are closed until you press Back to start in the simulator.';

// ---------- Empty lists (#882): what is missing, then why, then what brings one ----------

/** An empty list: a short title and one sentence of why. Rendered as one paragraph, title first. */
export type EmptyState = { title: string; why: string };

export const EMPTY_TITLE = 'No deliveries for you yet.';
export const EMPTY_WHY = 'A package shows up here when a business sends one that fits your commute and your detour limit.';
/** Both commutes are switched off in the saved commute: nothing can be matched until one is on. */
export const EMPTY_WHY_UNAVAILABLE = 'You are not available on either commute, so no package can be given to you. Turn one on in Edit commute.';
/** The assigned list's whole empty text, as one string. */
export const EMPTY_TEXT = `${EMPTY_TITLE} ${EMPTY_WHY}`;

export const COMPLETED_EMPTY: EmptyState = {
  title: 'No completed deliveries yet.',
  why: 'A delivery moves here once you have dropped the package off.',
};

/**
 * The assigned list's empty state. The reason is read from the saved commute (both trips off), never
 * worked out from a match: the page does not know why the matcher passed a carrier over.
 */
export function assignedEmpty(summary: Pick<CommuteSummaryModel, 'trips'>): EmptyState {
  const off = summary.trips.length > 0 && summary.trips.every((t) => !t.available);
  return { title: EMPTY_TITLE, why: off ? EMPTY_WHY_UNAVAILABLE : EMPTY_WHY };
}
