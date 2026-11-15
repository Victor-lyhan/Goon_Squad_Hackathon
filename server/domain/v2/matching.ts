import {
  pairKey, planIdFor, type AssignmentResult, type NetworkBusiness, type DeliveryPlan, type Employee, type Leg,
  type TravelProvider, type Settings, type Shipment, type Stop, type Trip,
} from '../../../shared/v2/types';
import { customerPriceCents, legRewardCents, platformContributionCents } from '../pricing';

export type MatchContext = {
  travel: TravelProvider;
  trips: Trip[];
  employees: Employee[];
  businesses: NetworkBusiness[];
  settings: Settings;
};

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export type MatchMode = 'with_relay' | 'direct_only';

/** What the two candidate sorts read. The story explainer sorts its rows with them too. */
export type RankableCandidate = Pick<DeliveryPlan, 'kind' | 'legs' | 'deliveryMin' | 'relayBusinessId'>;

/** Generation order of candidates: kind, trip IDs, relay business. */
export function compareCandidates(a: RankableCandidate, b: RankableCandidate): number {
  return compareId(a.kind, b.kind) ||
    compareId(a.legs[0].tripId, b.legs[0].tripId) ||
    compareId(a.legs[1]?.tripId ?? '', b.legs[1]?.tripId ?? '') ||
    compareId(a.relayBusinessId ?? '', b.relayBusinessId ?? '');
}

/** Allocation order: cheapest, least added time, earliest delivery, then the given order. */
export function rankCandidates<T extends RankableCandidate>(candidates: readonly T[], settings: Settings): T[] {
  return candidates.map((plan, index) => ({
    plan, index,
    cost: plan.legs.reduce((sum, leg) => sum + leg.rewardCents, 0) +
      (plan.kind === 'relay' ? settings.hubCostCents : 0),
    extraMin: plan.legs.reduce((sum, leg) => sum + leg.extraMin, 0),
  })).sort((a, b) => a.cost - b.cost || a.extraMin - b.extraMin ||
    a.plan.deliveryMin - b.plan.deliveryMin || a.index - b.index).map(ranked => ranked.plan);
}

/** Greedily reserve whole trips, preserving assignments from earlier requests. */
export function assignShipments(
  shipments: Shipment[], ctx: MatchContext, opts?: { existing?: DeliveryPlan[]; mode?: MatchMode },
): AssignmentResult {
  // Relay pairing and unmatched diagnosis revisit the same ordered pairs.
  // Scope these caches to this allocation: commute saves can update the provider.
  const travel = ctx.travel;
  const memoize = (lookup: (from: string, to: string) => number) => {
    const cache = new Map<string, number>();
    return (from: string, to: string): number => {
      const key = pairKey(from, to);
      if (cache.has(key)) return cache.get(key)!;
      const value = lookup(from, to); // Missing pairs still throw; never cache failures.
      cache.set(key, value);
      return value;
    };
  };
  ctx = { ...ctx, travel: {
    durationMin: memoize((from, to) => travel.durationMin(from, to)),
    distanceM: memoize((from, to) => travel.distanceM(from, to)),
    polyline: (from, to) => travel.polyline(from, to),
  } };
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
    const selected = rankCandidates(candidates, ctx.settings)
      .find(plan => plan.legs.every(leg => !reserved.has(leg.tripId)));
    if (selected) {
      plans.push(selected);
      for (const leg of selected.legs) reserved.add(leg.tripId);
    } else {
      unmatched.push({ shipmentId: shipment.id, reason: candidates.length === 0
        ? unmatchedReason(shipment, ctx, opts?.mode)
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

/** Diagnose only failed shipments, using the same scheduling rules as matching.
 * Prefer a deadline fix, then readiness, then a larger added-time allowance.
 * Check structural failures first, then relax constraints to explain feasibility.
 */
function unmatchedReason(shipment: Shipment, ctx: MatchContext, mode?: MatchMode): string {
  if (shipment.originBusinessId === shipment.destinationBusinessId) {
    return 'Sender and recipient must be different businesses';
  }
  const origin = ctx.businesses.find(business => business.id === shipment.originBusinessId);
  const destination = ctx.businesses.find(business => business.id === shipment.destinationBusinessId);
  if (!origin || !destination) return 'Sender or recipient business is missing';
  if (ctx.employees.length === 0) return 'No employees are available to carry packages';
  if (ctx.trips.length === 0) return 'No commute is available after the package is ready';
  if (!ctx.trips.some(trip => ctx.employees.some(employee => employee.id === trip.employeeId &&
    employee.businessId === (trip.direction === 'evening' ? origin.id : destination.id)))) {
    return 'No sender evening commute or recipient morning commute is available';
  }
  if (shipment.deadlineMin - shipment.readyMin < 2 * ctx.settings.handlingMin) {
    return 'The delivery window is too short for pickup and delivery handling';
  }
  if (generateCandidates({ ...shipment, deadlineMin: Infinity }, ctx, mode).length) {
    return 'No commute can arrive before the deadline';
  }
  if (generateCandidates({ ...shipment, readyMin: -Infinity }, ctx, mode).length) {
    return 'No commute is available after the package is ready';
  }
  const relaxed = { ...ctx, employees: ctx.employees.map(employee => ({ ...employee, maxExtraMin: Infinity })) };
  if (generateCandidates(shipment, relaxed, mode).length) {
    return "Every route would exceed the employees' added-time limit";
  }
  if (generateCandidates({ ...shipment, deadlineMin: Infinity }, relaxed, mode).length) {
    return 'Delivery requires both a later deadline and a larger added-time limit';
  }
  return 'No available commute route can visit the required pickup and drop-off stops';
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

/** Schedule the two business services and the complete commute, including waiting.
 * Null when the leg breaks a rule: no finite route, over the carrier's limit, or past the deadline.
 */
export function scheduleLeg(
  ctx: MatchContext, trip: Trip, employee: Employee, addedPlaceId: string,
  pickupKind: 'pickup' | 'hub_pickup', dropKind: 'hub_drop' | 'delivery',
  readyMin: number, deadlineMin: number,
): Leg | null {
  const evening = trip.direction === 'evening';
  const placeIds = [trip.originPlaceId, addedPlaceId, trip.destinationPlaceId];
  const pickupIndex = evening ? 0 : 1;
  const dropIndex = evening ? 1 : 2;
  let time = trip.departureMin;
  let distanceM = 0;
  const stops: Stop[] = [];
  for (let i = 0; i < placeIds.length; i++) {
    if (i > 0) {
      time += ctx.travel.durationMin(placeIds[i - 1], placeIds[i]);
      distanceM += ctx.travel.distanceM(placeIds[i - 1], placeIds[i]);
    }
    if (i === pickupIndex || i === dropIndex) {
      const arrivalMin = time;
      const serviceStartMin = i === pickupIndex ? Math.max(time, readyMin) : time;
      time = serviceStartMin + ctx.settings.handlingMin;
      stops.push({ placeId: placeIds[i], kind: i === pickupIndex ? pickupKind : dropKind,
        arrivalMin, serviceStartMin, serviceEndMin: time });
    }
  }
  const extraMin = time - trip.departureMin - trip.baselineDurationMin;
  if (!Number.isFinite(time) || extraMin > employee.maxExtraMin ||
    stops[1].serviceEndMin > deadlineMin) return null;
  return {
    tripId: trip.id, employeeId: employee.id,
    placeIds: placeIds.filter((place, i) => i === 0 || place !== placeIds[i - 1]),
    stops, finishMin: time, extraMin, extraDistanceM: distanceM - trip.baselineDistanceM,
    rewardCents: legRewardCents(ctx.settings),
  };
}

/** Enumerates candidates only; trip reservation belongs to allocation. */
export function generateCandidates(
  shipment: Shipment, ctx: MatchContext, mode: MatchMode = 'with_relay',
): DeliveryPlan[] {
  const origin = ctx.businesses.find(business => business.id === shipment.originBusinessId);
  const destination = ctx.businesses.find(business => business.id === shipment.destinationBusinessId);
  if (!origin || !destination || origin.id === destination.id) return [];
  const employees = new Map(ctx.employees.map(employee => [employee.id, employee]));
  const eligible = (direction: Trip['direction'], businessId: string) => ctx.trips.flatMap(trip => {
    const employee = employees.get(trip.employeeId);
    return trip.direction === direction && employee?.businessId === businessId ? [{ trip, employee }] : [];
  });
  const evenings = eligible('evening', origin.id);
  const mornings = eligible('morning', destination.id);
  const candidates: DeliveryPlan[] = [];
  const addPlan = (kind: DeliveryPlan['kind'], legs: Leg[], relayBusinessId?: string) => {
    candidates.push({
      id: planIdFor(shipment.id), shipmentId: shipment.id, kind, legs,
      ...(relayBusinessId === undefined ? {} : { relayBusinessId }),
      deliveryMin: legs[legs.length - 1].stops[1].serviceEndMin,
      customerPriceCents: customerPriceCents({ kind, legs }, shipment, ctx.settings),
      platformContributionCents: platformContributionCents({ kind, legs }, shipment, ctx.settings),
    });
  };
  for (const { trip, employee } of [...evenings, ...mornings]) {
    const leg = scheduleLeg(ctx, trip, employee,
      trip.direction === 'evening' ? destination.id : origin.id,
      'pickup', 'delivery', shipment.readyMin, shipment.deadlineMin);
    if (leg) addPlan('direct', [leg]);
  }
  if (mode === 'with_relay' && ctx.settings.allowRelay) {
    for (const hub of ctx.businesses.filter(business => business.id !== origin.id && business.id !== destination.id)) {
      const deposits = evenings.flatMap(({ trip, employee }) => {
        const leg = scheduleLeg(ctx, trip, employee, hub.id, 'pickup', 'hub_drop',
          shipment.readyMin, shipment.deadlineMin);
        return leg ? [leg] : [];
      });
      for (const deposit of deposits) {
        for (const { trip, employee } of mornings) {
          if (employee.id === deposit.employeeId) continue;
          const collection = scheduleLeg(ctx, trip, employee, hub.id, 'hub_pickup', 'delivery',
            Math.max(shipment.readyMin, deposit.stops[1].serviceEndMin), shipment.deadlineMin);
          if (collection) addPlan('relay', [deposit, collection], hub.id);
        }
      }
    }
  }
  return candidates.sort(compareCandidates);
}
