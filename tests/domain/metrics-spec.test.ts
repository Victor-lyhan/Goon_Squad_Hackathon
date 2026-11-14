import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Leg, Shipment } from '../../shared/types.js';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun.js';
import { computeMetrics } from '../../server/domain/metrics.js';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing.js';

function shipment(id: string, createdSeq: number): Shipment {
  return {
    id, clientRequestId: `request-${id}`, label: id,
    originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
    readyMin: 930, deadlineMin: 2160, category: 'envelope', description: '',
    weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq,
  };
}

function leg(tripId: string, extraMin: number, extraDistanceM: number, rewardCents = 300): Leg {
  return {
    tripId, employeeId: tripId, routeNodeIds: [], stops: [], finishMin: 1000,
    extraMin, extraDistanceM, rewardCents,
  };
}

function plan(id: string, shipmentId: string, legs: Leg[]): DeliveryPlan {
  return {
    id, shipmentId, kind: 'direct', legs, deliveryMin: 1000,
    customerPriceCents: DEFAULT_SETTINGS.priceCents, platformContributionCents: 650,
  };
}

describe('computeMetrics spec §8', () => {
  it('counts cumulative added time and distance once for each trip', () => {
    const first = plan('plan-shp-1', 'shp-1', [
      leg('emp-1-eve', 4, 400),
      leg('emp-1-eve', 6, 600),
    ]);
    const second = plan('plan-shp-2', 'shp-2', [leg('emp-2-eve', 8, 800)]);

    const metrics = computeMetrics({
      shipments: [shipment('shp-1', 1), shipment('shp-2', 2)],
      plans: [first, second], unmatched: [], occurredEvents: [], settings: DEFAULT_SETTINGS,
    });

    expect(metrics.avgExtraMinPerTrip).toBe(7);
    expect(metrics.maxExtraMin).toBe(8);
    expect(metrics.extraDistanceM).toBe(1400);
  });

  it('includes unmatched demand in spend and never projects negative customer savings', () => {
    const matched = shipment('shp-1', 1);
    const unmatched = shipment('shp-2', 2);
    const settings = { ...DEFAULT_SETTINGS, priceCents: 1500, courierPriceCents: 1400 };

    const metrics = computeMetrics({
      shipments: [matched, unmatched], plans: [plan('plan-shp-1', matched.id, [leg('emp-1-eve', 2, 200)])],
      unmatched: [{ shipmentId: unmatched.id, reason: 'No commute' }], occurredEvents: [], settings,
    });

    expect(metrics.projectedCustomerSpendCents).toBe(2900);
    expect(metrics.projectedCustomerSavingsCents).toBe(0);
  });

  it('reconciles all projected delivery economics when every Demo event has occurred', () => {
    const run = createInitialRun(loadDefaultScenario());
    const metrics = computeMetrics({
      shipments: run.scenario.shipments,
      plans: run.assignments.plans,
      unmatched: run.assignments.unmatched,
      occurredEvents: run.events,
      settings: run.scenario.settings,
    });

    expect(metrics.delivered).toBe(metrics.matched);
    expect(metrics.earnedRewardsCents).toBe(
      run.assignments.plans.flatMap((deliveryPlan) => deliveryPlan.legs)
        .reduce((total, assignedLeg) => total + assignedLeg.rewardCents, 0),
    );
    expect(metrics.earnedPlatformContributionCents).toBe(metrics.projectedPlatformContributionCents);
  });
});
