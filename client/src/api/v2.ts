// Typed fetch helpers for the MVP II routes under /api/v2 (route list: shared/v2/api.ts).
// UI code imports them from 'client/src/api/v2' (not from the index). Timeout, abort and error behaviour
// come from the one `request` wrapper in ./http.
// Plain TS + fetch only (no JSX / DOM-only APIs / import.meta.env) so Node tests can typecheck it.
import type { z } from 'zod';
import type { Run } from '../../../shared/v2/types';
import type {
  BusinessesResponse, BusinessDashboard, ShipmentResponse, EmployeesResponse,
  EmployeeDashboard, CommuteResponse, JobResponse, MapResponse, SimulatorResponse,
  CompareResponse, ExportFile, GeocodeResponse, TravelUnavailable,
} from '../../../shared/v2/api';
import type {
  CreateShipmentRequest, PatchShipmentRequest, PutCommuteRequest,
  SimControlRequest, GenerateScenarioRequest,
} from '../../../shared/v2/schemas';
import { ApiRequestError, request, type RequestOptions } from './http';

// Re-exported so a v2 page needs one import for helpers and error handling.
export {
  ApiRequestError, isNetworkError, isAbortError, probeHealth, apiConfig, DEFAULT_TIMEOUT_MS,
} from './http';
export type { ApiErrorKind, RequestOptions } from './http';

export const API_V2_PREFIX = '/api/v2';

export type TravelUnavailableCode = TravelUnavailable['code'];
/** A 503 whose body was a TravelUnavailable: `message` is the server's `error` text. */
export type TravelUnavailableError = ApiRequestError & { status: 503; code: TravelUnavailableCode };

const TRAVEL_CODES: readonly string[] =
  ['google_key_missing', 'travel_data_missing', 'google_unavailable'] satisfies TravelUnavailableCode[];

// Capitalised function expression, like isNetworkError: the route-coverage tests treat every
// lowercase-named exported function as an endpoint helper.
/** True for a 503 TravelUnavailable reply; narrows `e.code` to the three contract codes. */
export const isTravelUnavailable = function IsTravelUnavailable(e: unknown): e is TravelUnavailableError {
  return e instanceof ApiRequestError && e.status === 503 && e.code !== undefined && TRAVEL_CODES.includes(e.code);
};

const enc = encodeURIComponent;
const v2 = (path: string) => `${API_V2_PREFIX}${path}`;

// Requests use z.input so schema defaults (e.g. pickupInstructions, seed) may be omitted.
type CreateShipmentInput = z.input<typeof CreateShipmentRequest>;
type PutCommuteInput = z.input<typeof PutCommuteRequest>;
type GenerateScenarioInput = z.input<typeof GenerateScenarioRequest>;

// Every helper takes RequestOptions (signal, timeoutMs) as its last argument, the writes too,
// because PUT commute may wait on a live Google call.
export const getBusinesses = (opts?: RequestOptions) =>
  request<BusinessesResponse>('GET', v2('/businesses'), undefined, opts);
export const getBusinessDashboard = (id: string, opts?: RequestOptions) =>
  request<BusinessDashboard>('GET', v2(`/businesses/${enc(id)}/dashboard`), undefined, opts);
export const createShipment = (req: CreateShipmentInput, opts?: RequestOptions) =>
  request<ShipmentResponse>('POST', v2('/shipments'), req, opts);
export const getShipment = (id: string, opts?: RequestOptions) =>
  request<ShipmentResponse>('GET', v2(`/shipments/${enc(id)}`), undefined, opts);
export const patchShipment = (id: string, req: PatchShipmentRequest, opts?: RequestOptions) =>
  request<ShipmentResponse>('PATCH', v2(`/shipments/${enc(id)}`), req, opts);
export const matchShipment = (id: string, opts?: RequestOptions) =>
  request<ShipmentResponse>('POST', v2(`/shipments/${enc(id)}/match`), undefined, opts);
export const getEmployees = (opts?: RequestOptions) =>
  request<EmployeesResponse>('GET', v2('/employees'), undefined, opts);
export const getEmployeeDashboard = (id: string, opts?: RequestOptions) =>
  request<EmployeeDashboard>('GET', v2(`/employees/${enc(id)}/dashboard`), undefined, opts);
/** `req.home` is `{ homeId }` or `{ lat, lng, neighborhood }`. A new home may reject with a TravelUnavailable 503. */
export const putCommute = (id: string, req: PutCommuteInput, opts?: RequestOptions) =>
  request<CommuteResponse>('PUT', v2(`/employees/${enc(id)}/commute`), req, opts);
export const getJob = (id: string, opts?: RequestOptions) =>
  request<JobResponse>('GET', v2(`/jobs/${enc(id)}`), undefined, opts);
export const getMap = (opts?: RequestOptions) =>
  request<MapResponse>('GET', v2('/map'), undefined, opts);
export const getSimulator = (opts?: RequestOptions) =>
  request<SimulatorResponse>('GET', v2('/simulator'), undefined, opts);
export const simulatorControl = (req: SimControlRequest, opts?: RequestOptions) =>
  request<SimulatorResponse>('POST', v2('/simulator/control'), req, opts);
export const compareMatches = (opts?: RequestOptions) =>
  request<CompareResponse>('POST', v2('/matches/compare'), {}, opts);
export const recomputeMatches = (opts?: RequestOptions) =>
  request<SimulatorResponse>('POST', v2('/matches/recompute'), undefined, opts);
export const resetPlanning = (opts?: RequestOptions) =>
  request<SimulatorResponse>('POST', v2('/planning/reset'), undefined, opts);
/** v2 request: no `hubs`. */
export const generateScenario = (req: GenerateScenarioInput, opts?: RequestOptions) =>
  request<SimulatorResponse>('POST', v2('/scenario/generate'), req, opts);
export const exportScenario = (opts?: RequestOptions) =>
  request<ExportFile>('GET', v2('/scenario/export'), undefined, opts);
export const importScenario = (run: Run, opts?: RequestOptions) =>
  request<SimulatorResponse>('POST', v2('/scenario/import'), run, opts);
/**
 * Address search for the commute editor. The query is sent URL-encoded as typed (the server trims and
 * validates it, see GeocodeQuery). Pass a signal and abort the previous search on every keystroke:
 * an abort rejects with an error for which isAbortError is true. No server key gives a TravelUnavailable 503.
 */
export const geocode = (q: string, opts?: RequestOptions) =>
  request<GeocodeResponse>('GET', v2(`/geocode?q=${enc(q)}`), undefined, opts);
