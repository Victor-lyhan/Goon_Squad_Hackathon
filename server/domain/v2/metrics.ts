import type {
  DeliveryPlan,
  Metrics,
  Settings,
  Shipment,
  SimEvent,
  UnmatchedReason,
} from '../../../shared/v2/types.js';
import { projectedCustomerSavingsCents } from '../pricing.js';

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

/** Computes planning forecasts and elapsed simulation totals for MVP II plans. */
export function computeMetrics(input: ComputeMetricsInput): Metrics {
  const { shipments, plans, unmatched, occurredEvents, settings } = input;
  const extrasByTrip = new Map<string, { extraMin: number; extraDistanceM: number }>();
  for (const leg of plans.flatMap((plan) => plan.legs)) {
    const prior = extrasByTrip.get(leg.tripId);
    extrasByTrip.set(leg.tripId, {
      extraMin: Math.max(prior?.extraMin ?? 0, leg.extraMin),
      extraDistanceM: Math.max(prior?.extraDistanceM ?? 0, leg.extraDistanceM),
    });
  }
  const tripExtras = [...extrasByTrip.values()];
  const deliveredPlanIds = new Set(
    occurredEvents.filter((event) => event.kind === 'delivered').map((event) => event.planId),
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
    earnedRewardsCents: plans.reduce((total, plan) => total + plan.legs.reduce(
      (planTotal, leg, legIndex) => planTotal + (
        legWasCompleted(plan, legIndex, occurredEvents) ? leg.rewardCents : 0
      ),
      0,
    ), 0),
    projectedCustomerSavingsCents: plans.length * projectedCustomerSavingsCents(settings),
    projectedCustomerSpendCents: plans.length * settings.priceCents
      + unmatched.length * settings.courierPriceCents,
    projectedPlatformContributionCents: plans.reduce(
      (total, plan) => total + plan.platformContributionCents,
      0,
    ),
    earnedPlatformContributionCents: plans.reduce(
      (total, plan) => total + (
        deliveredPlanIds.has(plan.id) ? plan.platformContributionCents : 0
      ),
      0,
    ),
    extraDistanceM: tripExtras.reduce((total, trip) => total + trip.extraDistanceM, 0),
  };
}
