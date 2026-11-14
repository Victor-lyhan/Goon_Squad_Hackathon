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

export class ApiRequestError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string> | undefined;
  constructor(status: number, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiRequestError(0, e instanceof Error ? e.message : 'Network error');
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
    throw new ApiRequestError(res.status, message, fieldErrors);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

// Requests use z.input so schema defaults (e.g. pickupInstructions) may be omitted.
type CreateShipmentInput = z.input<typeof CreateShipmentRequest>;
type PutCommuteInput = z.input<typeof PutCommuteRequest>;
type GenerateScenarioInput = z.input<typeof GenerateScenarioRequest>;

export const getBusinesses = () => request<BusinessesResponse>('GET', '/api/businesses');
export const getBusinessDashboard = (id: string) =>
  request<BusinessDashboard>('GET', `/api/businesses/${enc(id)}/dashboard`);
export const createShipment = (req: CreateShipmentInput) =>
  request<ShipmentResponse>('POST', '/api/shipments', req);
export const getShipment = (id: string) => request<ShipmentResponse>('GET', `/api/shipments/${enc(id)}`);
export const patchShipment = (id: string, req: PatchShipmentRequest) =>
  request<ShipmentResponse>('PATCH', `/api/shipments/${enc(id)}`, req);
export const matchShipment = (id: string) =>
  request<ShipmentResponse>('POST', `/api/shipments/${enc(id)}/match`);
export const getEmployees = () => request<EmployeesResponse>('GET', '/api/employees');
export const getEmployeeDashboard = (id: string) =>
  request<EmployeeDashboard>('GET', `/api/employees/${enc(id)}/dashboard`);
export const putCommute = (id: string, req: PutCommuteInput) =>
  request<CommuteResponse>('PUT', `/api/employees/${enc(id)}/commute`, req);
export const getJob = (id: string) => request<JobResponse>('GET', `/api/jobs/${enc(id)}`);
export const getMap = () => request<MapResponse>('GET', '/api/map');
export const getSimulator = () => request<SimulatorResponse>('GET', '/api/simulator');
export const simulatorControl = (req: SimControlRequest) =>
  request<SimulatorResponse>('POST', '/api/simulator/control', req);
export const compareMatches = () => request<CompareResponse>('POST', '/api/matches/compare', {});
export const recomputeMatches = () => request<SimulatorResponse>('POST', '/api/matches/recompute');
export const resetPlanning = () => request<SimulatorResponse>('POST', '/api/planning/reset');
export const generateScenario = (req: GenerateScenarioInput) =>
  request<SimulatorResponse>('POST', '/api/scenario/generate', req);
export const exportScenario = () => request<Run>('GET', '/api/scenario/export');
export const importScenario = (run: Run) =>
  request<SimulatorResponse>('POST', '/api/scenario/import', run);
