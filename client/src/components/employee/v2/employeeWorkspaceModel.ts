// Pure display model for the MVP II Employee workspace (docs/mvp2-ui-redesign.md §2).
// Resolves names and formats API values; never computes statuses, earnings or travel times.
import type { EmployeeDashboard, EmployeeJobView } from '../../../../../shared/v2/api';
import type { JobStatus, NetworkBusiness, Stop, Trip } from '../../../../../shared/v2/types';
import { formatCents, formatClock, formatDuration } from '../../../ui/format';
import { momentText } from './jobDetailV2Model';

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
  /** "+7 min". */
  extraMin: string;
  /** "$8.00". */
  reward: string;
  /** "Direct", "Relay leg 1 of 2", "Relay leg 2 of 2". */
  legKind: string;
  /** "Evening commute to Astoria" / "Morning commute from Astoria". */
  commute: string;
  jobHref: string;
  simulatorHref: string;
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
    const legs = plan.legs.length;
    const isRelay = plan.kind === 'relay';
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
      extraMin: `+${plan.legs[job.legIndex]?.extraMin ?? 0} min`,
      reward: formatCents(job.rewardCents),
      legKind: isRelay ? `Relay leg ${job.legIndex + 1} of ${legs}` : 'Direct',
      commute: morning ? `Morning commute from ${nbh}` : `Evening commute to ${nbh}`,
      jobHref: `/employee/${encodeURIComponent(job.employeeId)}?job=${encodeURIComponent(job.id)}`,
      simulatorHref: `/simulator?package=${encodeURIComponent(job.shipmentId)}`,
    };
  });
}

export function earnings(dashboard: EmployeeDashboard): EarningsModel {
  return { earned: formatCents(dashboard.earnedCents), projected: formatCents(dashboard.projectedCents) };
}

export const LOCKED_TEXT = 'The run is playing. Commute edits need a new planning cycle.';
export const EMPTY_TEXT = 'No deliveries assigned yet. Packages that fit your commute appear here automatically.';
