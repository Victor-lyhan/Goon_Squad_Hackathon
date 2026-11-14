import { jobIdFor } from '../../shared/types';
import type {
  DeliveryPlan,
  Hub,
  Job,
  Run,
  SimEvent,
  SimEventKind,
  Snapshot,
  StopKind,
} from '../../shared/types';
import { computeMetrics } from './metrics';

const EVENT_KIND_BY_STOP: Record<StopKind, SimEventKind> = {
  pickup: 'pickup',
  hub_drop: 'hub_drop',
  hub_pickup: 'hub_pickup',
  delivery: 'delivered',
};

const EVENT_KIND_ORDER: Record<SimEventKind, number> = {
  hub_drop: 0,
  hub_pickup: 1,
  pickup: 2,
  delivered: 3,
};

type EventWithStopIndex = SimEvent & { stopIndex: number };

/**
 * Turns the stops in selected delivery plans into the authoritative simulation
 * event timeline. A custody event occurs when its two-minute service completes.
 */
export function buildTimeline(plans: DeliveryPlan[], jobs: Job[], hubs: Hub[]): SimEvent[] {
  // Jobs are deliberately identified from the plan/leg convention so a stale or
  // incomplete jobs list cannot change the timeline. They remain an argument for
  // the Run-level builder API that supplies plans, jobs, and hubs together.
  void jobs;

  const events: EventWithStopIndex[] = [];

  for (const plan of plans) {
    let stopIndex = 0;
    for (let legIndex = 0; legIndex < plan.legs.length; legIndex += 1) {
      const leg = plan.legs[legIndex];
      for (const stop of leg.stops) {
        const kind = EVENT_KIND_BY_STOP[stop.kind];
        const hubId = kind === 'hub_drop' || kind === 'hub_pickup'
          ? plan.hubId ?? hubs.find((hub) => hub.nodeId === stop.nodeId)?.id
          : undefined;

        events.push({
          id: `evt-${plan.id}-${stopIndex}`,
          timeMin: stop.serviceEndMin,
          shipmentId: plan.shipmentId,
          planId: plan.id,
          jobId: jobIdFor(plan.id, legIndex),
          kind,
          employeeId: leg.employeeId,
          ...(hubId === undefined ? {} : { hubId }),
          seq: 0,
          stopIndex,
        });
        stopIndex += 1;
      }
    }
  }

  events.sort((left, right) =>
    left.timeMin - right.timeMin
    || EVENT_KIND_ORDER[left.kind] - EVENT_KIND_ORDER[right.kind]
    || left.planId.localeCompare(right.planId)
    || left.stopIndex - right.stopIndex,
  );

  return events.map(({ stopIndex: _stopIndex, ...event }, seq) => ({ ...event, seq }));
}

/**
 * Derives the visible state at a particular simulated minute from the immutable
 * run timeline. Nothing is accumulated here, so seeking backwards cannot leave
 * behind progress or earnings from a later snapshot.
 */
export function snapshotAt(run: Run, timeMin: number): Snapshot {
  const occurredEvents = run.events.filter((event) => event.timeMin <= timeMin);
  const plansByShipmentId = new Map(
    run.assignments.plans.map((plan) => [plan.shipmentId, plan]),
  );
  const eventsByJobId = new Map<string, SimEvent[]>();

  for (const event of run.events) {
    const events = eventsByJobId.get(event.jobId) ?? [];
    events.push(event);
    eventsByJobId.set(event.jobId, events);
  }

  const occurredEventIds = new Set(occurredEvents.map((event) => event.id));
  const shipmentStatus: Snapshot['shipmentStatus'] = {};
  const deliveredAtMin: Snapshot['deliveredAtMin'] = {};

  for (const shipment of run.scenario.shipments) {
    const plan = plansByShipmentId.get(shipment.id);
    if (plan === undefined) {
      shipmentStatus[shipment.id] = 'unmatched';
      continue;
    }

    const shipmentEvents = occurredEvents.filter((event) => event.shipmentId === shipment.id);
    const lastEvent = shipmentEvents[shipmentEvents.length - 1];
    if (lastEvent === undefined) {
      shipmentStatus[shipment.id] = 'scheduled';
      continue;
    }

    switch (lastEvent.kind) {
      case 'pickup':
        shipmentStatus[shipment.id] = 'picked_up';
        break;
      case 'hub_drop':
        shipmentStatus[shipment.id] = 'at_hub';
        break;
      case 'hub_pickup':
        shipmentStatus[shipment.id] = 'out_for_delivery';
        break;
      case 'delivered':
        shipmentStatus[shipment.id] = 'delivered';
        deliveredAtMin[shipment.id] = lastEvent.timeMin;
        break;
    }
  }

  const jobStatus: Snapshot['jobStatus'] = {};
  const earningsCents: Snapshot['earningsCents'] = Object.fromEntries(
    run.scenario.employees.map((employee) => [employee.id, 0]),
  );

  for (const plan of run.assignments.plans) {
    plan.legs.forEach((leg, legIndex) => {
      const legEvents = eventsByJobId.get(jobIdFor(plan.id, legIndex)) ?? [];
      const lastEvent = legEvents[legEvents.length - 1];
      if (lastEvent !== undefined && occurredEventIds.has(lastEvent.id)) {
        earningsCents[leg.employeeId] = (earningsCents[leg.employeeId] ?? 0) + leg.rewardCents;
      }
    });
  }

  for (const job of run.jobs) {
    const plan = run.assignments.plans.find((candidate) => candidate.id === job.planId);
    const jobId = plan === undefined ? job.id : jobIdFor(plan.id, job.legIndex);
    const legEvents = eventsByJobId.get(jobId) ?? [];
    const firstEvent = legEvents[0];
    const lastEvent = legEvents[legEvents.length - 1];

    if (firstEvent === undefined || !occurredEventIds.has(firstEvent.id)) {
      jobStatus[job.id] = 'assigned';
      continue;
    }
    if (lastEvent !== undefined && occurredEventIds.has(lastEvent.id)) {
      jobStatus[job.id] = 'completed';
      continue;
    }
    jobStatus[job.id] = 'in_progress';
  }

  return {
    runId: run.runId,
    version: run.version,
    timeMin,
    shipmentStatus,
    deliveredAtMin,
    jobStatus,
    earningsCents,
    markers: [],
    packagePositions: {},
    occurredEvents,
    metrics: computeMetrics({
      shipments: run.scenario.shipments,
      plans: run.assignments.plans,
      unmatched: run.assignments.unmatched,
      occurredEvents,
      settings: run.scenario.settings,
    }),
  };
}
