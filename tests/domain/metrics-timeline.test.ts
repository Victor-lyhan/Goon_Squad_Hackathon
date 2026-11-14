import { beforeAll, describe, expect, it } from 'vitest';
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

const TIMELINE_CASES = [
  ...Array.from({ length: 20 }, (_, index) => ({
    name: `seed ${index + 1}`,
    options: { ...DEFAULT_OPTIONS, seed: index + 1 },
    expectsAllUnmatched: false,
  })),
  {
    name: 'zero hubs',
    options: { ...DEFAULT_OPTIONS, seed: 21, hubs: 0 },
    expectsAllUnmatched: false,
  },
  {
    name: 'all-unmatched demand',
    options: { ...DEFAULT_OPTIONS, seed: 22, maxExtraMin: 0 },
    expectsAllUnmatched: true,
  },
] as const;

// Each city's local runtime is measured below 500 ms; 1.5 s leaves at least
// three times that headroom while preventing a single slow city from timing out
// the entire generated-city coverage set in CI.
const CITY_TIMEOUT_MS = 1_500;

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

function assertTimelineMetrics(scenario: Scenario, run: ReturnType<typeof createInitialRun>, expectsAllUnmatched = false): void {
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
  const occurredEvents = [];
  let eventIndex = 0;

  for (const timeMin of minutes) {
    while (eventIndex < run.events.length && run.events[eventIndex].timeMin <= timeMin) {
      occurredEvents.push(run.events[eventIndex]);
      eventIndex += 1;
    }
    const metrics = computeMetrics({
      shipments: scenario.shipments,
      plans: run.assignments.plans,
      unmatched: run.assignments.unmatched,
      occurredEvents,
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
  const runs = new Map<string, { scenario: Scenario; run: ReturnType<typeof createInitialRun> }>();

  beforeAll(() => {
    for (const testCase of TIMELINE_CASES) {
      const scenario = generateScenario(testCase.options);
      runs.set(testCase.name, { scenario, run: createInitialRun(scenario) });
    }
  }, 30_000);

  it.each(TIMELINE_CASES)('stays finite and monotonic for $name', ({ name, expectsAllUnmatched }) => {
    const { scenario, run } = runs.get(name)!;
    assertTimelineMetrics(scenario, run, expectsAllUnmatched);
  }, CITY_TIMEOUT_MS);
});
