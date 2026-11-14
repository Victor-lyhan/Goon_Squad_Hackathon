import { describe, expect, it } from 'vitest';
import type { Metrics, Scenario } from '../../shared/types.js';
import { createInitialRun } from '../../server/api/initialRun.js';
import { generateScenario } from '../../server/domain/generator.js';
import { computeMetrics } from '../../server/domain/metrics.js';

const DEFAULT_OPTIONS = {
  preset: 'random' as const,
  employees: 60,
  packages: 24,
  hubs: 6,
  maxExtraMin: 8,
};

const centFields: Array<keyof Pick<Metrics,
  | 'earnedRewardsCents'
  | 'projectedCustomerSavingsCents'
  | 'projectedCustomerSpendCents'
  | 'projectedPlatformContributionCents'
  | 'earnedPlatformContributionCents'
>> = [
  'earnedRewardsCents',
  'projectedCustomerSavingsCents',
  'projectedCustomerSpendCents',
  'projectedPlatformContributionCents',
  'earnedPlatformContributionCents',
];

function expectSaneMetrics(metrics: Metrics): void {
  for (const value of Object.values(metrics)) {
    expect(value === null || (typeof value === 'number' && Number.isFinite(value))).toBe(true);
  }
  for (const field of centFields) expect(Number.isInteger(metrics[field])).toBe(true);
  expect(metrics.delivered).toBeLessThanOrEqual(metrics.matched);
  expect(metrics.matched).toBeLessThanOrEqual(metrics.requested);
}

function assertTimelineMetrics(scenario: Scenario, expectsAllUnmatched = false): void {
  const run = createInitialRun(scenario);
  if (expectsAllUnmatched) {
    expect(run.assignments.plans).toHaveLength(0);
    expect(run.assignments.unmatched).toHaveLength(scenario.shipments.length);
  }

  const minutes = [...new Set([
    scenario.settings.simStartMin,
    ...run.events.map((event) => event.timeMin),
    scenario.settings.simEndMin,
  ])].sort((left, right) => left - right);
  let priorDelivered = 0;
  let priorEarnings = 0;
  let finish: Metrics | undefined;

  for (const timeMin of minutes) {
    const metrics = computeMetrics({
      shipments: scenario.shipments,
      plans: run.assignments.plans,
      unmatched: run.assignments.unmatched,
      occurredEvents: run.events.filter((event) => event.timeMin <= timeMin),
      settings: scenario.settings,
    });
    expectSaneMetrics(metrics);
    expect(metrics.delivered).toBeGreaterThanOrEqual(priorDelivered);
    expect(metrics.earnedRewardsCents).toBeGreaterThanOrEqual(priorEarnings);
    priorDelivered = metrics.delivered;
    priorEarnings = metrics.earnedRewardsCents;
    if (timeMin === scenario.settings.simEndMin) finish = metrics;
  }

  expect(finish).toBeDefined();
  expect(finish!.delivered).toBe(finish!.matched);
  expect(finish!.earnedRewardsCents).toBe(
    run.assignments.plans.flatMap((plan) => plan.legs)
      .reduce((total, leg) => total + leg.rewardCents, 0),
  );
  expect(finish!.earnedPlatformContributionCents).toBe(
    finish!.projectedPlatformContributionCents,
  );
}

describe('computeMetrics event-minute timeline properties', () => {
  it('stays finite and monotonic for default seeds, zero hubs, and all-unmatched demand', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      assertTimelineMetrics(generateScenario({ ...DEFAULT_OPTIONS, seed }));
    }

    assertTimelineMetrics(generateScenario({ ...DEFAULT_OPTIONS, seed: 21, hubs: 0 }));
    assertTimelineMetrics(generateScenario({ ...DEFAULT_OPTIONS, seed: 22, maxExtraMin: 0 }), true);
  }, 4_500);
});
