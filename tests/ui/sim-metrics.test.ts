import { describe, expect, it } from 'vitest';
import type { Metrics } from '../../shared/types';
import { formatCents, formatKm, formatMin, toMetricCards } from '../../client/src/components/sim/metricsModel';

const fixture: Metrics = {
  requested: 1, matched: 1, delivered: 1, direct: 0, relay: 1, unmatched: 0,
  avgExtraMinPerTrip: 5, maxExtraMin: 5,
  earnedRewardsCents: 600, projectedCustomerSavingsCents: 400, projectedCustomerSpendCents: 1100,
  projectedPlatformContributionCents: 300, earnedPlatformContributionCents: 300, extraDistanceM: 1400,
};
const zero: Metrics = {
  requested: 0, matched: 0, delivered: 0, direct: 0, relay: 0, unmatched: 0,
  avgExtraMinPerTrip: null, maxExtraMin: null,
  earnedRewardsCents: 0, projectedCustomerSavingsCents: 0, projectedCustomerSpendCents: 0,
  projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 0,
};
const byKey = (m: Metrics) => Object.fromEntries(toMetricCards(m).map((c) => [c.key, c]));

describe('metrics model', () => {
  it('formats the spec §9 fixture', () => {
    const c = byKey(fixture);
    expect(c.matched.value).toBe('1 / 1');
    expect(c.mix.value).toBe('0 / 1 / 0');
    expect(c.savings.value).toBe('$4.00');
    expect(c.contribution.value).toBe('$3.00');
    expect(c.extraDistance.value).toBe('1.4 km');
    expect(c.delivered.value).toBe('1 / 1');
    expect(c.delivered.kind).toBe('actual');
    expect(c.rewards.value).toBe('$6.00');
    expect(c.earnedContribution.value).toBe('$3.00');
    expect(c.spend.caption).toMatch(/all packages are matched/i);
  });

  it('never emits NaN/undefined for all-zero metrics', () => {
    for (const c of toMetricCards(zero)) {
      expect(JSON.stringify(c)).not.toMatch(/NaN|undefined/);
    }
    const c = byKey(zero);
    expect(c.matched.value).toBe('—');
    expect(c.delivered.value).toBe('—');
    expect(c.avgExtra.value).toBe('—');
    expect(c.mix.value).toBe('0 / 0 / 0');
    expect(c.rewards.value).toBe('$0.00');
  });

  it('labels every projected card Projected', () => {
    for (const m of [fixture, zero]) {
      for (const c of toMetricCards(m).filter((x) => x.kind === 'projected')) {
        expect(`${c.label} ${c.caption}`).toContain('Projected');
      }
    }
  });

  it('formats cents and km', () => {
    expect(formatCents(650)).toBe('$6.50');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(null)).toBe('—');
    expect(formatKm(1400)).toBe('1.4 km');
    expect(formatKm(NaN)).toBe('—');
  });

  it('never renders NaN: null, undefined and non-finite give an em dash', () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      expect(formatCents(bad)).toBe('—');
      expect(formatMin(bad)).toBe('—');
      expect(formatKm(bad)).toBe('—');
    }
    expect(formatMin(6)).toBe('6 min');
    expect(formatMin(65)).toBe('1 h 5 min');
  });
});
