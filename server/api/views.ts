// Pure portal view builders. No Express: route files only call these.
// Progress and job status are never stored; they come from the Snapshot.
import type {
  BusinessDashboard, EmployeeDashboard, EmployeeJobView, JobResponse, ShipmentView,
} from '../../shared/api';
import type { Job, Run, Shipment, Snapshot } from '../../shared/types';

const byNewest = (a: Shipment, b: Shipment) => b.createdSeq - a.createdSeq;

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
  return { job, status: snapshot.jobStatus[job.id] ?? 'assigned', shipment, plan };
}

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
    notifications: run.notifications.filter((n) => n.audience === 'business' && n.audienceId === businessId),
    totals: {
      sent: outgoing.length,
      matched: matchedOut.length,
      delivered: outgoing.filter((v) => v.status === 'delivered').length,
      spendCents: matchedOut.reduce((sum, v) => sum + (v.plan?.customerPriceCents ?? 0), 0),
    },
    phase: run.clock.phase,
    version: run.version,
  };
}

export function employeeDashboard(run: Run, snapshot: Snapshot, employeeId: string): EmployeeDashboard | null {
  const employee = run.scenario.employees.find((e) => e.id === employeeId);
  if (!employee) return null;
  const jobs = run.jobs.filter((j) => j.employeeId === employeeId);
  const views = jobs
    .map((j) => buildJobView(run, snapshot, j))
    .filter((v): v is EmployeeJobView => v !== null)
    .sort((a, b) => a.job.pickup.serviceStartMin - b.job.pickup.serviceStartMin);
  return {
    employee,
    trips: run.trips.filter((t) => t.employeeId === employeeId),
    assigned: views.filter((v) => v.status !== 'completed'),
    completed: views.filter((v) => v.status === 'completed'),
    earnedCents: snapshot.earningsCents[employeeId] ?? 0,
    projectedCents: jobs.reduce((sum, j) => sum + j.rewardCents, 0),
    notifications: run.notifications.filter((n) => n.audience === 'employee' && n.audienceId === employeeId),
    phase: run.clock.phase,
    version: run.version,
  };
}

export function jobResponse(run: Run, snapshot: Snapshot, jobId: string): JobResponse | null {
  const job = run.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const view = buildJobView(run, snapshot, job);
  const trip = run.trips.find((t) => t.id === job.tripId);
  return view && trip ? { ...view, trip } : null;
}
