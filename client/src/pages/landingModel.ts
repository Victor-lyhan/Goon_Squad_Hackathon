// Pure helpers for the homepage's NYC data source (dataset="nyc"). Plain TS so Node tests can run them.
// Every number comes from an /api/v2 response; nothing is counted from deliveries in the browser.
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../../shared/v2/api';
import { ENV_LABELS, previewHrefs } from '../ui/shellModel';
import {
  getBusinesses, getEmployees, getSimulator, isAbortError, isTravelUnavailable, type RequestOptions,
} from '../api/v2';

export type LandingDataset = 'synthetic' | 'nyc';

/** Footer and indicator text for the NYC variant (the label must describe the data on screen, pass 44). */
export const NYC_ENV_TEXT = ENV_LABELS.nyc;
/** The one line shown instead of numbers when /api/v2 answers 503 (same copy as the v2 workspaces, pass 46). */
export const NYC_UNAVAILABLE_TEXT = 'NYC travel data is not loaded on this server yet.';

export type NycSummary =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | {
    status: 'ready'; businesses: number; commuters: number; relayPoints: number;
    matched: number; requested: number; firstEmployeeId: string | undefined;
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
    firstEmployeeId: e.employees[0]?.id,
  };
}

/** A failed load: 503 TravelUnavailable gets its own one-line state; anything else is a plain error. */
export function nycSummaryFromError(err: unknown): NycSummary {
  return isTravelUnavailable(err) ? { status: 'unavailable' } : { status: 'error' };
}

/** Workspace links for the NYC variant: the /nyc preview paths (Business is pending until it has one). */
export function nycWorkspacePaths(summary: NycSummary) {
  return previewHrefs(summary.status === 'ready' ? summary.firstEmployeeId : undefined);
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
