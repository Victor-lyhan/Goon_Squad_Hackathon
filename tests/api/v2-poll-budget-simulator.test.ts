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

/**
 * OVER BUDGET since #761, kept as `it.fails` below with the number unchanged (DECISIONS pass 54; the rule in
 * v2-poll-budget-helper.ts at `LARGEST_RANDOM`). #761 (docs/mvp4.md F2) adds `trips` to the simulator answer:
 * the trips of the employees who drive a plan leg, so a journey can play each carrier's whole commute. In the
 * largest Random city at the end of the day that is 86 trips, 17.1 KB: 158.6 KB instead of 141.5 KB. Every
 * other measurement is inside the budget (the NYC default run, the demo, is at most 75.6 KB; the largest
 * Random city is 128.6 KB before the first event and 138.9 KB mid evening).
 */
const OVER_BUDGET = { kind: 'random', label: 'end of day' } as const;
const overBudget = (kind: string, label: string) => kind === OVER_BUDGET.kind && label === OVER_BUDGET.label;
const tripsBytes = (body: SimulatorResponse) => Buffer.byteLength(`,"trips":${JSON.stringify(body.trips)}`);

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
    const body = JSON.parse(measured.text) as SimulatorResponse;
    if (overBudget(kind, label)) {
      // The one case over the budget (see OVER_BUDGET): `trips` alone puts it there. Everything else in the
      // body is still inside the budget, so nothing else grew.
      expect(measured.bytes - tripsBytes(body)).toBeLessThan(SIM_MAX_BYTES);
    } else {
      expect(measured.bytes).toBeLessThan(SIM_MAX_BYTES);
    }

    // The poll we measured is the full view of this clock time, not an empty or early one.
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

describe('v2 poll budget: over the budget since #761', () => {
  let api: PollApi;
  beforeAll(async () => {
    api = await startRun(OVER_BUDGET.kind);
  });
  afterAll(() => api?.close());

  // Measured 158.6 KB (162,397 bytes) against 150 KB. The fix is a contract decision, so it is not made here:
  // send only `{ id, departureMin }` per trip (about 3.5 KB instead of 17.1 KB), or move `trips` to GET /map,
  // which pages fetch once per run. When it is fixed this test fails: make it a plain `it` again.
  it.fails('largest Random city, end of day: the body is under 150 KB', async () => {
    const run = api.store.get();
    const end = CLOCK_TIMES.find((time) => time.label === OVER_BUDGET.label)!;
    await api.seek(end.timeOf(run));
    const measured = await api.timed('/simulator');
    report(`largest Random city, ${end.label}: OVER BUDGET since #761`, 'simulator', measured, SIM_MAX_BYTES);
    expect(measured.bytes).toBeLessThan(SIM_MAX_BYTES);
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
