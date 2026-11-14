import { jobIdFor } from '../../shared/types';
import type { DeliveryPlan, Hub, Job, SimEvent, SimEventKind, StopKind } from '../../shared/types';

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
