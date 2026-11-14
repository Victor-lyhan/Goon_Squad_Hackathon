import { jobIdFor } from '../../../shared/v2/types.js';
import type {
  DeliveryPlan,
  Job,
  Shipment,
  SimEvent,
  SimEventKind,
  Snapshot,
} from '../../../shared/v2/types.js';

const EVENT_KIND_BY_STOP = {
  pickup: 'pickup',
  hub_drop: 'hub_drop',
  hub_pickup: 'hub_pickup',
  delivery: 'delivered',
} as const satisfies Record<string, SimEventKind>;

const EVENT_KIND_ORDER: Record<SimEventKind, number> = {
  hub_drop: 0,
  hub_pickup: 1,
  pickup: 2,
  delivered: 3,
};

type EventWithStopIndex = SimEvent & { stopIndex: number };

export type ProgressInput = {
  shipments: Shipment[];
  plans: DeliveryPlan[];
  jobs: Job[];
  events: SimEvent[];
};

export type Progress = Pick<Snapshot,
  'occurredEvents' | 'shipmentStatus' | 'deliveredAtMin' | 'jobStatus' | 'earningsCents'>;

function orderedEvents(events: SimEvent[]): SimEvent[] {
  return [...events].sort((left, right) =>
    left.timeMin - right.timeMin
    || EVENT_KIND_ORDER[left.kind] - EVENT_KIND_ORDER[right.kind]
    || left.planId.localeCompare(right.planId)
    || left.seq - right.seq,
  );
}

/** Builds the immutable custody-event timeline from the planned stop completions. */
export function buildTimeline(plans: DeliveryPlan[], jobs: Job[]): SimEvent[] {
  // The deterministic plan/leg convention is authoritative. Keep jobs in the
  // signature so this composes with the pipeline that materializes both lists.
  void jobs;

  const events: EventWithStopIndex[] = [];
  for (const plan of plans) {
    let stopIndex = 0;
    for (let legIndex = 0; legIndex < plan.legs.length; legIndex += 1) {
      const leg = plan.legs[legIndex]!;
      for (const stop of leg.stops) {
        const kind = EVENT_KIND_BY_STOP[stop.kind];
        const isRelayPointEvent = kind === 'hub_drop' || kind === 'hub_pickup';
        events.push({
          id: `evt-${plan.id}-${stopIndex}`,
          timeMin: stop.serviceEndMin,
          shipmentId: plan.shipmentId,
          planId: plan.id,
          jobId: jobIdFor(plan.id, legIndex),
          kind,
          employeeId: leg.employeeId,
          ...(isRelayPointEvent && plan.relayBusinessId !== undefined
            ? { relayBusinessId: plan.relayBusinessId }
            : {}),
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
 * Derives all non-geometric simulation state from elapsed events. It never
 * mutates its input, so seeking backwards cannot retain later progress.
 */
export function progressAt(input: ProgressInput, timeMin: number): Progress {
  const events = orderedEvents(input.events);
  const occurredEvents = events.filter((event) => event.timeMin <= timeMin);
  const occurredEventIds = new Set(occurredEvents.map((event) => event.id));
  const plansByShipmentId = new Map(input.plans.map((plan) => [plan.shipmentId, plan]));
  const eventsByShipmentId = new Map<string, SimEvent[]>();
  const eventsByJobId = new Map<string, SimEvent[]>();

  for (const event of events) {
    const shipmentEvents = eventsByShipmentId.get(event.shipmentId) ?? [];
    shipmentEvents.push(event);
    eventsByShipmentId.set(event.shipmentId, shipmentEvents);
    const jobEvents = eventsByJobId.get(event.jobId) ?? [];
    jobEvents.push(event);
    eventsByJobId.set(event.jobId, jobEvents);
  }

  const shipmentStatus: Progress['shipmentStatus'] = {};
  const deliveredAtMin: Progress['deliveredAtMin'] = {};
  for (const shipment of input.shipments) {
    if (!plansByShipmentId.has(shipment.id)) {
      shipmentStatus[shipment.id] = 'unmatched';
      continue;
    }

    const shipmentEvents = eventsByShipmentId.get(shipment.id) ?? [];
    const lastEvent = shipmentEvents.filter((event) => event.timeMin <= timeMin).at(-1);
    if (lastEvent === undefined) {
      shipmentStatus[shipment.id] = 'scheduled';
      continue;
    }
    if (lastEvent.kind === 'pickup') shipmentStatus[shipment.id] = 'picked_up';
    if (lastEvent.kind === 'hub_drop') shipmentStatus[shipment.id] = 'at_hub';
    if (lastEvent.kind === 'hub_pickup') shipmentStatus[shipment.id] = 'out_for_delivery';
    if (lastEvent.kind === 'delivered') {
      shipmentStatus[shipment.id] = 'delivered';
      deliveredAtMin[shipment.id] = lastEvent.timeMin;
    }
  }

  const jobStatus: Progress['jobStatus'] = {};
  const earningsCents: Progress['earningsCents'] = {};
  for (const job of input.jobs) earningsCents[job.employeeId] = 0;

  for (const job of input.jobs) {
    const jobEvents = eventsByJobId.get(job.id) ?? [];
    const firstEvent = jobEvents[0];
    const lastEvent = jobEvents.at(-1);
    if (firstEvent === undefined || !occurredEventIds.has(firstEvent.id)) {
      jobStatus[job.id] = 'assigned';
    } else if (lastEvent !== undefined && occurredEventIds.has(lastEvent.id)) {
      jobStatus[job.id] = 'completed';
    } else {
      jobStatus[job.id] = 'in_progress';
    }
  }

  for (const plan of input.plans) {
    plan.legs.forEach((leg, legIndex) => {
      const jobEvents = eventsByJobId.get(jobIdFor(plan.id, legIndex)) ?? [];
      const finalEvent = jobEvents.at(-1);
      if (finalEvent !== undefined && occurredEventIds.has(finalEvent.id)) {
        earningsCents[leg.employeeId] = (earningsCents[leg.employeeId] ?? 0) + leg.rewardCents;
      }
    });
  }

  return { occurredEvents, shipmentStatus, deliveredAtMin, jobStatus, earningsCents };
}
