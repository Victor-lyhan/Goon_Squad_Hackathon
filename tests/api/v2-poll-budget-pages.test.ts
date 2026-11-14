// Poll budget of the other MVP II page requests on the real NYC run (issue #495):
// - GET /api/v2/businesses/:id/dashboard and GET /api/v2/employees/:id/dashboard are polled once a second by
//   the Business and Employee pages: median under 40 ms and body under 100 KB, with no route line in them.
// - GET /api/v2/map is fetched once per run and holds every route line: its size is reported, limit 2 MB.
// Measured on the committed fixtures/nyc cache, on the default run and on the largest Random city, for the
// busiest business and the busiest carrier (found from the data), at three clock times.
// This file only measures: it changes no server code.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CLOCK_TIMES, committedRouteLines, DASH_MAX_BYTES, kb, MAP_MAX_BYTES, POLL_MEDIAN_MS, report, routeLinesIn, RUNS,
  startRun, T, type PollApi,
} from './v2-poll-budget-helper';
import type { BusinessDashboard, EmployeeDashboard, MapResponse, SimulatorResponse } from '../../shared/v2/api';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const routeLines = committedRouteLines();

/** The key with the highest count; equal counts go to the smaller ID, so the choice never depends on order. */
function busiest(counts: Map<string, number>): { id: string; count: number } {
  const [id, count] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return { id, count };
}

const countBy = (ids: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

/** The business with the most packages sent or received, and the employee with the most carrying jobs. */
function busiestOf(sim: SimulatorResponse) {
  return {
    business: busiest(countBy(sim.shipments.flatMap((s) => [s.originBusinessId, s.destinationBusinessId]))),
    carrier: busiest(countBy(sim.jobs.map((j) => j.employeeId))),
  };
}

describe.each(RUNS)('v2 poll budget: dashboards and map, $name', ({ kind, name }) => {
  let api: PollApi;
  let business: { id: string; count: number };
  let carrier: { id: string; count: number };

  beforeAll(async () => {
    api = await startRun(kind);
    ({ business, carrier } = busiestOf(await api.simulator()));
  });
  afterAll(() => api?.close());

  it('the busiest business and the busiest carrier are found from the run', async () => {
    const run = api.store.get();
    expect(run.scenario.businesses.map((b) => b.id)).toContain(business.id);
    expect(run.scenario.employees.map((e) => e.id)).toContain(carrier.id);
    expect(carrier.count).toBeGreaterThanOrEqual(1);

    // No other business has more rows on its dashboard and no other employee has more jobs.
    const rowsOf = (id: string) =>
      run.scenario.shipments.filter((s) => s.originBusinessId === id).length +
      run.scenario.shipments.filter((s) => s.destinationBusinessId === id).length;
    expect(rowsOf(business.id)).toBe(business.count);
    expect(Math.max(...run.scenario.businesses.map((b) => rowsOf(b.id)))).toBe(business.count);
    const jobsOf = (id: string) => run.jobs.filter((j) => j.employeeId === id).length;
    expect(Math.max(...run.scenario.employees.map((e) => jobsOf(e.id)))).toBe(carrier.count);
    console.log(`${name}: busiest business ${business.id} (${business.count} packages sent or received), busiest carrier ${carrier.id} (${carrier.count} jobs)`);
  }, T);

  it('GET /api/v2/map holds the route lines and stays under 2 MB', async () => {
    const measured = await api.timed('/map');
    const map = JSON.parse(measured.text) as MapResponse;
    const withLine = map.polylines.filter((p) => p.encoded !== null).length;
    console.log(
      `${name}: map ${kb(measured.bytes)} (budget ${kb(MAP_MAX_BYTES)}), median ${measured.median.toFixed(1)} ms (no budget: fetched once per run), ` +
      `${map.polylines.length} route pairs, ${withLine} with a cached line`,
    );
    expect(measured.bytes).toBeLessThan(MAP_MAX_BYTES);

    expect(map.runId).toBe(api.store.get().runId);
    expect(map.polylines.length).toBeGreaterThan(0);
    // Every line the map sends is a line of the committed cache, and the check used on the polls finds them here.
    const sent = new Set(map.polylines.flatMap((p) => (p.encoded === null ? [] : [JSON.stringify(p.encoded).slice(1, -1)])));
    expect(routeLinesIn(measured.text, routeLines)).toBe(sent.size);
    for (const line of sent) expect(routeLines).toContain(line);
    // The default run's commutes and plan legs were fetched for the cache, so its map really carries lines.
    if (kind === 'nyc') expect(withLine).toBeGreaterThan(0);
  }, T);

  // Runs in file order: the clock moves forward from the start of the run to its end.
  it.each(CLOCK_TIMES)('$label: both dashboards are fast, small, without a route line, and the same on every poll', async ({ label, timeOf }) => {
    const at = { label, timeMin: timeOf(api.store.get()) };
    const sought = await api.seek(at.timeMin);
    expect(sought.clock.timeMin).toBe(at.timeMin);
    const where = `${name}, ${at.label} (minute ${at.timeMin})`;

    const pages = [
      { what: `business dashboard ${business.id}`, url: `/businesses/${business.id}/dashboard` },
      { what: `employee dashboard ${carrier.id}`, url: `/employees/${carrier.id}/dashboard` },
    ];
    for (const page of pages) {
      const measured = await api.timed(page.url); // `timed` also fails if two of its calls differ by a byte
      report(where, page.what, measured, DASH_MAX_BYTES);
      expect(measured.median, page.what).toBeLessThan(POLL_MEDIAN_MS);
      expect(measured.bytes, page.what).toBeLessThan(DASH_MAX_BYTES);

      // No route line and no map data on the 1 s poll.
      expect(routeLinesIn(measured.text, routeLines), page.what).toBe(0);
      expect(measured.text).not.toContain('"encoded"');
      expect(measured.text).not.toContain('"polylines"');

      // An unchanged run: the version is the one the seek answered, and one more poll is byte-equal.
      const body = JSON.parse(measured.text) as BusinessDashboard | EmployeeDashboard;
      expect(body.version, page.what).toBe(sought.version);
      expect(await api.getText(page.url), page.what).toBe(measured.text);
    }
    expect(api.store.get().version).toBe(sought.version);

    // What we measured are the full pages of the busiest accounts, not empty ones.
    const biz = JSON.parse(await api.getText(pages[0].url)) as BusinessDashboard;
    expect(biz.business.id).toBe(business.id);
    expect(biz.outgoing.length + biz.incoming.length).toBe(business.count);
    const emp = JSON.parse(await api.getText(pages[1].url)) as EmployeeDashboard;
    expect(emp.employee.id).toBe(carrier.id);
    expect(emp.assigned.length + emp.completed.length).toBe(carrier.count);
  }, T);
});
