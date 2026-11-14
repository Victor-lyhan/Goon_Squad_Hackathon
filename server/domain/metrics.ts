import type {
  DeliveryPlan,
  Metrics,
  Settings,
  Shipment,
  SimEvent,
  UnmatchedReason,
} from '../../shared/types.js';

export type ComputeMetricsInput = {
  shipments: Shipment[];
  plans: DeliveryPlan[];
  unmatched: UnmatchedReason[];
  occurredEvents: SimEvent[];
  settings: Settings;
};

function legWasCompleted(plan: DeliveryPlan, legIndex: number, events: SimEvent[]): boolean {
  const completionKind = plan.kind === 'relay' && legIndex === 0 ? 'hub_drop' : 'delivered';
  const jobId = `${plan.id}-L${legIndex}`;
  return events.some((event) =>
    event.planId === plan.id && event.jobId === jobId && event.kind === completionKind);
}

/**
 * Computes planning forecasts and simulation-to-date results without mutating a run.
 * A carrier earns only after the event at the final stop of their assigned leg.
 */
export function computeMetrics(input: ComputeMetricsInput): Metrics {
  const { shipments, plans, unmatched, occurredEvents, settings } = input;
  const legs = plans.flatMap((plan) => plan.legs);
  // matching.scheduleLeg defines extraMin as the augmented trip finish minus
  // that trip's baseline finish, so it is cumulative for the whole trip (not
  // incremental per leg). A trip is normally reserved after one leg, but use
  // the greatest cumulative values if imported data contains it more than once.
  const extraByTripId = new Map<string, { extraMin: number; extraDistanceM: number }>();
  for (const leg of legs) {
    const current = extraByTripId.get(leg.tripId);
    extraByTripId.set(leg.tripId, {
      extraMin: Math.max(current?.extraMin ?? 0, leg.extraMin),
      extraDistanceM: Math.max(current?.extraDistanceM ?? 0, leg.extraDistanceM),
    });
  }
  const tripExtras = [...extraByTripId.values()];
  // Key actuals by plan, rather than only shipment ID. This keeps an event
  // from an unrelated/stale plan from making a current plan look delivered.
  const deliveredPlanIds = new Set(
    occurredEvents
      .filter((event) => event.kind === 'delivered')
      .map((event) => event.planId),
  );

  const earnedRewardsCents = plans.reduce(
    (total, plan) => total + plan.legs.reduce(
      (planTotal, leg, legIndex) => planTotal + (
        legWasCompleted(plan, legIndex, occurredEvents) ? leg.rewardCents : 0
      ),
      0,
    ),
    0,
  );

  const projectedPlatformContributionCents = plans.reduce(
    (total, plan) => total + plan.platformContributionCents,
    0,
  );

  return {
    requested: shipments.length,
    matched: plans.length,
    delivered: plans.filter((plan) => deliveredPlanIds.has(plan.id)).length,
    direct: plans.filter((plan) => plan.kind === 'direct').length,
    relay: plans.filter((plan) => plan.kind === 'relay').length,
    unmatched: unmatched.length,
    avgExtraMinPerTrip: tripExtras.length === 0
      ? null
      : tripExtras.reduce((total, trip) => total + trip.extraMin, 0) / tripExtras.length,
    maxExtraMin: tripExtras.length === 0 ? null : Math.max(...tripExtras.map((trip) => trip.extraMin)),
    earnedRewardsCents,
    projectedCustomerSavingsCents: plans.length * Math.max(
      0,
      settings.courierPriceCents - settings.priceCents,
    ),
    projectedCustomerSpendCents: plans.length * settings.priceCents
      + unmatched.length * settings.courierPriceCents,
    projectedPlatformContributionCents,
    earnedPlatformContributionCents: plans.reduce(
      (total, plan) => total + (
        deliveredPlanIds.has(plan.id) ? plan.platformContributionCents : 0
      ),
      0,
    ),
    extraDistanceM: tripExtras.reduce((total, trip) => total + trip.extraDistanceM, 0),
  };
}
