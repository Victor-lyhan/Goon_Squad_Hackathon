// Typed fetch helpers: the only way UI code calls the backend.
// Plain TS + fetch only (no JSX / DOM-only APIs / import.meta.env) so Node tests can typecheck it.
import type { z } from 'zod';
import type { Run } from '../../../shared/types';
import type {
  BusinessesResponse, BusinessDashboard, ShipmentResponse, EmployeesResponse,
  EmployeeDashboard, CommuteResponse, JobResponse, MapResponse, SimulatorResponse,
  CompareResponse,
} from '../../../shared/api';
import type {
  CreateShipmentRequest, PatchShipmentRequest, PutCommuteRequest,
  SimControlRequest, GenerateScenarioRequest,
} from '../../../shared/schemas';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'abort';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string> | undefined;
  /** 'http' for server replies; status 0 errors are 'network', 'timeout' or 'abort'. */
  readonly kind: ApiErrorKind;
  constructor(status: number, message: string, fieldErrors?: Record<string, string>, kind?: ApiErrorKind) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.kind = kind ?? (status === 0 ? 'network' : 'http');
  }
}

// Note: the helpers are named function expressions with a capital letter because
// tests/api/client-routes.test.ts treats every lowercase-named exported function as an endpoint.
/** True when the request never got an HTTP answer (fetch failure or timeout), not when the caller aborted. */
export const isNetworkError = function IsNetworkError(e: unknown): boolean {
  return e instanceof ApiRequestError && e.status === 0 && e.kind !== 'abort';
};
/** True when the caller aborted the request through its own signal. */
export const isAbortError = function IsAbortError(e: unknown): boolean {
  return e instanceof ApiRequestError && e.kind === 'abort';
};

export interface RequestOptions {
  /** Abort the request; rejects with an abort error (see isAbortError). */
  signal?: AbortSignal;
  /** Per-call timeout in ms; defaults to the value from apiConfig.timeoutMs (8000). */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 8000;
/** Mutable settings; tests set `apiConfig.timeoutMs` and restore DEFAULT_TIMEOUT_MS afterwards. */
export const apiConfig = { timeoutMs: DEFAULT_TIMEOUT_MS };

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {},
  extra: { cache?: RequestCache; ignoreBody?: boolean } = {}): Promise<T> {
  const { signal } = opts;
  const timeoutMs = opts.timeoutMs ?? apiConfig.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const fail = (e: unknown): never => {
    if (e instanceof ApiRequestError) throw e;
    if (timedOut) throw new ApiRequestError(0, `Request timed out after ${timeoutMs} ms`, undefined, 'timeout');
    if (signal?.aborted) throw new ApiRequestError(0, 'Request aborted', undefined, 'abort');
    throw new ApiRequestError(0, e instanceof Error ? e.message : 'Network error', undefined, 'network');
  };
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: extra.cache,
      });
    } catch (e) {
      return fail(e);
    }
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      let fieldErrors: Record<string, string> | undefined;
      try {
        const data = (await res.json()) as { error?: unknown; fieldErrors?: Record<string, string> };
        if (typeof data?.error === 'string') message = data.error;
        fieldErrors = data?.fieldErrors;
      } catch {
        /* non-JSON error body: keep the default message */
      }
      if (timedOut) return fail(new Error('timeout'));
      if (signal?.aborted) return fail(new Error('aborted'));
      throw new ApiRequestError(res.status, message, fieldErrors);
    }
    try {
      if (extra.ignoreBody) { await res.arrayBuffer(); return undefined as T; }
      return (await res.json()) as T;
    } catch (e) {
      return fail(e);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Server liveness probe: GET /api/health with cache 'no-store' and the same timeout/signal handling
 * as the other GETs. Resolves true on a 2xx and false on a network error, timeout or non-2xx.
 * Never throws, except that a caller abort (opts.signal) rejects with an error for which isAbortError is true.
 * Capitalised function expression: /api/health is not in shared/api.ts, see the note above.
 */
export const probeHealth = async function ProbeHealth(opts?: RequestOptions): Promise<boolean> {
  try {
    await request<void>('GET', '/api/health', undefined, opts, { cache: 'no-store', ignoreBody: true });
    return true;
  } catch (e) {
    if (isAbortError(e)) throw e;
    return false;
  }
};

const enc = encodeURIComponent;

// Requests use z.input so schema defaults (e.g. pickupInstructions) may be omitted.
type CreateShipmentInput = z.input<typeof CreateShipmentRequest>;
type PutCommuteInput = z.input<typeof PutCommuteRequest>;
type GenerateScenarioInput = z.input<typeof GenerateScenarioRequest>;

export const getBusinesses = (opts?: RequestOptions) =>
  request<BusinessesResponse>('GET', '/api/businesses', undefined, opts);
export const getBusinessDashboard = (id: string, opts?: RequestOptions) =>
  request<BusinessDashboard>('GET', `/api/businesses/${enc(id)}/dashboard`, undefined, opts);
export const createShipment = (req: CreateShipmentInput) =>
  request<ShipmentResponse>('POST', '/api/shipments', req);
export const getShipment = (id: string, opts?: RequestOptions) =>
  request<ShipmentResponse>('GET', `/api/shipments/${enc(id)}`, undefined, opts);
export const patchShipment = (id: string, req: PatchShipmentRequest) =>
  request<ShipmentResponse>('PATCH', `/api/shipments/${enc(id)}`, req);
export const matchShipment = (id: string) =>
  request<ShipmentResponse>('POST', `/api/shipments/${enc(id)}/match`);
export const getEmployees = (opts?: RequestOptions) =>
  request<EmployeesResponse>('GET', '/api/employees', undefined, opts);
export const getEmployeeDashboard = (id: string, opts?: RequestOptions) =>
  request<EmployeeDashboard>('GET', `/api/employees/${enc(id)}/dashboard`, undefined, opts);
export const putCommute = (id: string, req: PutCommuteInput) =>
  request<CommuteResponse>('PUT', `/api/employees/${enc(id)}/commute`, req);
export const getJob = (id: string, opts?: RequestOptions) =>
  request<JobResponse>('GET', `/api/jobs/${enc(id)}`, undefined, opts);
export const getMap = (opts?: RequestOptions) => request<MapResponse>('GET', '/api/map', undefined, opts);
export const getSimulator = (opts?: RequestOptions) =>
  request<SimulatorResponse>('GET', '/api/simulator', undefined, opts);
export const simulatorControl = (req: SimControlRequest) =>
  request<SimulatorResponse>('POST', '/api/simulator/control', req);
export const compareMatches = () => request<CompareResponse>('POST', '/api/matches/compare', {});
export const recomputeMatches = () => request<SimulatorResponse>('POST', '/api/matches/recompute');
export const resetPlanning = () => request<SimulatorResponse>('POST', '/api/planning/reset');
export const generateScenario = (req: GenerateScenarioInput) =>
  request<SimulatorResponse>('POST', '/api/scenario/generate', req);
export const exportScenario = (opts?: RequestOptions) =>
  request<Run>('GET', '/api/scenario/export', undefined, opts);
export const importScenario = (run: Run) =>
  request<SimulatorResponse>('POST', '/api/scenario/import', run);
