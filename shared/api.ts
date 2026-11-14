// Relay API response contracts. HUMAN-OWNED. Agents: do not edit; write BLOCKED.md instead.
// All paths are relative (/api/...). Errors: 4xx with ApiError body (shared/schemas.ts).
import type {
  Business, Hub, Employee, Trip, Shipment, DeliveryPlan, Job, Notification,
  ShipmentProgress, JobStatus, Snapshot, Run, Graph, Clock, AssignmentResult, Metrics,
} from './types';

export type ShipmentView = {
  shipment: Shipment;
  plan: DeliveryPlan | null;
  jobIds: string[];
  status: ShipmentProgress;          // from current snapshot
  deliveredAtMin: number | null;
  unmatchedReason: string | null;
};

// GET /api/businesses
export type BusinessesResponse = { businesses: Business[]; hubs: Hub[] };

// GET /api/businesses/:id/dashboard
export type BusinessDashboard = {
  business: Business;
  outgoing: ShipmentView[]; incoming: ShipmentView[];
  notifications: Notification[];
  totals: { sent: number; matched: number; delivered: number; spendCents: number };
  phase: Clock['phase']; version: number;
};

// POST /api/shipments  (201 new, 200 if clientRequestId already seen)
// PATCH /api/shipments/:id, POST /api/shipments/:id/match, GET /api/shipments/:id
export type ShipmentResponse = ShipmentView & { matched: boolean };

// GET /api/employees  (for demo account selector)
export type EmployeesResponse = { employees: Employee[] };

// GET /api/employees/:id/dashboard
export type EmployeeJobView = { job: Job; status: JobStatus; shipment: Shipment; plan: DeliveryPlan };
export type EmployeeDashboard = {
  employee: Employee; trips: Trip[];
  assigned: EmployeeJobView[]; completed: EmployeeJobView[];
  earnedCents: number; projectedCents: number;
  notifications: Notification[];
  phase: Clock['phase']; version: number;
};

// PUT /api/employees/:id/commute
export type CommuteResponse = {
  employee: Employee; trips: Trip[];
  rematchedShipmentIds: string[]; // unmatched requests that got matched by this save
};

// GET /api/jobs/:id
export type JobResponse = EmployeeJobView & { trip: Trip };

// GET /api/map   (static per run; fetch once per runId)
export type MapResponse = { runId: string; graph: Graph; businesses: Business[]; hubs: Hub[]; homes: { employeeId: string; nodeId: string }[] };

// GET /api/simulator   (poll every 1 s)
export type SimulatorResponse = {
  runId: string; version: number; clock: Clock;
  snapshot: Snapshot;
  plans: DeliveryPlan[]; jobs: Job[]; shipments: Shipment[];
  unmatched: AssignmentResult['unmatched'];
  computeMs: number;
  nextEventMin: number | null;
};

// POST /api/simulator/control -> SimulatorResponse

// POST /api/matches/compare (does NOT modify live state)
export type CompareResponse = {
  directOnly: { result: AssignmentResult; metrics: Metrics };
  withRelay: { result: AssignmentResult; metrics: Metrics };
};

// POST /api/matches/recompute, POST /api/planning/reset, POST /api/scenario/generate -> SimulatorResponse
// GET /api/scenario/export -> Run ; POST /api/scenario/import (body: Run) -> SimulatorResponse
export type ExportFile = Run;
