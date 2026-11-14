import type { EmployeeDashboard, EmployeeJobView } from '../../../../shared/api';
import type { Notification } from '../../../../shared/types';

/** How long a job keeps its "New" badge if the user never opens it. */
export const NEW_BADGE_MS = 60_000;

/** Job IDs in the dashboard that were not in the previous poll. First load (null) counts nothing as new. */
export function diffNewJobs(prevJobIds: ReadonlySet<string> | null, nextDashboard: EmployeeDashboard): string[] {
  if (prevJobIds === null) return [];
  return nextDashboard.assigned.filter((v) => !prevJobIds.has(v.job.id)).map((v) => v.job.id);
}

export function dashboardJobIds(d: EmployeeDashboard): Set<string> {
  return new Set([...d.assigned, ...d.completed].map((v) => v.job.id));
}

export type JobBaseline = { runId: string | null; version: number; ids: ReadonlySet<string> };

/**
 * One poll step. The baseline resets (nothing new) when the run changes or the
 * state version goes backwards (reset/import), so a new city doesn't flag every job.
 */
export function stepBaseline(
  prev: JobBaseline | null, runId: string | null, d: EmployeeDashboard,
): { baseline: JobBaseline; newIds: string[] } {
  const reset = prev !== null && ((prev.runId !== null && runId !== null && prev.runId !== runId) || d.version < prev.version);
  const base = reset ? null : prev ? prev.ids : null;
  return {
    baseline: { runId: runId ?? prev?.runId ?? null, version: d.version, ids: dashboardJobIds(d) },
    newIds: diffNewJobs(base, d),
  };
}

/** Arrival times (ms) by job ID. */
export type Arrivals = Readonly<Record<string, number>>;

/** Add new arrivals, drop expired ones and jobs no longer on the dashboard. */
export function nextArrivals(prev: Arrivals, newIds: string[], d: EmployeeDashboard, nowMs: number): Arrivals {
  const live = dashboardJobIds(d);
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(prev)) if (live.has(id) && nowMs - at < NEW_BADGE_MS) out[id] = at;
  for (const id of newIds) out[id] = nowMs;
  return out;
}

export function toastText(packageName: string): string {
  return `New delivery job: ${packageName}`;
}

export type JobArrival = { jobId: string; packageName: string };

export function arrivalsFor(d: EmployeeDashboard, newIds: string[]): JobArrival[] {
  const byId = new Map<string, EmployeeJobView>([...d.assigned, ...d.completed].map((v) => [v.job.id, v]));
  return newIds.flatMap((id) => { const v = byId.get(id); return v ? [{ jobId: id, packageName: v.shipment.label }] : []; });
}

/** job_assigned notifications, newest first. */
export function jobNotifications(notifications: Notification[]): Notification[] {
  return notifications.filter((n) => n.kind === 'job_assigned').sort((a, b) => b.createdSeq - a.createdSeq);
}
