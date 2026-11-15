import type { Settings } from '../../shared/types.js';

/** Default assumptions for a Relay planning run. All monetary values are cents. */
export const DEFAULT_SETTINGS: Settings = {
  handlingMin: 2,
  defaultMaxExtraMin: 8,
  legRewardCents: 300,
  hubCostCents: 50,
  platformFeeCents: 400,
  flexDiscountCents: 100,
  flexWindowMin: 1080,
  platformVariableCostCents: 50,
  courierPriceCents: 1400,
  simStartMin: 930,
  simEndMin: 2160,
  allowRelay: true,
};

/** What the price reads of a plan: its kind and what each leg pays its carrier. */
export type PricedPlan = { kind: 'direct' | 'relay'; legs: readonly { rewardCents: number }[] };
/** What the price reads of a shipment: its delivery window. */
export type PricedShipment = { readyMin: number; deadlineMin: number };

export function legRewardCents(settings: Settings): number {
  return settings.legRewardCents;
}

/** What the plan's carriers are paid: the sum of its legs' rewards. */
export function carrierPayCents(plan: PricedPlan): number {
  return plan.legs.reduce((sum, leg) => sum + leg.rewardCents, 0);
}

/** A flexible request leaves at least `flexWindowMin` between its ready time and its deadline. */
export function isFlexible(shipment: PricedShipment, settings: Settings): boolean {
  return shipment.deadlineMin - shipment.readyMin >= settings.flexWindowMin;
}

/**
 * The one customer price (issue #861): carrier pay + relay fee (relay plans only) + platform fee,
 * minus the flexibility discount for a flexible request.
 * Defaults: direct $7.00 ($6.00 flexible), relay $10.50 ($9.50 flexible).
 * Every customer price in the app is this function's result, stored as `plan.customerPriceCents`.
 */
export function customerPriceCents(plan: PricedPlan, shipment: PricedShipment, settings: Settings): number {
  return carrierPayCents(plan)
    + (plan.kind === 'relay' ? settings.hubCostCents : 0)
    + settings.platformFeeCents
    - (isFlexible(shipment, settings) ? settings.flexDiscountCents : 0);
}

/**
 * The comparison courier price is an assumption, so never present a negative
 * customer "saving" when a plan's price exceeds it.
 */
export function projectedCustomerSavingsCents(plan: { customerPriceCents: number }, settings: Settings): number {
  return Math.max(0, settings.courierPriceCents - plan.customerPriceCents);
}

/** What is left of the price after carrier pay, the relay fee and the platform's variable cost. */
export function platformContributionCents(plan: PricedPlan, shipment: PricedShipment, settings: Settings): number {
  return customerPriceCents(plan, shipment, settings)
    - carrierPayCents(plan)
    - (plan.kind === 'relay' ? settings.hubCostCents : 0)
    - settings.platformVariableCostCents;
}
