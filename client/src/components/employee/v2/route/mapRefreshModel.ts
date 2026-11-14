// When the Employee page asks for GET /api/v2/map again within one run (#596). The loader already
// requests once per run, after a commute save and on Retry (DECISIONS pass 52). Two more cases:
//   1. the set of job IDs in the polled dashboard changed (a new delivery, a re-match, a new planning
//      cycle): the server's map now covers other plan legs;
//   2. the open job's leg has a place pair with no route line: a live delivery's lines are fetched
//      after its response (DECISIONS pass 47), so the page asks again about every 5 s until they are in.
// Pure: it only compares IDs of the two answers. No line, time or distance is made up here (pass 44).
import type { EmployeeDashboard, EmployeeJobView, MapResponse } from '../../../../../../shared/v2/api';

/** Wait between two map requests while the open job's leg has no line. */
export const MAP_LINE_RETRY_MS = 5000;

export type MapJobsKey = {
  /** Employee and run the jobs belong to. A change of either is the loader's business, not a refresh. */
  scope: string;
  /** The sorted job IDs, assigned and completed, so a job that completes does not count as a change. */
  jobs: string;
};

export function mapJobsKey(
  runId: string | null,
  dashboard: Pick<EmployeeDashboard, 'employee' | 'assigned' | 'completed'>,
): MapJobsKey {
  const ids = [...dashboard.assigned, ...dashboard.completed].map((v) => v.job.id);
  return {
    scope: JSON.stringify([dashboard.employee.id, runId]),
    jobs: JSON.stringify([...new Set(ids)].sort()),
  };
}

/**
 * True when the same employee in the same run has another set of jobs than at the last look. The first
 * dashboard, another employee and another run answer false: the loader requests the map for those itself.
 */
export function jobSetChanged(prev: MapJobsKey | null, next: MapJobsKey | null): boolean {
  return prev !== null && next !== null && prev.scope === next.scope && prev.jobs !== next.jobs;
}

/**
 * True when a neighbouring place pair of the job's own leg has no route line in the map: no entry
 * for the ordered pair, or an entry without a line. False without a job, a leg or a map.
 */
export function jobLegMissingLine(
  job: Pick<EmployeeJobView, 'job' | 'plan'> | null,
  map: Pick<MapResponse, 'polylines'> | null,
): boolean {
  if (!job || !map) return false;
  const ids = job.plan.legs[job.job.legIndex]?.placeIds ?? [];
  if (ids.length < 2) return false;
  const drawn = new Set<string>();
  for (const p of map.polylines) if (p.encoded) drawn.add(`${p.from}\u0000${p.to}`);
  for (let i = 0; i + 1 < ids.length; i++) {
    if (!drawn.has(`${ids[i]}\u0000${ids[i + 1]}`)) return true;
  }
  return false;
}

export type LineRetryInput = {
  /** The open `?job=` job when it is this employee's, else null (a closed job stops the timer). */
  job: Pick<EmployeeJobView, 'job' | 'plan'> | null;
  map: Pick<MapResponse, 'polylines'> | null;
  /** The loader's status: nothing is asked while a request is open or the travel data is missing. */
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';
  /** The 1 s dashboard poll is failing: the map waits for it to come back. */
  reconnecting: boolean;
};

/** Whether the slow timer runs: an open job, a leg without a line, and a map answer to wait after. */
export function lineRetryDue({ job, map, status, reconnecting }: LineRetryInput): boolean {
  if (reconnecting || (status !== 'ready' && status !== 'failed')) return false;
  return jobLegMissingLine(job, map);
}

/**
 * How long to wait before asking again, given the time since the last map answer. A map that is
 * already older than the retry gap (a job opened long after the map came in) is asked for at once.
 */
export function lineRetryDelayMs(sinceLastAnswerMs: number): number {
  if (!Number.isFinite(sinceLastAnswerMs) || sinceLastAnswerMs <= 0) return MAP_LINE_RETRY_MS;
  return Math.max(0, MAP_LINE_RETRY_MS - sinceLastAnswerMs);
}
