import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Shipment } from '../../shared/v2/types.js';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';
import { computeMetrics } from '../../server/domain/v2/metrics.js';

const shipment = (id: string): Shipment => ({
  id, clientRequestId: id, label: id, originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 0,
  deadlineMin: 100, category: 'envelope', description: '', weightGrams: 1, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
});
const plan: DeliveryPlan = {
  id: 'plan-a', shipmentId: 'shp-a', kind: 'direct', deliveryMin: 20, customerPriceCents: 700, platformContributionCents: 350,
  legs: [{ tripId: 'trip-a', employeeId: 'emp-a', placeIds: [], stops: [
    { placeId: 'biz-a', kind: 'pickup', arrivalMin: 8, serviceStartMin: 8, serviceEndMin: 10 },
    { placeId: 'biz-b', kind: 'delivery', arrivalMin: 18, serviceStartMin: 18, serviceEndMin: 20 },
  ], finishMin: 20, extraMin: 5, extraDistanceM: 500, rewardCents: 300 }],
};

function expectFinite(metrics: ReturnType<typeof computeMetrics>): void {
  for (const value of Object.values(metrics)) expect(value === null || Number.isFinite(value)).toBe(true);
}

describe('v2 computeMetrics', () => {
  it('uses null averages for no trips and never returns undefined or NaN', () => {
    const metrics = computeMetrics({ shipments: [shipment('shp-u')], plans: [], unmatched: [{ shipmentId: 'shp-u', reason: 'none' }], occurredEvents: [], settings: DEFAULT_SETTINGS });
    expect(metrics.avgExtraMinPerTrip).toBeNull();
    expect(metrics.maxExtraMin).toBeNull();
    expect(metrics.extraDistanceM).toBe(0);
    expectFinite(metrics);
  });

  it('keeps actuals at zero before delivery and realizes all values after delivery', () => {
    const base = { shipments: [shipment('shp-a')], plans: [plan], unmatched: [], settings: DEFAULT_SETTINGS };
    const projected = computeMetrics({ ...base, occurredEvents: [] });
    const complete = computeMetrics({ ...base, occurredEvents: buildTimeline([plan], []) });

    expect(projected).toMatchObject({ requested: 1, matched: 1, delivered: 0, direct: 1, relay: 0, avgExtraMinPerTrip: 5, maxExtraMin: 5, earnedRewardsCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 500 });
    expect(complete).toMatchObject({ delivered: 1, earnedRewardsCents: 300, projectedPlatformContributionCents: 350, earnedPlatformContributionCents: 350 });
    expectFinite(projected);
    expectFinite(complete);
  });
});
