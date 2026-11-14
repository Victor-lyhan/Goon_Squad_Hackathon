import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparePanel } from '../../client/src/components/sim/ComparePanel';
import { SetupDrawer } from '../../client/src/components/sim/SetupDrawer';
import { FIELD_RANGES, defaultForm, toCompareRows, validateSetup, type NumericField } from '../../client/src/components/sim/setupModel';
import { GenerateScenarioRequest } from '../../shared/schemas';
import type { CompareResponse } from '../../shared/api';
import type { Metrics } from '../../shared/types';

const m = (o: Partial<Metrics>): Metrics => ({
  requested: 10, matched: 5, delivered: 0, direct: 5, relay: 0, unmatched: 5,
  avgExtraMinPerTrip: 4, maxExtraMin: 8, earnedRewardsCents: 0, projectedCustomerSavingsCents: 1000,
  projectedCustomerSpendCents: 5000, projectedPlatformContributionCents: 0, earnedPlatformContributionCents: 0, extraDistanceM: 0, ...o,
});
const side = (metrics: Metrics) => ({ result: { plans: [], unmatched: [], computeMs: 1 }, metrics });
const sample = (d: Partial<Metrics>, r: Partial<Metrics>): CompareResponse => ({ directOnly: side(m(d)), withRelay: side(m(r)) });

describe('sim setup: validation', () => {
  it('defaults come from the schema and validate', () => {
    const v = validateSetup(defaultForm());
    expect(v.ok).toBe(true);
    expect(v.request).toEqual(GenerateScenarioRequest.parse({ preset: 'demo' }));
  });
  it('blank fields are errors for Random', () => {
    const v = validateSetup({ ...defaultForm(), preset: 'random', seed: '', packages: '' });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['packages', 'seed']);
  });
  it('ranges match the schema boundaries', () => {
    for (const [f, r] of Object.entries(FIELD_RANGES) as [NumericField, (typeof FIELD_RANGES)[NumericField]][]) {
      if (r.min === undefined || r.max === undefined) continue;
      for (const [val, ok] of [[r.min, true], [r.max, true], [r.min - 1, false], [r.max + 1, false]] as const) {
        expect(validateSetup({ ...defaultForm(), preset: 'random', [f]: String(val) }).ok, `${f}=${val}`).toBe(ok);
      }
    }
  });
  it('reports inline errors for bad input', () => {
    const v = validateSetup({ ...defaultForm(), preset: 'random', employees: '5', hubs: 'abc', seed: '1.5' });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['employees', 'hubs', 'seed']);
    expect(v.errors.employees).toMatch(/10 to 200/);
  });
});

describe('sim setup: compare', () => {
  it('shows the relay advantage', () => {
    const rows = Object.fromEntries(toCompareRows(sample({}, { matched: 8, relay: 3, direct: 5, avgExtraMinPerTrip: 6, projectedCustomerSavingsCents: 1900 })).map((r) => [r.key, r]));
    expect(rows.matched.direct).toBe('5 / 10');
    expect(rows.matched.relay).toBe('8 / 10');
    expect(rows.matched.diff).toBe('+3 packages matched with relay');
    expect(rows.avgExtra.diff).toBe('+2 min');
    expect(rows.savings.diff).toBe('+$9.00');
  });
  it('renders side by side and never NaN for null metrics', () => {
    const html = renderToStaticMarkup(<ComparePanel compare={sample({ avgExtraMinPerTrip: null }, { avgExtraMinPerTrip: null, matched: 6 })} />);
    expect(html).toContain('Direct only');
    expect(html).toContain('With relay');
    expect(html).toContain('+1 package matched with relay');
    expect(html).toContain('—');
    expect(html).not.toMatch(/NaN|undefined|null/);
  });
});

describe('sim setup: drawer', () => {
  it('renders all controls when open and nothing when closed', () => {
    expect(renderToStaticMarkup(<SetupDrawer open={false} onClose={() => {}} onChanged={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(<SetupDrawer open onClose={() => {}} onChanged={() => {}} />);
    for (const t of ['Compare', 'Generate city', 'Export JSON', 'Import JSON', 'Start new planning cycle', 'Seed', 'Employees', 'Packages', 'Hubs', 'Max added minutes']) {
      expect(html).toContain(t);
    }
  });
});
