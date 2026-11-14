import { describe, expect, it } from 'vitest';
import {
  NO_GAIN_LINE, NO_REQUESTS_LINE, compareRows, compareSummary,
} from '../../client/src/components/sim/v2/compare/compareModelV2';
import { formatCents, formatDuration } from '../../client/src/ui/format';
import type { CompareResponse } from '../../shared/v2/api';
import { allUnmatchedCompare, buildCompare, equalSidesCompare, relayGainCompare } from './sim-v2-compare-fixture';

const byKey = (c: CompareResponse) => Object.fromEntries(compareRows(c).map((r) => [r.key, r]));
const cells = (c: CompareResponse) => compareRows(c).flatMap((r) => [r.label, r.direct, r.relay]);

describe('compareRows on a real compareAssignments response', () => {
  const response = relayGainCompare();

  it('is built from a real relay match (sanity check of the fixture)', () => {
    expect(response.withRelay.result.plans.some((p) => p.kind === 'relay')).toBe(true);
    expect(response.directOnly.result.plans.every((p) => p.kind === 'direct')).toBe(true);
  });

  it('prints every number straight from the response metrics', () => {
    const d = response.directOnly.metrics;
    const r = response.withRelay.metrics;
    const rows = byKey(response);
    expect(rows.matched).toMatchObject({ direct: `${d.matched} / ${d.requested}`, relay: `${r.matched} / ${r.requested}`, emphasis: true });
    expect(rows.matched.direct).toBe('1 / 2');
    expect(rows.matched.relay).toBe('2 / 2');
    expect(rows.direct).toMatchObject({ direct: String(d.direct), relay: String(r.direct) });
    expect(rows.relay).toMatchObject({ direct: '0', relay: String(r.relay) });
    expect(rows.unmatched).toMatchObject({ direct: String(d.unmatched), relay: String(r.unmatched) });
    expect(rows.avgExtra).toMatchObject({
      direct: formatDuration(d.avgExtraMinPerTrip!), relay: formatDuration(r.avgExtraMinPerTrip!),
    });
    expect(rows.platform).toMatchObject({
      direct: formatCents(d.projectedPlatformContributionCents), relay: formatCents(r.projectedPlatformContributionCents),
    });
  });

  it('has the rows in a fixed order with relay-point wording', () => {
    expect(compareRows(response).map((r) => r.key)).toEqual(['matched', 'direct', 'relay', 'unmatched', 'avgExtra', 'platform']);
    expect(compareRows(response).map((r) => r.label)).toContain('Relay point plans');
  });

  it('headline is the difference of the two displayed matched counts', () => {
    expect(compareSummary(response)).toEqual({ line: '+1 matched with relay points', tone: 'gain' });
  });

  it('follows the response, not a hard-coded number', () => {
    const doubled: CompareResponse = {
      ...response,
      withRelay: { ...response.withRelay, metrics: { ...response.withRelay.metrics, matched: 5, requested: 7 } },
    };
    expect(byKey(doubled).matched.relay).toBe('5 / 7');
    expect(compareSummary(doubled).line).toBe('+4 matched with relay points');
  });

  it('never prints hub, NaN, undefined or an empty cell', () => {
    for (const c of [response, allUnmatchedCompare(), equalSidesCompare()]) {
      for (const cell of cells(c)) {
        expect(cell).not.toBe('');
        expect(cell).not.toMatch(/hub|NaN|undefined|null|synthetic/i);
      }
      expect(compareSummary(c).line).not.toMatch(/hub|NaN|undefined/i);
    }
  });
});

describe('compareRows edge cases', () => {
  it('all unmatched: zero plans print "0", "0 min" and "$0.00"', () => {
    const response = allUnmatchedCompare();
    expect(response.withRelay.result.plans).toEqual([]);
    expect(response.withRelay.metrics.avgExtraMinPerTrip).toBeNull();
    const rows = byKey(response);
    expect(rows.matched).toMatchObject({ direct: '0 / 2', relay: '0 / 2' });
    expect(rows.direct).toMatchObject({ direct: '0', relay: '0' });
    expect(rows.relay).toMatchObject({ direct: '0', relay: '0' });
    expect(rows.unmatched).toMatchObject({ direct: '2', relay: '2' });
    expect(rows.avgExtra).toMatchObject({ direct: '0 min', relay: '0 min' });
    expect(rows.platform).toMatchObject({ direct: '$0.00', relay: '$0.00' });
    expect(compareSummary(response)).toEqual({ line: NO_GAIN_LINE, tone: 'neutral' });
  });

  it('equal sides: "Relay points add no matches in this scenario"', () => {
    const response = equalSidesCompare();
    const rows = byKey(response);
    expect(rows.matched.direct).toBe(rows.matched.relay);
    expect(compareSummary(response)).toEqual({ line: 'Relay points add no matches in this scenario', tone: 'neutral' });
  });

  it('no requests at all says so instead of a delta', () => {
    const response = buildCompare([], { 'biz-a': 0, 'biz-b': 5 }, []);
    expect(byKey(response).matched).toMatchObject({ direct: '0 / 0', relay: '0 / 0' });
    expect(compareSummary(response)).toEqual({ line: NO_REQUESTS_LINE, tone: 'neutral' });
  });

  it('a relay side matching fewer is reported as a loss, never a negative "+"', () => {
    const base = equalSidesCompare();
    const fewer: CompareResponse = {
      ...base, withRelay: { ...base.withRelay, metrics: { ...base.withRelay.metrics, matched: 0 } },
    };
    expect(compareSummary(fewer)).toEqual({ line: '1 delivery fewer matched with relay points', tone: 'loss' });
  });

  it('a null average next to matched plans prints a dash, not "NaN min"', () => {
    const base = equalSidesCompare();
    const gap: CompareResponse = {
      ...base, withRelay: { ...base.withRelay, metrics: { ...base.withRelay.metrics, avgExtraMinPerTrip: null } },
    };
    expect(byKey(gap).avgExtra.relay).toBe('—');
  });
});
