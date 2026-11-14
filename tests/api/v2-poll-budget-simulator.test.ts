// Poll budget of GET /api/v2/simulator on the real NYC run (issue #495). Every MVP II page polls it once a
// second and two or three tabs are open in the demo, so it has the budget of the MVP 1 poll
// (tests/api/poll-budget.test.ts, DECISIONS pass 9): median under 40 ms and body under 150 KB.
// Measured on the committed fixtures/nyc cache (Google times and route lines), on the default run and on the
// largest Random city, at three clock times. This file only measures: it changes no server code.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CLOCK_TIMES, committedRouteLines, POLL_MEDIAN_MS, report, routeLinesIn, RUNS, SIM_MAX_BYTES, startRun, T,
  type PollApi,
} from './v2-poll-budget-helper';
import type { SimulatorResponse } from '../../shared/v2/api';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const routeLines = committedRouteLines();

describe.each(RUNS)('v2 poll budget: GET /api/v2/simulator, $name', ({ kind, name }) => {
  let api: PollApi;
  beforeAll(async () => {
    api = await startRun(kind);
  });
  afterAll(() => api?.close());

  it('the three clock times are before the first event, between events and after the last one', () => {
    const run = api.store.get();
    const [start, evening, end] = CLOCK_TIMES.map((time) => ({ timeMin: time.timeOf(run) }));
    const eventTimes = run.events.map((e) => e.timeMin);
    expect(eventTimes.length).toBeGreaterThan(0);
    expect(run.clock.timeMin).toBe(start.timeMin); // a new run waits at its start
    expect(start.timeMin).toBeLessThan(Math.min(...eventTimes));
    expect(evening.timeMin).toBeGreaterThan(Math.min(...eventTimes));
    expect(evening.timeMin).toBeLessThan(Math.max(...eventTimes));
    expect(end.timeMin).toBeGreaterThanOrEqual(Math.max(...eventTimes));
  }, T);

  // Runs in file order: the clock moves forward from the start of the run to its end.
  it.each(CLOCK_TIMES)('$label: fast, small, no route line, same bytes and version on every poll', async ({ label, timeOf }) => {
    const at = { label, timeMin: timeOf(api.store.get()) };
    const sought = await api.seek(at.timeMin);
    expect(sought.clock.timeMin).toBe(at.timeMin);

    const measured = await api.timed('/simulator'); // `timed` also fails if two of its calls differ by a byte
    report(`${name}, ${at.label} (minute ${at.timeMin})`, 'simulator', measured, SIM_MAX_BYTES);
    expect(measured.median).toBeLessThan(POLL_MEDIAN_MS);
    expect(measured.bytes).toBeLessThan(SIM_MAX_BYTES);

    // The poll we measured is the full view of this clock time, not an empty or early one.
    const body = JSON.parse(measured.text) as SimulatorResponse;
    const run = api.store.get();
    expect(body.clock.timeMin).toBe(at.timeMin);
    expect(body.snapshot.timeMin).toBe(at.timeMin);
    expect(body.shipments).toHaveLength(run.scenario.shipments.length);
    expect(body.plans).toHaveLength(run.assignments.plans.length);
    expect(body.plans.length + body.unmatched.length).toBe(body.shipments.length);
    expect(body.snapshot.occurredEvents).toHaveLength(run.events.filter((e) => e.timeMin <= at.timeMin).length);

    // The 1 s poll carries no route line and no static map data (DECISIONS seed block): those are in GET /map.
    expect(routeLinesIn(measured.text, routeLines)).toBe(0);
    expect(measured.text).not.toContain('"encoded"');
    expect(body).not.toHaveProperty('polylines');
    expect(body).not.toHaveProperty('businesses');
    expect(body).not.toHaveProperty('homes');

    // An unchanged run: 30 polls later the version is the one the seek answered, and one more poll is byte-equal.
    expect(body.version).toBe(sought.version);
    expect(body.runId).toBe(sought.runId);
    expect(api.store.get().version).toBe(sought.version);
    expect(await api.getText('/simulator')).toBe(measured.text);
  }, T);
});

describe('v2 poll budget: the route line check itself', () => {
  it('finds a committed route line in a body that holds one, with its JSON escapes', () => {
    expect(routeLines.length).toBeGreaterThan(0);
    const escaped = routeLines.find((line) => line.includes('\\\\')); // most Google lines hold a backslash
    const sample = escaped ?? routeLines[0];
    const body = JSON.stringify({ polylines: [{ from: 'a', to: 'b', encoded: JSON.parse(`"${sample}"`) }] });
    expect(routeLinesIn(body, routeLines)).toBeGreaterThanOrEqual(1);
    expect(routeLinesIn(JSON.stringify({ plans: [], jobs: [] }), routeLines)).toBe(0);
  }, T);
});
