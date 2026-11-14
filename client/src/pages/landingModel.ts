// Pure helpers for the homepage's data source, the NYC run. Plain TS so Node tests can run them.
// Every number comes from an /api/v2 response; nothing is counted from deliveries in the browser.
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../../shared/v2/api';
import type { DemoIdentity } from '../demoIdentity';
import { ENV_LABELS, pickAccount, workspaceHrefs } from '../ui/shellModel';
import {
  getBusinesses, getEmployees, getSimulator, isAbortError, isTravelUnavailable, type RequestOptions,
} from '../api/v2';

/** Footer and indicator text (the label must describe the data on screen, pass 44). */
export const NYC_ENV_TEXT = ENV_LABELS.nyc;
/** The one line shown instead of numbers when /api/v2 answers 503 (same copy as the v2 workspaces, pass 46). */
export const NYC_UNAVAILABLE_TEXT = 'NYC travel data is not loaded on this server yet.';

export type NycSummary =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | {
    status: 'ready'; businesses: number; commuters: number; relayPoints: number;
    matched: number; requested: number;
    /** The account IDs, in API order, for the workspace links (never counted or shown). */
    businessIds: string[]; employeeIds: string[];
  };

/** Relay points = network businesses: every network business is one (SPEC MVP II data model). */
export function nycSummaryFrom(b: BusinessesResponse, e: EmployeesResponse, sim: SimulatorResponse): NycSummary {
  return {
    status: 'ready',
    businesses: b.businesses.length,
    commuters: e.employees.length,
    relayPoints: b.businesses.length,
    matched: sim.snapshot.metrics.matched,
    requested: sim.snapshot.metrics.requested,
    businessIds: b.businesses.map((x) => x.id),
    employeeIds: e.employees.map((x) => x.id),
  };
}

/** A failed load: 503 TravelUnavailable gets its own one-line state; anything else is a plain error. */
export function nycSummaryFromError(err: unknown): NycSummary {
  return isTravelUnavailable(err) ? { status: 'unavailable' } : { status: 'error' };
}

/**
 * Workspace links for the homepage: the main paths (#548). The stored demo identity is used when it is in
 * the NYC lists, else the first account; a link is pending until the lists are loaded.
 */
export function nycWorkspacePaths(summary: NycSummary, stored: DemoIdentity = {}) {
  const ready = summary.status === 'ready' ? summary : null;
  return workspaceHrefs(pickAccount(stored.businessId, ready?.businessIds), pickAccount(stored.employeeId, ready?.employeeIds));
}

type V2Reads = {
  getBusinesses: (o?: RequestOptions) => Promise<BusinessesResponse>;
  getEmployees: (o?: RequestOptions) => Promise<EmployeesResponse>;
  getSimulator: (o?: RequestOptions) => Promise<SimulatorResponse>;
};
const realReads: V2Reads = { getBusinesses, getEmployees, getSimulator };

/**
 * Load the NYC summary once from /api/v2 and report it through `onSummary`. Returns the cleanup that aborts
 * the three requests (call it on unmount); after it, `onSummary` is never called.
 */
export function startNycSummary(onSummary: (s: NycSummary) => void, api: V2Reads = realReads): () => void {
  const ctl = new AbortController();
  const opts = { signal: ctl.signal };
  Promise.all([api.getBusinesses(opts), api.getEmployees(opts), api.getSimulator(opts)])
    .then(([b, e, sim]) => { if (!ctl.signal.aborted) onSummary(nycSummaryFrom(b, e, sim)); })
    .catch((err) => { if (!ctl.signal.aborted && !isAbortError(err)) onSummary(nycSummaryFromError(err)); });
  return () => ctl.abort();
}
