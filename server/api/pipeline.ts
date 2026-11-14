import {
  jobIdFor,
  type AssignmentResult, type DeliveryPlan, type Job, type Notification, type Run, type SimEvent,
} from '../../shared/types';
import { assignShipments } from '../domain/matching';
import { createRouter } from '../domain/routing';
import { buildTimeline } from '../domain/simulation';

export type Materialized = {
  assignments: AssignmentResult;
  jobs: Job[];
  notifications: Notification[];
  events: SimEvent[];
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function jobsFor(plan: DeliveryPlan): Job[] {
  return plan.legs.map((leg, legIndex) => ({
    id: jobIdFor(plan.id, legIndex),
    planId: plan.id,
    shipmentId: plan.shipmentId,
    employeeId: leg.employeeId,
    legIndex,
    tripId: leg.tripId,
    pickup: leg.stops[0],
    dropoff: leg.stops[leg.stops.length - 1],
    rewardCents: leg.rewardCents,
  }));
}

/**
 * Turns an assignment result into the run's plans, jobs, notifications and
 * timeline. Pure and idempotent: plans that already have notifications get no new ones.
 */
export function materializeAssignment(run: Run, result: AssignmentResult): Materialized {
  const { scenario } = run;
  const plans = result.plans;
  const jobs = plans.flatMap(jobsFor);
  const events = buildTimeline(plans, jobs, scenario.hubs);

  const notifications = [...run.notifications];
  const planned = new Set(notifications.map((n) => n.planId));
  let seq = notifications.reduce((max, n) => Math.max(max, n.createdSeq), 0);
  const shipments = new Map(scenario.shipments.map((s) => [s.id, s]));
  const businesses = new Map(scenario.businesses.map((b) => [b.id, b]));
  const jobsByPlan = new Map<string, Job[]>();
  for (const job of jobs) jobsByPlan.set(job.planId, [...(jobsByPlan.get(job.planId) ?? []), job]);

  for (const plan of plans) {
    if (planned.has(plan.id)) continue;
    const shipment = shipments.get(plan.shipmentId);
    if (!shipment) continue;
    const origin = businesses.get(shipment.originBusinessId)?.name ?? shipment.originBusinessId;
    const dest = businesses.get(shipment.destinationBusinessId)?.name ?? shipment.destinationBusinessId;
    const via = plan.kind === 'relay' ? ' via a hub relay' : '';
    const matched = (audienceId: string, message: string): Notification => ({
      id: `ntf-${plan.id}-${audienceId}`, audience: 'business', audienceId,
      kind: 'delivery_matched', shipmentId: plan.shipmentId, planId: plan.id, message,
      createdSeq: ++seq,
    });
    notifications.push(
      matched(shipment.originBusinessId,
        `Delivery arranged: "${shipment.label}" to ${dest}${via}, ${money(plan.customerPriceCents)}.`),
      matched(shipment.destinationBusinessId,
        `Incoming delivery: "${shipment.label}" from ${origin}${via}.`),
    );
    for (const job of jobsByPlan.get(plan.id) ?? []) {
      const role = plan.kind === 'relay'
        ? (job.legIndex === 0
          ? 'Drop at the hub; another employee completes delivery'
          : `Collect from the hub and deliver to ${dest}`)
        : `Collect from ${origin} and deliver to ${dest}`;
      notifications.push({
        id: `ntf-${job.id}`, audience: 'employee', audienceId: job.employeeId,
        kind: 'job_assigned', shipmentId: plan.shipmentId, planId: plan.id, jobId: job.id,
        message: `New delivery job: "${shipment.label}". ${role}. Reward ${money(job.rewardCents)}.`,
        createdSeq: ++seq,
      });
    }
  }
  return { assignments: result, jobs, notifications, events };
}

/**
 * Matches the given shipments against the free trips, keeping every existing plan
 * untouched, and writes the result into `run` (call inside `store.mutate`).
 */
export function matchPending(run: Run, shipmentIds: string[]): void {
  const { scenario } = run;
  const ids = new Set(shipmentIds);
  const pending = scenario.shipments.filter((s) => ids.has(s.id));
  const t0 = performance.now();
  const result = assignShipments(pending, {
    router: createRouter(scenario.graph), trips: run.trips, employees: scenario.employees,
    businesses: scenario.businesses, hubs: scenario.hubs, settings: scenario.settings,
  }, { existing: run.assignments.plans });
  result.computeMs = performance.now() - t0;
  result.unmatched = [
    ...run.assignments.unmatched.filter((u) => !ids.has(u.shipmentId)),
    ...result.unmatched,
  ];
  Object.assign(run, materializeAssignment(run, result));
}
