import type { CommuteResponse, EmployeeDashboard, EmployeeJobView } from '../../../../shared/api';
import type { JobStatus, Notification } from '../../../../shared/types';

export const POLL_MS = 1000;

export type PortalView = 'loading' | 'error' | 'empty' | 'ready';

/** Which state the page shows. Errors only win while there is nothing to show yet. */
export function portalView(dash: EmployeeDashboard | null, error: string | null): PortalView {
  if (!dash) return error ? 'error' : 'loading';
  return dash.assigned.length + dash.completed.length === 0 ? 'empty' : 'ready';
}

/** Message after a successful commute save. */
export function saveMessage(res: Pick<CommuteResponse, 'rematchedShipmentIds'>): string {
  const n = res.rematchedShipmentIds.length;
  const base = 'Saved. Your commute is available for matching';
  if (n === 0) return base;
  return `${base}. ${n} waiting ${n === 1 ? 'package' : 'packages'} matched`;
}

/** Message for a failed save: API message for 409, generic otherwise. */
export function saveErrorMessage(status: number, message: string): string {
  return status === 409 ? message : status === 400 ? 'Please fix the highlighted fields.' : message;
}

/** job_assigned notifications not seen before. First poll (seen === null) seeds silently. */
export function newJobNotifications(seen: ReadonlySet<string> | null, notifications: Notification[]): Notification[] {
  if (seen === null) return [];
  return notifications.filter((n) => n.kind === 'job_assigned' && !seen.has(n.id));
}

export const NEW_JOB_TOAST = 'New delivery job';

/** Map is static per run; refetch when the version drops (state reset/import) or none is loaded. */
export function needsMapRefetch(prevVersion: number | null, nextVersion: number, haveMap: boolean): boolean {
  return !haveMap || (prevVersion !== null && nextVersion < prevVersion);
}

export function welcomeTitle(name: string): string {
  return `Welcome, ${name}`;
}

export type FeedGroup = { status: JobStatus; heading: string; views: EmployeeJobView[] };

const GROUP_HEADING: Record<JobStatus, string> = { in_progress: 'In progress', assigned: 'Upcoming', completed: 'Completed' };
const GROUP_ORDER: JobStatus[] = ['in_progress', 'assigned', 'completed'];

/**
 * Groups the feed by the API job status (no status is computed here) and orders each group by
 * the trip's departure, then pickup time and job id. Empty groups are omitted.
 */
export function feedGroups(dash: Pick<EmployeeDashboard, 'assigned' | 'completed' | 'trips'>): FeedGroup[] {
  const depart = (v: EmployeeJobView) => dash.trips.find((t) => t.id === v.job.tripId)?.departureMin ?? v.job.pickup.serviceStartMin;
  const all = [...dash.assigned, ...dash.completed];
  return GROUP_ORDER.map((status) => ({
    status,
    views: all.filter((v) => v.status === status).sort((a, b) =>
      depart(a) - depart(b) || a.job.pickup.serviceStartMin - b.job.pickup.serviceStartMin || a.job.id.localeCompare(b.job.id)),
  })).filter((g) => g.views.length > 0)
    .map((g) => ({ ...g, heading: `${GROUP_HEADING[g.status]} (${g.views.length})` }));
}
