import type { Settings } from '../../shared/types.js';

/** Default assumptions for a Relay planning run. All monetary values are cents. */
export const DEFAULT_SETTINGS: Settings = {
  handlingMin: 2,
  defaultMaxExtraMin: 8,
  priceCents: 1000,
  legRewardCents: 300,
  hubCostCents: 50,
  platformVariableCostCents: 50,
  courierPriceCents: 1400,
  simStartMin: 930,
  simEndMin: 2160,
  allowRelay: true,
};

export function legRewardCents(settings: Settings): number {
  return settings.legRewardCents;
}

export function customerPriceCents(settings: Settings): number {
  return settings.priceCents;
}

/**
 * The comparison courier price is an assumption, so never present a negative
 * customer "saving" when an edited Relay price exceeds it.
 */
export function projectedCustomerSavingsCents(settings: Settings): number {
  return Math.max(0, settings.courierPriceCents - settings.priceCents);
}

export function platformContributionCents(
  kind: 'direct' | 'relay',
  settings: Settings,
): number {
  const legCount = kind === 'relay' ? 2 : 1;
  return settings.priceCents
    - legCount * settings.legRewardCents
    - (kind === 'relay' ? settings.hubCostCents : 0)
    - settings.platformVariableCostCents;
}
