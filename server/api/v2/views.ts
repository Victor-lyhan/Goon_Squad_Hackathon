// MVP II read models. Pure functions of a finished Run + Snapshot: no Express, no store, no domain imports.
// The /api/v2 read routes only call these. Same rules as server/api/views.ts (MVP 1).
// Progress and job status are never stored; they come from the Snapshot.
import type {
  BusinessDashboard, CommuteResponse, EmployeeDashboard, EmployeeJobView, JobResponse, MapResponse,
  RoutePolyline, ShipmentView, SimulatorResponse,
} from '../../../shared/v2/api';
import { pairKey } from '../../../shared/v2/types';
import type { DeliveryPlan, Home, Job, Notification, Run, Shipment, Snapshot, TravelProvider } from '../../../shared/v2/types';

// Plain code-unit order, so the result never depends on the machine's locale.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const notesNewest = (a: Notification, b: Notification) => b.createdSeq - a.createdSeq || byText(a.id, b.id);
const byNewest = (a: Shipment, b: Shipment) => b.createdSeq - a.createdSeq || byText(a.id, b.id);

function buildShipmentView(run: Run, snapshot: Snapshot, shipment: Shipment): ShipmentView {
  const plan = run.assignments.plans.find((p) => p.shipmentId === shipment.id) ?? null;
  const jobIds = run.jobs
    .filter((j) => j.shipmentId === shipment.id)
    .sort((a, b) => a.legIndex - b.legIndex)
    .map((j) => j.id);
  return {
    shipment,
    plan,
    jobIds,
    status: snapshot.shipmentStatus[shipment.id] ?? (plan ? 'scheduled' : 'unmatched'),
    deliveredAtMin: snapshot.deliveredAtMin[shipment.id] ?? null,
    unmatchedReason: run.assignments.unmatched.find((u) => u.shipmentId === shipment.id)?.reason ?? null,
  };
}

function buildJobView(run: Run, snapshot: Snapshot, job: Job): EmployeeJobView | null {
  const shipment = run.scenario.shipments.find((s) => s.id === job.shipmentId);
  const plan = run.assignments.plans.find((p) => p.id === job.planId);
  if (!shipment || !plan) return null;
  return {
    job, status: snapshot.jobStatus[job.id] ?? 'assigned', shipment, plan,
    stopsDone: stopsDoneAt(job, plan, snapshot.timeMin),
    departed: departedAt(run, job, plan, snapshot.timeMin),
  };
}

// Has the job's commute left at the snapshot's minute (#791)? Yes from its trip's `departureMin` on: the
// time the page shows on the "Leave work" / "Leave home" row. A job whose trip is gone (a broken run; its
// job view answers 404) counts as left once the carrier is at the first stop, which is never too early.
function departedAt(run: Run, job: Job, plan: DeliveryPlan, timeMin: number): boolean {
  const trip = run.trips.find((t) => t.id === job.tripId);
  if (trip) return trip.departureMin <= timeMin;
  const first = plan.legs[job.legIndex]?.stops?.[0] ?? job.pickup;
  return first.arrivalMin <= timeMin;
}

// How many of the job's leg stops are done at the snapshot's minute (#781): the stops, in order, whose
// handling ended at or before it. The same rule as the stop events of the timeline (`serviceEndMin`),
// so the count agrees with `status`. A leg without stops falls back to the job's own two, as the page does.
function stopsDoneAt(job: Job, plan: DeliveryPlan, timeMin: number): number {
  const leg = plan.legs[job.legIndex];
  const stops = leg?.stops?.length ? leg.stops : [job.pickup, job.dropoff];
  let done = 0;
  while (done < stops.length && stops[done].serviceEndMin <= timeMin) done += 1;
  return done;
}

const homeOf = (run: Run, homeId: string): Home | undefined => run.scenario.homes.find((h) => h.id === homeId);

export function shipmentView(run: Run, snapshot: Snapshot, shipmentId: string): ShipmentView | null {
  const shipment = run.scenario.shipments.find((s) => s.id === shipmentId);
  return shipment ? buildShipmentView(run, snapshot, shipment) : null;
}

export function businessDashboard(run: Run, snapshot: Snapshot, businessId: string): BusinessDashboard | null {
  const business = run.scenario.businesses.find((b) => b.id === businessId);
  if (!business) return null;
  const shipments = run.scenario.shipments;
  const view = (s: Shipment) => buildShipmentView(run, snapshot, s);
  const outgoing = shipments.filter((s) => s.originBusinessId === businessId).sort(byNewest).map(view);
  const incoming = shipments.filter((s) => s.destinationBusinessId === businessId).sort(byNewest).map(view);
  const matchedOut = outgoing.filter((v) => v.plan !== null);
  return {
    business,
    outgoing,
    incoming,
    notifications: run.notifications
      .filter((n) => n.audience === 'business' && n.audienceId === businessId)
      .sort(notesNewest),
    totals: {
      sent: outgoing.length,
      matched: matchedOut.length,
      delivered: outgoing.filter((v) => v.status === 'delivered').length,
      // Committed spend: every matched outgoing plan counts, delivered or not (DECISIONS pass 4).
      spendCents: matchedOut.reduce((sum, v) => sum + (v.plan?.customerPriceCents ?? 0), 0),
    },
    phase: run.clock.phase,
    version: run.version,
  };
}

// An employee whose home is not in the scenario is treated like an unknown ID (null), so no response
// ever carries `home: undefined`.
export function employeeDashboard(run: Run, snapshot: Snapshot, employeeId: string): EmployeeDashboard | null {
  const employee = run.scenario.employees.find((e) => e.id === employeeId);
  const home = employee && homeOf(run, employee.homeId);
  if (!employee || !home) return null;
  const jobs = run.jobs.filter((j) => j.employeeId === employeeId);
  const views = jobs
    .map((j) => buildJobView(run, snapshot, j))
    .filter((v): v is EmployeeJobView => v !== null)
    .sort((a, b) => a.job.pickup.serviceStartMin - b.job.pickup.serviceStartMin || byText(a.job.id, b.job.id));
  return {
    employee,
    home,
    trips: run.trips.filter((t) => t.employeeId === employeeId),
    assigned: views.filter((v) => v.status !== 'completed'),
    completed: views.filter((v) => v.status === 'completed'),
    earnedCents: snapshot.earningsCents[employeeId] ?? 0,
    projectedCents: jobs.reduce((sum, j) => sum + j.rewardCents, 0),
    notifications: run.notifications
      .filter((n) => n.audience === 'employee' && n.audienceId === employeeId)
      .sort(notesNewest),
    phase: run.clock.phase,
    version: run.version,
  };
}

// Body of PUT /api/v2/employees/:id/commute, read from the run after the save.
// `rematchedShipmentIds` is known only to the caller that ran the re-match.
export function commuteResponse(run: Run, employeeId: string, rematchedShipmentIds: string[] = []): CommuteResponse | null {
  const employee = run.scenario.employees.find((e) => e.id === employeeId);
  const home = employee && homeOf(run, employee.homeId);
  if (!employee || !home) return null;
  return { employee, home, trips: run.trips.filter((t) => t.employeeId === employeeId), rematchedShipmentIds };
}

export function jobResponse(run: Run, snapshot: Snapshot, jobId: string): JobResponse | null {
  const job = run.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const view = buildJobView(run, snapshot, job);
  const trip = run.trips.find((t) => t.id === job.tripId);
  return view && trip ? { ...view, trip } : null;
}

export function simulatorResponse(run: Run, snapshot: Snapshot): SimulatorResponse {
  let nextEventMin: number | null = null;
  for (const e of run.events) {
    if (e.timeMin > run.clock.timeMin && (nextEventMin === null || e.timeMin < nextEventMin)) nextEventMin = e.timeMin;
  }
  // Only the carriers' trips (not every employee's), so a journey can play the whole commute (#761).
  const legTripIds = new Set(run.assignments.plans.flatMap((p) => p.legs.map((l) => l.tripId)));
  return {
    runId: run.runId,
    version: run.version,
    clock: run.clock,
    snapshot,
    plans: run.assignments.plans,
    jobs: run.jobs,
    shipments: run.scenario.shipments,
    unmatched: run.assignments.unmatched,
    computeMs: run.assignments.computeMs,
    nextEventMin,
    trips: run.trips.filter((t) => legTripIds.has(t.id)),
  };
}

// Static map data, fetched once per runId (and again when the set of plan IDs changes).
// Polylines: one per ordered place pair, for every baseline commute and every neighbouring pair of every
// plan leg. Sorted by `from` then `to`, so the body doesn't depend on the order of trips or plans.
export function mapResponse(run: Run, travel: Pick<TravelProvider, 'polyline'>): MapResponse {
  const { businesses, homes, employees } = run.scenario;
  const homeIdsInUse = new Set(employees.map((e) => e.homeId));

  const pairs = new Map<string, { from: string; to: string }>();
  const add = (from: string, to: string) => {
    const key = pairKey(from, to);
    if (!pairs.has(key)) pairs.set(key, { from, to });
  };
  for (const trip of run.trips) add(trip.originPlaceId, trip.destinationPlaceId);
  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) {
      for (let i = 1; i < leg.placeIds.length; i++) add(leg.placeIds[i - 1], leg.placeIds[i]);
    }
  }
  const polylines: RoutePolyline[] = [...pairs.values()]
    .sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to))
    .map(({ from, to }) => ({ from, to, encoded: travel.polyline(from, to) ?? null }));

  return {
    runId: run.runId,
    businesses,
    homes: homes.filter((h) => homeIdsInUse.has(h.id)),
    employees: employees.map(({ id, name, businessId, homeId }) => ({ id, name, businessId, homeId })),
    polylines,
  };
}
