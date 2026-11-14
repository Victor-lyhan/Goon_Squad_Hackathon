import {
  planIdFor, type AssignmentResult, type Business, type DeliveryPlan, type Employee, type Hub, type Leg,
  type Settings, type Shipment, type Stop, type Trip,
} from '../../shared/types';
import { customerPriceCents, legRewardCents, platformContributionCents } from './pricing';
import { insertionOptions, type Router } from './routing';

export type MatchContext = {
  router: Router;
  trips: Trip[];
  employees: Employee[];
  businesses: Business[];
  hubs: Hub[];
  settings: Settings;
};

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export type MatchMode = 'with_relay' | 'direct_only';

/** Greedily reserve whole trips, preserving assignments from earlier requests. */
export function assignShipments(
  shipments: Shipment[], ctx: MatchContext, opts?: { existing?: DeliveryPlan[]; mode?: MatchMode },
): AssignmentResult {
  const plans = [...(opts?.existing ?? [])];
  const assigned = new Set(plans.map(plan => plan.shipmentId));
  const reserved = new Set(plans.flatMap(plan => plan.legs.map(leg => leg.tripId)));
  const unmatched: AssignmentResult['unmatched'] = [];
  const pending = shipments.filter(shipment => !assigned.has(shipment.id)).map(shipment => ({
    shipment,
    candidates: shipment.originBusinessId === shipment.destinationBusinessId
      ? [] : generateCandidates(shipment, ctx, opts?.mode),
  })).sort((a, b) => a.candidates.length - b.candidates.length ||
    a.shipment.deadlineMin - b.shipment.deadlineMin || compareId(a.shipment.id, b.shipment.id));

  for (const { shipment, candidates } of pending) {
    const ranked = candidates.map((plan, index) => ({
      plan, index,
      cost: plan.legs.reduce((sum, leg) => sum + leg.rewardCents, 0) +
        (plan.kind === 'relay' ? ctx.settings.hubCostCents : 0),
      extraMin: plan.legs.reduce((sum, leg) => sum + leg.extraMin, 0),
    })).sort((a, b) => a.cost - b.cost || a.extraMin - b.extraMin ||
      a.plan.deliveryMin - b.plan.deliveryMin || a.index - b.index);
    const selected = ranked.find(({ plan }) => plan.legs.every(leg => !reserved.has(leg.tripId)));
    if (selected) {
      plans.push(selected.plan);
      for (const leg of selected.plan.legs) reserved.add(leg.tripId);
    } else {
      unmatched.push({ shipmentId: shipment.id, reason: candidates.length === 0
        ? 'No commute can carry this package within its times and added-time limits'
        : 'Every matching commute is already carrying a package' });
    }
  }

  const createdSeq = new Map(shipments.map(shipment => [shipment.id, shipment.createdSeq]));
  // Existing plans may belong to shipments outside this batch; retain those too.
  plans.sort((a, b) =>
    (createdSeq.get(a.shipmentId) ?? Infinity) - (createdSeq.get(b.shipmentId) ?? Infinity) ||
    compareId(a.shipmentId, b.shipmentId));
  return { plans, unmatched, computeMs: 0 };
}

/** Compare fresh allocations without reserving trips from any live assignments. */
export function compareAssignments(
  shipments: Shipment[], ctx: MatchContext,
): { directOnly: AssignmentResult; withRelay: AssignmentResult } {
  return {
    directOnly: assignShipments(shipments, ctx, { mode: 'direct_only' }),
    withRelay: assignShipments(shipments, ctx, { mode: 'with_relay' }),
  };
}

/** One stop is inserted; the other is the employer endpoint of the commute. */
function scheduleLeg(
  ctx: MatchContext, trip: Trip, employee: Employee, addedNodeId: string,
  pickupKind: 'pickup' | 'hub_pickup', dropKind: 'hub_drop' | 'delivery',
  readyMin: number, deadlineMin: number,
): Leg | null {
  const evening = trip.direction === 'evening';
  for (const option of insertionOptions(ctx.router, trip.baselineNodeIds, addedNodeId)) {
    const pickupIndex = evening ? 0 : option.stopRouteIndex;
    const dropIndex = evening ? option.stopRouteIndex : option.routeNodeIds.length - 1;
    let time = trip.departureMin;
    const stops: Stop[] = [];
    let reachable = true;
    for (let i = 0; i < option.routeNodeIds.length; i++) {
      if (i > 0) {
        const segment = ctx.router.shortestPath(option.routeNodeIds[i - 1], option.routeNodeIds[i]);
        if (!segment) { reachable = false; break; }
        time += segment.durationMin;
      }
      // Separate checks deliberately handle pickup and drop at the same node.
      for (const [index, kind] of [[pickupIndex, pickupKind], [dropIndex, dropKind]] as const) {
        if (i !== index) continue;
        const arrivalMin = time;
        const serviceStartMin = kind === pickupKind ? Math.max(time, readyMin) : time;
        time = serviceStartMin + ctx.settings.handlingMin;
        stops.push({ nodeId: option.routeNodeIds[i], kind, arrivalMin, serviceStartMin, serviceEndMin: time });
      }
    }
    const extraMin = time - (trip.departureMin + trip.baselineDurationMin);
    if (!reachable || stops.length !== 2 || extraMin > employee.maxExtraMin ||
      stops[1].serviceEndMin > deadlineMin) continue;
    return {
      tripId: trip.id, employeeId: employee.id, routeNodeIds: option.routeNodeIds,
      stops, finishMin: time, extraMin, extraDistanceM: option.extraDistanceM,
      rewardCents: legRewardCents(ctx.settings),
    };
  }
  return null;
}

/** Enumerates candidates only; trip reservation belongs to allocation. */
export function generateCandidates(
  shipment: Shipment, ctx: MatchContext, mode: MatchMode = 'with_relay',
): DeliveryPlan[] {
  const origin = ctx.businesses.find(business => business.id === shipment.originBusinessId);
  const destination = ctx.businesses.find(business => business.id === shipment.destinationBusinessId);
  if (!origin || !destination) return [];
  const employees = new Map(ctx.employees.map(employee => [employee.id, employee]));
  const eligible = (direction: Trip['direction'], businessId: string) => ctx.trips.flatMap(trip => {
    const employee = employees.get(trip.employeeId);
    return trip.direction === direction && employee?.businessId === businessId ? [{ trip, employee }] : [];
  });
  const evenings = eligible('evening', origin.id);
  const mornings = eligible('morning', destination.id);
  const candidates: DeliveryPlan[] = [];
  const addPlan = (kind: DeliveryPlan['kind'], legs: Leg[], hubId?: string) => {
    candidates.push({
      id: planIdFor(shipment.id), shipmentId: shipment.id, kind, legs,
      ...(hubId === undefined ? {} : { hubId }),
      deliveryMin: legs[legs.length - 1].stops[1].serviceEndMin,
      customerPriceCents: customerPriceCents(ctx.settings),
      platformContributionCents: platformContributionCents(kind, ctx.settings),
    });
  };
  for (const { trip, employee } of [...evenings, ...mornings]) {
    const leg = scheduleLeg(ctx, trip, employee,
      trip.direction === 'evening' ? destination.nodeId : origin.nodeId,
      'pickup', 'delivery', shipment.readyMin, shipment.deadlineMin);
    if (leg) addPlan('direct', [leg]);
  }
  if (mode === 'with_relay' && ctx.settings.allowRelay) {
    for (const hub of ctx.hubs) {
      const deposits = evenings.flatMap(({ trip, employee }) => {
        const leg = scheduleLeg(ctx, trip, employee, hub.nodeId, 'pickup', 'hub_drop',
          shipment.readyMin, shipment.deadlineMin);
        return leg ? [leg] : [];
      });
      for (const deposit of deposits) {
        for (const { trip, employee } of mornings) {
          if (employee.id === deposit.employeeId) continue;
          const collection = scheduleLeg(ctx, trip, employee, hub.nodeId, 'hub_pickup', 'delivery',
            Math.max(shipment.readyMin, deposit.stops[1].serviceEndMin), shipment.deadlineMin);
          if (collection) addPlan('relay', [deposit, collection], hub.id);
        }
      }
    }
  }
  return candidates.sort((a, b) => compareId(a.kind, b.kind) ||
    compareId(a.legs[0].tripId, b.legs[0].tripId) ||
    compareId(a.legs[1]?.tripId ?? '', b.legs[1]?.tripId ?? '') ||
    compareId(a.hubId ?? '', b.hubId ?? ''));
}
