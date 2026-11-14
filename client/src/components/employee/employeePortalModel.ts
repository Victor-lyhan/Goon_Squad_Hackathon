import type { CommuteResponse, EmployeeDashboard } from '../../../../shared/api';
import type { Notification } from '../../../../shared/types';

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
