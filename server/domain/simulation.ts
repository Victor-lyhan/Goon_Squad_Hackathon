import { jobIdFor } from '../../shared/types';
import type {
  DeliveryPlan,
  Hub,
  Job,
  Leg,
  MarkerPosition,
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

type Point = { x: number; y: number };

type RunIndexes = {
  events: SimEvent[];
  eventsByJobId: Map<string, SimEvent[]>;
  eventsByShipmentId: Map<string, SimEvent[]>;
  plansByShipmentId: Map<string, DeliveryPlan>;
  plansById: Map<string, DeliveryPlan>;
  nodes: Map<string, Point>;
  durations: Map<string, number>;
  tripsById: Map<string, Run['trips'][number]>;
  businessesById: Map<string, Run['scenario']['businesses'][number]>;
};

// A Run is frozen while it is simulated. Keeping immutable lookup tables by
// Run means the one-second polling path does not repeatedly sort and rebuild
// the same timeline indexes. WeakMap keeps this an implementation detail of
// the pure function: nothing is attached to or mutated on the Run itself.
const indexesByRun = new WeakMap<Run, RunIndexes>();

/**
 * Runs normally retain the output of buildTimeline, but snapshotAt is also
 * used while assembling/importing a run. Normalize that input here so status
 * derivation never depends on an incidental array order at an equal minute.
 */
function orderedEvents(events: SimEvent[]): SimEvent[] {
  return [...events].sort((left, right) =>
    left.timeMin - right.timeMin
    || EVENT_KIND_ORDER[left.kind] - EVENT_KIND_ORDER[right.kind]
    || left.planId.localeCompare(right.planId)
    || left.seq - right.seq,
  );
}

/** The fixture is directed and generated graphs may contain parallel roads. */
function edgeDurations(run: Run): Map<string, number> {
  const durations = new Map<string, number>();
  for (const edge of run.scenario.graph.edges) {
    const key = `${edge.from}\u0000${edge.to}`;
    const previous = durations.get(key);
    if (previous === undefined || edge.durationMin < previous) durations.set(key, edge.durationMin);
  }
  return durations;
}

function indexesFor(run: Run): RunIndexes {
  const cached = indexesByRun.get(run);
  if (cached !== undefined) return cached;

  const events = orderedEvents(run.events);
  const eventsByJobId = new Map<string, SimEvent[]>();
  const eventsByShipmentId = new Map<string, SimEvent[]>();
  for (const event of events) {
    const jobEvents = eventsByJobId.get(event.jobId) ?? [];
    jobEvents.push(event);
    eventsByJobId.set(event.jobId, jobEvents);
    const shipmentEvents = eventsByShipmentId.get(event.shipmentId) ?? [];
    shipmentEvents.push(event);
    eventsByShipmentId.set(event.shipmentId, shipmentEvents);
  }

  const indexes: RunIndexes = {
    events,
    eventsByJobId,
    eventsByShipmentId,
    plansByShipmentId: new Map(run.assignments.plans.map((plan) => [plan.shipmentId, plan])),
    plansById: new Map(run.assignments.plans.map((plan) => [plan.id, plan])),
    nodes: new Map(run.scenario.graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
    durations: edgeDurations(run),
    tripsById: new Map(run.trips.map((trip) => [trip.id, trip])),
    businessesById: new Map(run.scenario.businesses.map((business) => [business.id, business])),
  };
  indexesByRun.set(run, indexes);
  return indexes;
}

function occurredCount(events: SimEvent[], timeMin: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle]!.timeMin <= timeMin) low = middle + 1;
    else high = middle;
  }
  return low;
}

function markerForLeg(
  leg: Leg,
  departureMin: number,
  timeMin: number,
  nodes: Map<string, Point>,
  durations: Map<string, number>,
): MarkerPosition | undefined {
  if (timeMin < departureMin || timeMin > leg.finishMin) return undefined;

  let currentMin = departureMin;
  let stopIndex = 0;
  for (let routeIndex = 0; routeIndex < leg.routeNodeIds.length; routeIndex += 1) {
    const nodeId = leg.routeNodeIds[routeIndex];
    const node = nodes.get(nodeId);
    if (node === undefined) return undefined;

    // Stops are ordered along the expanded route. A stop makes the marker wait
    // before service, then remain stationary throughout handling.
    while (leg.stops[stopIndex]?.nodeId === nodeId) {
      const stop = leg.stops[stopIndex];
      if (timeMin < stop.serviceStartMin) {
        return { employeeId: leg.employeeId, ...node, servicing: false };
      }
      if (timeMin < stop.serviceEndMin) {
        return { employeeId: leg.employeeId, ...node, servicing: true };
      }
      currentMin = stop.serviceEndMin;
      stopIndex += 1;
    }

    if (routeIndex === leg.routeNodeIds.length - 1) {
      return { employeeId: leg.employeeId, ...node, servicing: false };
    }

    const nextNodeId = leg.routeNodeIds[routeIndex + 1];
    const durationMin = durations.get(`${nodeId}\u0000${nextNodeId}`);
    const nextNode = nodes.get(nextNodeId);
    if (durationMin === undefined || nextNode === undefined) return undefined;

    if (timeMin < currentMin + durationMin) {
      const fraction = (timeMin - currentMin) / durationMin;
      return {
        employeeId: leg.employeeId,
        x: node.x + (nextNode.x - node.x) * fraction,
        y: node.y + (nextNode.y - node.y) * fraction,
        servicing: false,
      };
    }
    currentMin += durationMin;
  }
  return undefined;
}

function packagePosition(
  plan: DeliveryPlan | undefined,
  origin: Point | undefined,
  destination: Point | undefined,
  markers: Map<string, MarkerPosition>,
  nodes: Map<string, Point>,
  timeMin: number,
): Point | undefined {
  if (plan === undefined) return origin;
  const firstLeg = plan.legs[0];
  const lastLeg = plan.legs[plan.legs.length - 1];
  const firstPickup = firstLeg?.stops[0];
  const finalDropoff = lastLeg?.stops[lastLeg.stops.length - 1];
  if (!firstPickup || !finalDropoff || timeMin < firstPickup.serviceEndMin) return origin;
  if (timeMin >= finalDropoff.serviceEndMin) return destination;

  for (const leg of plan.legs) {
    const pickup = leg.stops[0];
    const dropoff = leg.stops[leg.stops.length - 1];
    if (pickup && dropoff && timeMin >= pickup.serviceEndMin && timeMin < dropoff.serviceEndMin) {
      const marker = markers.get(leg.employeeId);
      return marker === undefined ? nodes.get(pickup.nodeId) : { x: marker.x, y: marker.y };
    }
  }

  // The only remaining custody state for a valid relay plan is overnight hub
  // storage after its first drop and before its second pickup completes.
  const hubNodeId = plan.hubId === undefined
    ? undefined
    : plan.legs[0]?.stops[plan.legs[0].stops.length - 1]?.nodeId;
  return hubNodeId === undefined ? origin : nodes.get(hubNodeId) ?? origin;
}

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
  const indexes = indexesFor(run);
  const occurredEvents = indexes.events.slice(0, occurredCount(indexes.events, timeMin));

  const occurredEventIds = new Set(occurredEvents.map((event) => event.id));
  const shipmentStatus: Snapshot['shipmentStatus'] = {};
  const deliveredAtMin: Snapshot['deliveredAtMin'] = {};

  for (const shipment of run.scenario.shipments) {
    const plan = indexes.plansByShipmentId.get(shipment.id);
    if (plan === undefined) {
      shipmentStatus[shipment.id] = 'unmatched';
      continue;
    }

    const shipmentEvents = indexes.eventsByShipmentId.get(shipment.id) ?? [];
    const lastEvent = shipmentEvents[occurredCount(shipmentEvents, timeMin) - 1];
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
      const legEvents = indexes.eventsByJobId.get(jobIdFor(plan.id, legIndex)) ?? [];
      const lastEvent = legEvents[legEvents.length - 1];
      if (lastEvent !== undefined && occurredEventIds.has(lastEvent.id)) {
        earningsCents[leg.employeeId] = (earningsCents[leg.employeeId] ?? 0) + leg.rewardCents;
      }
    });
  }

  for (const job of run.jobs) {
    const plan = indexes.plansById.get(job.planId);
    const jobId = plan === undefined ? job.id : jobIdFor(plan.id, job.legIndex);
    const legEvents = indexes.eventsByJobId.get(jobId) ?? [];
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

  const markersByEmployeeId = new Map<string, MarkerPosition>();

  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) {
      const trip = indexes.tripsById.get(leg.tripId);
      if (trip === undefined || markersByEmployeeId.has(leg.employeeId)) continue;
      const marker = markerForLeg(leg, trip.departureMin, timeMin, indexes.nodes, indexes.durations);
      if (marker === undefined) continue;
      const pickup = leg.stops[0];
      const dropoff = leg.stops[leg.stops.length - 1];
      if (pickup && dropoff && timeMin >= pickup.serviceEndMin && timeMin < dropoff.serviceEndMin) {
        marker.carryingShipmentId = plan.shipmentId;
      }
      markersByEmployeeId.set(leg.employeeId, marker);
    }
  }

  const packagePositions: Snapshot['packagePositions'] = {};
  for (const shipment of run.scenario.shipments) {
    const origin = indexes.nodes.get(indexes.businessesById.get(shipment.originBusinessId)?.nodeId ?? '');
    const destination = indexes.nodes.get(indexes.businessesById.get(shipment.destinationBusinessId)?.nodeId ?? '');
    const position = packagePosition(
      indexes.plansByShipmentId.get(shipment.id), origin, destination, markersByEmployeeId, indexes.nodes, timeMin,
    );
    if (position !== undefined) packagePositions[shipment.id] = position;
  }

  return {
    runId: run.runId,
    version: run.version,
    timeMin,
    shipmentStatus,
    deliveredAtMin,
    jobStatus,
    earningsCents,
    markers: [...markersByEmployeeId.values()].sort((left, right) =>
      left.employeeId.localeCompare(right.employeeId)),
    packagePositions,
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
