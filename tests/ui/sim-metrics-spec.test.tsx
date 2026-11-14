// Spec §4/§8 metrics cards audit with real Demo-city data.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { snapshotAt } from '../../server/domain/simulation';
import type { Metrics } from '../../shared/types';
import { MetricsCards } from '../../client/src/components/sim/MetricsCards';
import { toMetricCards } from '../../client/src/components/sim/metricsModel';

const run = createInitialRun(loadDefaultScenario());
const { settings } = run.scenario;
const start = snapshotAt(run, settings.simStartMin).metrics;
const end = snapshotAt(run, settings.simEndMin).metrics;
const zero: Metrics = {
  requested: 0, matched: 0, delivered: 0, direct: 0, relay: 0, unmatched: 0,
  avgExtraMinPerTrip: null, maxExtraMin: null,
  earnedRewardsCents: 0, projectedCustomerSavingsCents: 0, projectedCustomerSpendCents: 0,
  projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 0,
};
const base: Metrics = { ...end, requested: 5, matched: 2 };

describe('metrics cards spec §4/§8', () => {
  it('top row order and Projected labels', () => {
    for (const m of [start, end, zero]) {
      const cards = toMetricCards(m);
      expect(cards.slice(0, 5).map((c) => c.key)).toEqual(['delivered', 'matched', 'avgExtra', 'savings', 'rewards']);
      for (const c of cards) {
        if (c.kind === 'projected') expect(c.label.startsWith('Projected')).toBe(true);
        else expect(c.label.startsWith('Projected')).toBe(false);
      }
    }
  });

  it('spend caption names unmatched count', () => {
    const spend = (m: Metrics) => toMetricCards(m).find((c) => c.key === 'spend')!.caption;
    expect(spend({ ...base, unmatched: 3 })).toBe('Includes 3 unmatched packages at the external-delivery cost assumption (not simulated)');
    expect(spend({ ...base, unmatched: 1 })).toMatch(/1 unmatched package at the external-delivery/);
    expect(spend({ ...base, unmatched: 0 })).toMatch(/all packages are matched/i);
  });

  it('renders without NaN/undefined and dashes zero denominators', () => {
    for (const m of [start, end, zero]) {
      const html = renderToStaticMarkup(<MetricsCards metrics={m} />);
      expect(html).not.toMatch(/NaN|undefined/);
      expect(html.indexOf('metric-delivered')).toBeLessThan(html.indexOf('metric-matched'));
    }
    const c = toMetricCards(zero);
    expect(c.find((x) => x.key === 'delivered')!.value).toBe('—');
    expect(c.find((x) => x.key === 'matched')!.value).toBe('—');
  });
});
