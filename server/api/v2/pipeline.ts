import {
  jobIdFor,
  type AssignmentResult, type DeliveryPlan, type Job, type Notification, type Run, type SimEvent,
  type TravelProvider,
} from '../../../shared/v2/types';
import { assignShipments, type MatchContext } from '../../domain/v2/matching';

/**
 * What the pipeline needs from outside. `buildEvents` is `buildTimeline` from
 * `server/domain/v2/timeline.ts`; it is passed in so this module has no fs, no clock
 * and no dependency on the timeline's file.
 */
export type PipelineDeps = {
  travel: TravelProvider;
  buildEvents: (plans: DeliveryPlan[], jobs: Job[]) => SimEvent[];
};

export type Materialized = {
  assignments: AssignmentResult;
  jobs: Job[];
  notifications: Notification[];
  events: SimEvent[];
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// A place that does not resolve is never shown as a raw ID (DECISIONS pass 45).
const UNKNOWN_PLACE = 'Unknown place';

/** The matcher's view of a run. Trips are the run's, never rebuilt here. */
export function matchContext(run: Run, travel: TravelProvider): MatchContext {
  const { scenario } = run;
  return {
    travel, trips: run.trips, employees: scenario.employees,
    businesses: scenario.businesses, settings: scenario.settings,
  };
}

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
 * timeline. Pure and idempotent: notifications are reconciled against the plans (see below).
 */
export function materializeAssignment(run: Run, result: AssignmentResult, deps: PipelineDeps): Materialized {
  const { scenario } = run;
  const plans = result.plans;
  const jobs = plans.flatMap(jobsFor);
  const events = deps.buildEvents(plans, jobs);

  // Reconcile: every plan gets one notification per business involved (sender, recipient and,
  // for a relay plan, the relay point) and every job gets one, each with a deterministic ID.
  // Existing IDs keep their createdSeq and get their text refreshed in place; IDs for
  // plans/jobs that no longer exist are dropped.
  const previous = new Map(run.notifications.map((n) => [n.id, n]));
  let seq = run.notifications.reduce((max, n) => Math.max(max, n.createdSeq), 0);
  const notifications: Notification[] = [];
  const emitted = new Set<string>();
  const emit = (n: Omit<Notification, 'createdSeq'>) => {
    if (emitted.has(n.id)) return;
    emitted.add(n.id);
    const old = previous.get(n.id);
    notifications.push({ ...n, createdSeq: old ? old.createdSeq : ++seq });
  };
  const shipments = new Map(scenario.shipments.map((s) => [s.id, s]));
  const names = new Map(scenario.businesses.map((b) => [b.id, b.name]));
  const jobsByPlan = new Map<string, Job[]>();
  for (const job of jobs) jobsByPlan.set(job.planId, [...(jobsByPlan.get(job.planId) ?? []), job]);

  for (const plan of plans) {
    const shipment = shipments.get(plan.shipmentId);
    if (!shipment) continue;
    const origin = names.get(shipment.originBusinessId) ?? UNKNOWN_PLACE;
    const dest = names.get(shipment.destinationBusinessId) ?? UNKNOWN_PLACE;
    // The relay business by name; UI copy says "relay point", never "hub" (DECISIONS pass 44).
    const relayName = plan.relayBusinessId === undefined ? undefined : names.get(plan.relayBusinessId);
    const relay = relayName ?? 'the relay point';
    const via = plan.kind !== 'relay' ? '' : relayName ? ` via ${relayName} (relay point)` : ' via a relay point';
    const matched = (audienceId: string, message: string) => emit({
      id: `ntf-${plan.id}-${audienceId}`, audience: 'business', audienceId,
      kind: 'delivery_matched', shipmentId: plan.shipmentId, planId: plan.id, message,
    });
    matched(shipment.originBusinessId,
      `Delivery arranged: "${shipment.label}" to ${dest}${via}, ${money(plan.customerPriceCents)}.`);
    matched(shipment.destinationBusinessId, `Incoming delivery: "${shipment.label}" from ${origin}${via}.`);
    // The relay business holds the package overnight and is neither sender nor recipient: its
    // notifications panel is the only place it sees that (DECISIONS pass 50, pass 57). Storage
    // is at the business itself, so the text names no employee and no home (SPEC MVP II rule 5).
    if (plan.kind === 'relay' && plan.relayBusinessId !== undefined) {
      matched(plan.relayBusinessId,
        `Relay point: "${shipment.label}" from ${origin} to ${dest} is dropped here in the evening and collected the next morning.`);
    }
    for (const job of jobsByPlan.get(plan.id) ?? []) {
      const role = plan.kind === 'relay'
        ? (job.legIndex === 0
          ? `Drop at ${relay}; another employee completes delivery`
          : `Collect from ${relay} and deliver to ${dest}`)
        : `Collect from ${origin} and deliver to ${dest}`;
      emit({
        id: `ntf-${job.id}`, audience: 'employee', audienceId: job.employeeId,
        kind: 'job_assigned', shipmentId: plan.shipmentId, planId: plan.id, jobId: job.id,
        message: `New delivery job: "${shipment.label}". ${role}. Reward ${money(job.rewardCents)}.`,
      });
    }
  }
  return { assignments: result, jobs, notifications, events };
}

/**
 * Matches the given shipments against the free trips, keeping every existing plan
 * untouched, and writes the result into `run` (call inside `store.mutate`).
 * A `TravelDataMissingError` from the provider propagates and leaves `run` as it was.
 */
export function matchPending(run: Run, shipmentIds: string[], deps: PipelineDeps): void {
  const ids = new Set(shipmentIds);
  const pending = run.scenario.shipments.filter((s) => ids.has(s.id));
  const t0 = performance.now();
  const result = assignShipments(pending, matchContext(run, deps.travel), { existing: run.assignments.plans });
  result.computeMs = performance.now() - t0;
  // The matcher orders plans by the `createdSeq` of the shipments it was given, which here is
  // only the pending ones. Order by the whole scenario instead, so the kept plans stay where they
  // were (DECISIONS pass 4). Jobs and events follow, because they are built plan by plan.
  // A plan whose shipment is gone has no `createdSeq` and goes last; the sort is stable.
  const seq = new Map(run.scenario.shipments.map((s) => [s.id, s.createdSeq]));
  const seqOf = (plan: DeliveryPlan) => seq.get(plan.shipmentId) ?? Number.MAX_SAFE_INTEGER;
  result.plans.sort((a, b) => seqOf(a) - seqOf(b));
  result.unmatched = [
    ...run.assignments.unmatched.filter((u) => !ids.has(u.shipmentId)),
    ...result.unmatched,
  ];
  Object.assign(run, materializeAssignment(run, result, deps));
}
