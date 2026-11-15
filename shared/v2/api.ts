// Relay MVP II API response contracts. HUMAN-OWNED. Agents: do not edit; write BLOCKED.md instead.
// Errors: 4xx with ApiError body (shared/v2/schemas.ts); 503 with TravelUnavailable body.
//
// Routes: the same paths as MVP 1 (shared/api.ts) under the prefix /api/v2, plus geocode.
//   GET   /api/v2/businesses                    -> BusinessesResponse
//   GET   /api/v2/businesses/:id/dashboard      -> BusinessDashboard
//   POST  /api/v2/shipments                     -> ShipmentResponse (201 new, 200 if clientRequestId already seen)
//   GET   /api/v2/shipments/:id                 -> ShipmentResponse
//   PATCH /api/v2/shipments/:id                 -> ShipmentResponse
//   POST  /api/v2/shipments/:id/match           -> ShipmentResponse
//   GET   /api/v2/employees                     -> EmployeesResponse
//   GET   /api/v2/employees/:id/dashboard       -> EmployeeDashboard
//   PUT   /api/v2/employees/:id/commute         -> CommuteResponse (may call Google live for a new home; 503 TravelUnavailable)
//   GET   /api/v2/jobs/:id                      -> JobResponse
//   GET   /api/v2/map                           -> MapResponse
//   GET   /api/v2/simulator                     -> SimulatorResponse (poll every 1 s)
//   POST  /api/v2/simulator/control             -> SimulatorResponse
//   POST  /api/v2/matches/compare               -> CompareResponse (does NOT modify live state)
//   POST  /api/v2/matches/recompute             -> SimulatorResponse
//   POST  /api/v2/planning/reset                -> SimulatorResponse
//   POST  /api/v2/scenario/generate             -> SimulatorResponse
//   GET   /api/v2/scenario/export               -> ExportFile
//   POST  /api/v2/scenario/import (body: Run)   -> SimulatorResponse
//   GET   /api/v2/geocode?q=                    -> GeocodeResponse (503 TravelUnavailable without a server key)
//   POST  /api/v2/advise (body: AdviseRequest)  -> AdviseResponse (reads the run, never changes it; #862)
import type { ParseDraft } from './parseRequest';
import type {
  NetworkBusiness, Home, Employee, Trip, Shipment, DeliveryPlan, Job, Notification,
  ShipmentProgress, JobStatus, Snapshot, Run, Clock, AssignmentResult, Metrics,
} from './types';

export type ShipmentView = {
  shipment: Shipment;
  plan: DeliveryPlan | null;
  jobIds: string[];
  status: ShipmentProgress;          // from current snapshot
  deliveredAtMin: number | null;
  unmatchedReason: string | null;
};

// GET /api/v2/businesses   (no hubs: every business is a relay point)
export type BusinessesResponse = { businesses: NetworkBusiness[] };

// GET /api/v2/businesses/:id/dashboard
export type BusinessDashboard = {
  business: NetworkBusiness;
  outgoing: ShipmentView[]; incoming: ShipmentView[];
  notifications: Notification[];
  totals: { sent: number; matched: number; delivered: number; spendCents: number };
  phase: Clock['phase']; version: number;
};

// POST /api/v2/shipments, PATCH /api/v2/shipments/:id, POST /api/v2/shipments/:id/match, GET /api/v2/shipments/:id
export type ShipmentResponse = ShipmentView & { matched: boolean };

// GET /api/v2/employees  (for demo account selector)
export type EmployeesResponse = { employees: Employee[] };

// GET /api/v2/employees/:id/dashboard
export type EmployeeJobView = {
  job: Job; status: JobStatus; shipment: Shipment; plan: DeliveryPlan;
  // How many of this job's leg stops (`plan.legs[job.legIndex].stops`, in order) are done: their
  // `serviceEndMin` is at or before the simulation minute (#781). The page marks stop `i` done when
  // `i < stopsDone`. The server always sends it; optional in the type only for samples written before it existed.
  stopsDone?: number;
  // True once the job's commute has left: the simulation minute is at or past its trip's `departureMin` (#791). Optional like `stopsDone`.
  departed?: boolean;
  // True once the job's commute has arrived (home in the evening, at work in the morning): the simulation minute is at or
  // past its leg's `finishMin` (#836). Later than `status: 'completed'` when the leg goes on after its last stop. Optional like `departed`.
  arrived?: boolean;
};
export type EmployeeDashboard = {
  employee: Employee; home: Home; trips: Trip[];
  assigned: EmployeeJobView[]; completed: EmployeeJobView[];
  earnedCents: number; projectedCents: number;
  notifications: Notification[];
  phase: Clock['phase']; version: number;
};

// PUT /api/v2/employees/:id/commute
export type CommuteResponse = {
  employee: Employee; home: Home; trips: Trip[];
  rematchedShipmentIds: string[]; // unmatched requests that got matched by this save
};

// GET /api/v2/jobs/:id
export type JobResponse = EmployeeJobView & { trip: Trip };

// One ordered place pair's route line. `encoded` = Google encoded polyline (precision 5); null if not cached.
export type RoutePolyline = { from: string; to: string; encoded: string | null };

// GET /api/v2/map
// Polylines cover every baseline commute and every neighbouring place pair of the current plans' legs.
// The UI refetches it when `runId` or the set of plan IDs changes.
export type MapResponse = {
  runId: string;
  businesses: NetworkBusiness[];
  homes: Home[];
  employees: Pick<Employee, 'id' | 'name' | 'businessId' | 'homeId'>[];
  polylines: RoutePolyline[];
};

// GET /api/v2/simulator   (poll every 1 s); POST /api/v2/simulator/control
export type SimulatorResponse = {
  runId: string; version: number; clock: Clock;
  snapshot: Snapshot;
  plans: DeliveryPlan[]; jobs: Job[]; shipments: Shipment[];
  unmatched: AssignmentResult['unmatched'];
  computeMs: number;
  nextEventMin: number | null;
  // The trips of the employees who drive a plan leg (the trips whose `id` is some `Leg.tripId`), in
  // `Run.trips` order: a journey plays each carrier's whole commute from `departureMin` (#761).
  // The server always sends it; optional in the type only for samples written before it existed.
  trips?: Trip[];
};

// POST /api/v2/matches/compare (does NOT modify live state)
export type CompareResponse = {
  directOnly: { result: AssignmentResult; metrics: Metrics };
  withRelay: { result: AssignmentResult; metrics: Metrics };
};

// GET /api/v2/scenario/export -> Run ; POST /api/v2/scenario/import (body: Run)
export type ExportFile = Run;

// GET /api/v2/geocode?q=   (address search in the commute editor)
// `label` is only shown in the search list, never stored.
export type GeocodeResponse = { results: { label: string; neighborhood: string; lat: number; lng: number }[] };

// Body of a 503: Google key missing, travel data missing for a pair, or Google itself failing.
export type TravelUnavailable = {
  error: string;
  code: 'google_key_missing' | 'travel_data_missing' | 'google_unavailable';
};

// POST /api/v2/advise (#862, the AI advisor; reshaped by #959). Read-only: nothing is reserved or saved.
// The body is the parsed draft; a missing sender, recipient or ready time is a 200 with no options and a `note`.
// The engine builds every candidate plan for the draft and tags the fastest and the cheapest; Gemini (when there is
// a key) picks a third, 'recommended', from the intent of the business's sentence (`text`) and writes one sentence
// per shown option. Without Gemini, or when its answer fails the server's checks, the third is 'balanced'.
// Every number of an option is copied from the engine's plan, never from Gemini.
export type AdviseRequest = {
  draft: ParseDraft;
  /** The business's own sentence (POST /parse-request's `text`), for Gemini to read its intent. Optional. */
  text?: string | null;
};

/** Why an option is shown. One plan can carry several tags ("fastest" and "cheapest"). */
export type AdviseTag = 'fastest' | 'cheapest' | 'recommended' | 'balanced';

export type AdviseOption = {
  // `id` and `tags`: the server always sends them (#959); optional in the type only for samples written before.
  /** The candidate's id in this answer (p1, p2, ... in the engine's order). */
  id?: string;
  /** At least one; 'recommended' and 'balanced' never together. */
  tags?: AdviseTag[];
  label: string;                                   // <= 60 characters
  summary: string;                                 // <= 140 characters
  /** With the 'recommended' tag: why it fits the request, one sentence <= 120 characters. */
  reason?: string;
  /** What to change in the form to get this option. Empty for the request as typed. */
  changes: { readyMin?: number; deadlineMin?: number };
  kind: 'direct' | 'relay';
  relayBusinessId?: string;
  carrierNames: string[];                          // the plan's carriers, in leg order
  deliveryMin: number;
  extraMin: number;                                // the carriers' added minutes, summed over the legs
  extraMiles: number;                              // the carriers' added distance in miles, one decimal
  customerPriceCents: number;                      // the plan's customerPriceCents
};

export type AdviseResponse = {
  /**
   * 0 to 3 options, all matchable now, in this order: the fastest, the cheapest (when it is another plan), then
   * the recommended or balanced plan (when there is another one). 0 when no plan is found (`note` says why).
   */
  options: AdviseOption[];
  /** 'gemini' when the third option is Gemini's recommendation, else 'offline'. */
  source: 'gemini' | 'offline';
  /** A plain sentence when there is something to add, e.g. why there is no relay, or why no option matched. */
  note?: string;
};
