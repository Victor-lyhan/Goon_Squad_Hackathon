import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Settings, Shipment, SimEvent } from '../../shared/types.js';
import { computeMetrics } from '../../server/domain/metrics.js';
import {
  customerPriceCents,
  DEFAULT_SETTINGS,
  legRewardCents,
  platformContributionCents,
} from '../../server/domain/pricing.js';

const settings: Settings = { ...DEFAULT_SETTINGS };

const shipment: Shipment = {
  id: 'shp-1', clientRequestId: 'request-1', label: 'Fixture package',
  originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 960, deadlineMin: 1980, category: 'small_box', description: 'Fixture',
  weightGrams: 500, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
};

const relayPlan: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: shipment.id, kind: 'relay', hubId: 'hub-h',
  deliveryMin: 1961, customerPriceCents: 1000, platformContributionCents: 300,
  legs: [
    {
      tripId: 'emp-1-eve', employeeId: 'emp-1', routeNodeIds: ['A', 'H', 'X'],
      stops: [], finishMin: 1046, extraMin: 6, extraDistanceM: 700, rewardCents: 300,
    },
    {
      tripId: 'emp-2-morn', employeeId: 'emp-2', routeNodeIds: ['Y', 'H', 'B'],
      stops: [], finishMin: 1961, extraMin: 6, extraDistanceM: 700, rewardCents: 300,
    },
  ],
};

function event(kind: SimEvent['kind'], jobId: string): SimEvent {
  return {
    id: `evt-${kind}`, timeMin: 1000, shipmentId: shipment.id, planId: relayPlan.id,
    jobId, kind, employeeId: 'emp-1', seq: 1,
  };
}

describe('pricing assumptions', () => {
  it('uses settings to price a leg, customer charge, and direct/relay contribution', () => {
    expect(legRewardCents(settings)).toBe(300);
    expect(customerPriceCents(settings)).toBe(1000);
    expect(platformContributionCents('direct', settings)).toBe(650);
    expect(platformContributionCents('relay', settings)).toBe(300);
  });
});

describe('computeMetrics', () => {
  it('reports fixture forecasts and rewards legs only after their final stop events', () => {
    const base = { shipments: [shipment], plans: [relayPlan], unmatched: [], settings };

    expect(computeMetrics({ ...base, occurredEvents: [] })).toMatchObject({
      requested: 1, matched: 1, delivered: 0, direct: 0, relay: 1,
      avgExtraMinPerTrip: 6, maxExtraMin: 6, earnedRewardsCents: 0,
      projectedCustomerSavingsCents: 400, projectedCustomerSpendCents: 1000,
      projectedPlatformContributionCents: 300, earnedPlatformContributionCents: 0,
      extraDistanceM: 1400,
    });
    expect(computeMetrics({
      ...base,
      occurredEvents: [event('hub_drop', `${relayPlan.id}-L0`)],
    }).earnedRewardsCents).toBe(300);
    const delivered = computeMetrics({
      ...base,
      occurredEvents: [
        event('hub_drop', `${relayPlan.id}-L0`),
        event('delivered', `${relayPlan.id}-L1`),
      ],
    });
    expect(delivered.earnedRewardsCents).toBe(600);
    expect(delivered.earnedPlatformContributionCents).toBe(300);
    expect(delivered.delivered).toBe(1);
  });

  it('uses null aggregate timing values for no legs and never returns NaN', () => {
    const metrics = computeMetrics({
      shipments: [], plans: [], unmatched: [], occurredEvents: [], settings,
    });

    expect(metrics.avgExtraMinPerTrip).toBeNull();
    expect(metrics.maxExtraMin).toBeNull();
    expect(Object.values(metrics).some((value) => Number.isNaN(value))).toBe(false);
  });
});
