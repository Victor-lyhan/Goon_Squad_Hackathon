// #531: the MVP II metrics are deterministic on the REAL committed NYC cache. Two independent builds give
// equal numbers at every minute, reading the minutes in another order gives the same numbers, and the
// comparison gives the same two halves twice. Only `computeMs` is measured and may differ.
import { describe, expect, it } from 'vitest';
import type { Run } from '../../shared/v2/types';
import {
  METRICS_TIMEOUT_MS, NYC_RUNS, buildNycRun, compareNycRun, momentAt, sweep,
} from './metrics-v2-nyc-helper';

/** A run without its one measured value. */
const withoutTiming = (run: Run) => ({ ...run, assignments: { ...run.assignments, computeMs: 0 } });

describe.each(NYC_RUNS)('MVP II metrics are deterministic: $title', ({ request }) => {
  it('two builds from the same files give the same run and equal metrics at every minute', () => {
    const first = buildNycRun(request);
    const second = buildNycRun(request);
    expect(second.run).not.toBe(first.run);
    expect(withoutTiming(second.run)).toEqual(withoutTiming(first.run));

    const firstMetrics = sweep(first).map(moment => moment.metrics);
    const secondMetrics = sweep(second).map(moment => moment.metrics);
    expect(secondMetrics).toEqual(firstMetrics);
    // Not only equal as values: equal as the JSON the API sends (key order included).
    expect(JSON.stringify(secondMetrics)).toBe(JSON.stringify(firstMetrics));
  }, METRICS_TIMEOUT_MS);

  it('a minute read after later minutes gives the same numbers: seeking back keeps nothing', () => {
    const built = buildNycRun(request);
    const forward = sweep(built);
    // Every minute at which something happens, the minute before it and the two ends, latest first.
    const minutes = [...new Set([
      forward[0]!.timeMin, forward.at(-1)!.timeMin,
      ...built.run.events.flatMap(event => [event.timeMin - 1, event.timeMin]),
    ])].sort((a, b) => b - a);
    for (const timeMin of minutes) {
      const again = momentAt(built, timeMin);
      const before = forward[timeMin - forward[0]!.timeMin]!;
      expect(before.timeMin).toBe(timeMin);
      expect(again.metrics, `minute ${timeMin}`).toEqual(before.metrics);
      expect(again.computed, `minute ${timeMin}`).toEqual(before.metrics);
    }
  }, METRICS_TIMEOUT_MS);

  it('the comparison gives the same two halves twice, and leaves the run as it was', () => {
    const built = buildNycRun(request); // frozen: a comparison that changed the run would throw
    const before = JSON.stringify(built.run);
    const first = compareNycRun(built);
    const second = compareNycRun(buildNycRun(request));
    for (const half of ['directOnly', 'withRelay'] as const) {
      expect(second[half].metrics, half).toEqual(first[half].metrics);
      expect(second[half].result.plans, half).toEqual(first[half].result.plans);
      expect(second[half].result.unmatched, half).toEqual(first[half].result.unmatched);
    }
    expect(JSON.stringify(built.run)).toBe(before);
  }, METRICS_TIMEOUT_MS);
});
