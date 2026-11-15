// The best plan of each kind for one shipment (#954): the best DIRECT plan and the best RELAY plan, each by
// `rankCandidates` over `generateCandidates` filtered by kind, keeping the trips of `existing` plans reserved,
// exactly as `assignShipments` would pick among the candidates of that kind. When a kind has no plan, its
// reason in plain words, from the matcher's own rules (the same relaxations `unmatchedReason` of matching.ts
// tries: a later deadline, an earlier ready time, a larger added-time limit). Read-only and pure: nothing is
// reserved, nothing is stored. The advisor (server/ai/advisor.ts) shows both kinds next to each other.
import { pairKey, type DeliveryPlan, type Shipment } from '../../../shared/v2/types';
import { generateCandidates, rankCandidates, type MatchContext } from './matching';

export type PlanKind = DeliveryPlan['kind'];
export type KindAnswer = { plan: DeliveryPlan } | { reason: string };
export type KindAnswers = Record<PlanKind, KindAnswer>;

/** The same per-allocation travel cache as `assignShipments`: the relaxations revisit the same pairs. */
function memoized(ctx: MatchContext): MatchContext {
  const { travel } = ctx;
  const memo = (lookup: (from: string, to: string) => number) => {
    const cache = new Map<string, number>();
    return (from: string, to: string): number => {
      const key = pairKey(from, to);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const value = lookup(from, to); // a missing pair still throws, and is not cached
      cache.set(key, value);
      return value;
    };
  };
  return { ...ctx, travel: {
    durationMin: memo((from, to) => travel.durationMin(from, to)),
    distanceM: memo((from, to) => travel.distanceM(from, to)),
    polyline: (from, to) => travel.polyline(from, to),
  } };
}

const ofKind = (shipment: Shipment, ctx: MatchContext, kind: PlanKind) =>
  generateCandidates(shipment, ctx, kind === 'direct' ? 'direct_only' : 'with_relay').filter((plan) => plan.kind === kind);

/**
 * The best direct plan and the best relay plan for `shipment` against the run's reserved trips, or for each
 * kind the reason it has none. Candidates are generated once for both kinds.
 */
export function bestPlansByKind(shipment: Shipment, context: MatchContext, existing: readonly DeliveryPlan[] = []): KindAnswers {
  const ctx = memoized(context);
  const reserved = new Set(existing.flatMap((plan) => plan.legs.map((leg) => leg.tripId)));
  const free = (plan: DeliveryPlan) => plan.legs.every((leg) => !reserved.has(leg.tripId));
  const all = shipment.originBusinessId === shipment.destinationBusinessId ? [] : generateCandidates(shipment, ctx, 'with_relay');
  const answer = (kind: PlanKind): KindAnswer => {
    const candidates = all.filter((plan) => plan.kind === kind);
    const best = rankCandidates(candidates, ctx.settings).find(free);
    if (best) return { plan: best };
    return { reason: candidates.length > 0 ? busyReason(kind, shipment, ctx, candidates, reserved) : noPlanReason(kind, shipment, ctx) };
  };
  return { direct: answer('direct'), relay: answer('relay') };
}

/** Names of the two businesses (the ids when a business is missing; the route checks they exist). */
function names(shipment: Shipment, ctx: MatchContext) {
  const name = (id: string) => ctx.businesses.find((b) => b.id === id)?.name ?? id;
  return { origin: name(shipment.originBusinessId), destination: name(shipment.destinationBusinessId) };
}

/** The kind has plans, but each uses a trip that already carries a package: which commutes are taken. */
function busyReason(
  kind: PlanKind, shipment: Shipment, ctx: MatchContext, candidates: readonly DeliveryPlan[], reserved: ReadonlySet<string>,
): string {
  const { origin, destination } = names(shipment, ctx);
  const evenings = `Every evening commute from ${origin} is already carrying a package`;
  const mornings = `Every morning commute to ${destination} is already carrying a package`;
  if (kind === 'relay') {
    if (candidates.every((plan) => reserved.has(plan.legs[0].tripId))) return evenings;
    if (candidates.every((plan) => reserved.has(plan.legs[1].tripId))) return mornings;
    return 'Every pair of commutes that could relay it is already carrying a package';
  }
  const direction = (plan: DeliveryPlan) => ctx.trips.find((trip) => trip.id === plan.legs[0].tripId)?.direction;
  if (candidates.every((plan) => direction(plan) === 'evening')) return evenings;
  if (candidates.every((plan) => direction(plan) === 'morning')) return mornings;
  return 'Every commute that could carry it is already carrying a package';
}

/** The kind has no candidate at all: the first rule that stops it, checked as the matcher checks them. */
function noPlanReason(kind: PlanKind, shipment: Shipment, ctx: MatchContext): string {
  const { origin, destination } = names(shipment, ctx);
  if (shipment.originBusinessId === shipment.destinationBusinessId) return 'Sender and recipient must be different businesses';
  const employees = new Map(ctx.employees.map((e) => [e.id, e]));
  const tripsOf = (direction: 'evening' | 'morning', businessId: string) =>
    ctx.trips.filter((trip) => trip.direction === direction && employees.get(trip.employeeId)?.businessId === businessId);
  const evenings = tripsOf('evening', shipment.originBusinessId);
  const mornings = tripsOf('morning', shipment.destinationBusinessId);

  if (kind === 'relay') {
    if (!ctx.settings.allowRelay) return 'Relays are turned off for this run';
    const hubs = ctx.businesses.filter((b) => b.id !== shipment.originBusinessId && b.id !== shipment.destinationBusinessId);
    if (hubs.length === 0) return 'There is no third business to relay through';
    if (evenings.length === 0) return `No one at ${origin} has an evening commute`;
    if (mornings.length === 0) return `No one at ${destination} has a morning commute`;
  } else if (evenings.length === 0 && mornings.length === 0) {
    return `No one at ${origin} has an evening commute and no one at ${destination} has a morning commute`;
  }

  const has = (s: Shipment, c: MatchContext) => ofKind(s, c, kind).length > 0;
  if (has({ ...shipment, deadlineMin: Infinity }, ctx)) {
    return kind === 'relay' ? 'A relay cannot arrive before the deadline' : 'No commute can arrive before the deadline';
  }
  if (has({ ...shipment, readyMin: -Infinity }, ctx)) {
    return kind === 'relay'
      ? `No evening commute from ${origin} leaves after the package is ready`
      : 'No commute leaves after the package is ready';
  }
  const relaxed = { ...ctx, employees: ctx.employees.map((e) => ({ ...e, maxExtraMin: Infinity })) };
  const trip = kind === 'relay' ? 'A relay' : 'A direct trip';
  const overLimit = ofKind(shipment, relaxed, kind);
  if (overLimit.length > 0) {
    // The highest limit of any carrier on these plans: when every plan has a leg over it, name it as the number.
    const limit = Math.max(...overLimit.flatMap((plan) => plan.legs.map((leg) => employees.get(leg.employeeId)?.maxExtraMin ?? 0)));
    return overLimit.every((plan) => plan.legs.some((leg) => leg.extraMin > limit))
      ? `${trip} would add more than ${limit} minutes to a commute`
      : `${trip} would be a longer detour than its carrier allows`;
  }
  if (has({ ...shipment, deadlineMin: Infinity }, relaxed)) {
    return `${trip} needs a later deadline and a longer detour than carriers allow`;
  }
  return kind === 'relay' ? 'No two commutes can meet at a relay point' : 'No commute can stop at both businesses';
}
