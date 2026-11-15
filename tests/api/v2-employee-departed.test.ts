// #791: the Employee job view marks its start row ("Leave work" / "Leave home") done when the commute
// leaves, not when the first stop is handled. `EmployeeJobView.departed` says it: true once the simulation
// minute is at or past the `departureMin` of the job's trip. It is filled by one builder (`buildJobView`,
// server/api/v2/views.ts), so the employee's dashboard row and GET /jobs/:id carry the same flag.
// The job status is untouched: a job is still `assigned` until its first stop ends (DECISIONS pass 3).
// The server is the one of v2-e2e-nyc-helper.ts: the real v2 runtime on the committed `fixtures/nyc`,
// no key, no network, with its state files in a temp folder.
// Only the demo package's label is pinned (the homepage button opens it, docs/mvp3.md P4); its carriers
// and every minute are read from the answers (DECISIONS pass 54).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmployeeDashboard, EmployeeJobView, JobResponse, SimulatorResponse } from '../../shared/v2/api';
import type { Job, Stop } from '../../shared/v2/types';
import { DAY_2_MIN, readCity, recordFetch, startNycApi, type City, type FetchRecorder, type NycApi } from './v2-e2e-nyc-helper';
import { jobRows, momentMinutes, moveClock } from './v2-nyc-consistency-helper';
import { DASH_MAX_BYTES } from './v2-poll-budget-helper';

/** Timeout of every test and hook (DECISIONS pass 19 and 52): each boots a real HTTP server. */
const T = 30_000;

const LABEL = 'Navy Yard grinder burrs';

let net: FetchRecorder;
let api: NycApi;
let city: City;

beforeEach(async () => {
  net = recordFetch();
  api = await startNycApi(net);
  expect(api.runtime.status).toBe('ready');
  city = await readCity(api);
}, T);
afterEach(async () => {
  try {
    net.expectNoOutgoing();
    api?.expectRepoFilesUntouched();
  } finally {
    await api?.close();
    net.restore();
  }
}, T);

const enc = encodeURIComponent;

/** The job as both Employee answers show it at the clock's minute: the dashboard row and GET /jobs/:id. */
async function readJob(job: Job): Promise<{ row: EmployeeJobView; detail: JobResponse; dashboard: EmployeeDashboard }> {
  const dash = await api.get<EmployeeDashboard>(`/employees/${enc(job.employeeId)}/dashboard`);
  expect(dash.status).toBe(200);
  const rows = jobRows(dash.body).filter((r) => r.job.id === job.id);
  expect(rows, `one dashboard row for ${job.id}`).toHaveLength(1);
  const detail = await api.get<JobResponse>(`/jobs/${enc(job.id)}`);
  expect(detail.status).toBe(200);
  return { row: rows[0], detail: detail.body, dashboard: dash.body };
}

type Seen = { departed: boolean | undefined; stopsDone: number | undefined; status: string };

/** Seeks, then reads the job from both answers, which must agree. */
async function jobAt(job: Job, timeMin: number, step: string): Promise<Seen> {
  await moveClock(api, timeMin);
  const { row, detail } = await readJob(job);
  const what = `${step} (minute ${timeMin})`;
  expect(detail.departed, `${what}: GET /jobs/:id and the dashboard agree`).toBe(row.departed);
  expect(detail.stopsDone, what).toBe(row.stopsDone);
  expect(detail.status, what).toBe(row.status);
  return { departed: row.departed, stopsDone: row.stopsDone, status: row.status };
}

/** The leg's stops, as the page lists them (the job's own two when the leg has none). */
const stopsOfJob = (view: EmployeeJobView): Stop[] => {
  const leg = view.plan.legs[view.job.legIndex];
  return leg?.stops?.length ? leg.stops : [view.job.pickup, view.job.dropoff];
};

function watchedJobs(sim: SimulatorResponse): Job[] {
  const labeled = sim.shipments.filter((s) => s.label === LABEL);
  expect(labeled, `deliveries labeled "${LABEL}"`).toHaveLength(1);
  const jobs = sim.jobs.filter((j) => j.shipmentId === labeled[0].id).sort((a, b) => a.legIndex - b.legIndex);
  expect(jobs, `"${LABEL}" is a relay with two jobs`).toHaveLength(2);
  return jobs;
}

describe(`departed of the jobs of "${LABEL}" on the default NYC run (#791)`, () => {
  it('evening leg: false until one minute before the commute leaves, true from its departure minute, while the job is still assigned', async () => {
    const [evening] = watchedJobs(await api.simulator());
    const { detail, dashboard } = await readJob(evening);
    const [pickup, drop] = stopsOfJob(detail);
    expect(detail.trip.direction).toBe('evening');
    expect(detail.trip.id).toBe(evening.tripId);
    // The trip of the job view is the carrier's own trip of the dashboard: one departure for both answers.
    expect(dashboard.trips.find((t) => t.id === evening.tripId)).toStrictEqual(detail.trip);
    const { departureMin } = detail.trip;
    expect(Number.isInteger(departureMin)).toBe(true);
    expect(drop.serviceEndMin).toBeLessThan(DAY_2_MIN);

    // A fresh run stands before the departure.
    expect(city.settings.simStartMin).toBeLessThan(departureMin);
    expect(await jobAt(evening, city.settings.simStartMin, 'the start of the run'))
      .toStrictEqual({ departed: false, stopsDone: 0, status: 'assigned' });
    expect(await jobAt(evening, departureMin - 1, 'one minute before the departure'))
      .toStrictEqual({ departed: false, stopsDone: 0, status: 'assigned' });

    // "At or past": the commute has left from its own `departureMin` on. The handling of the pickup takes
    // time, so at this minute no stop is done and the job is still "assigned": the case the page got wrong.
    expect(departureMin, `the departure (${departureMin}) is before the end of the pickup (${pickup.serviceEndMin})`)
      .toBeLessThan(pickup.serviceEndMin);
    expect(await jobAt(evening, departureMin, 'the departure')).toStrictEqual({ departed: true, stopsDone: 0, status: 'assigned' });
    expect(await jobAt(evening, pickup.serviceEndMin - 1, 'while the pickup is not handled yet'))
      .toStrictEqual({ departed: true, stopsDone: 0, status: 'assigned' });

    // It stays true for the rest of the run.
    expect(await jobAt(evening, pickup.serviceEndMin, 'the pickup is handled')).toStrictEqual({ departed: true, stopsDone: 1, status: 'in_progress' });
    expect(await jobAt(evening, drop.serviceEndMin, 'the drop is handled')).toStrictEqual({ departed: true, stopsDone: 2, status: 'completed' });
    expect((await jobAt(evening, DAY_2_MIN, 'the start of Day 2')).departed).toBe(true);
    expect((await jobAt(evening, city.settings.simEndMin, 'the end of the run')).departed).toBe(true);
    // A seek back takes the mark back: nothing is stored.
    expect((await jobAt(evening, departureMin - 1, 'back to one minute before the departure')).departed).toBe(false);
    expect((await jobAt(evening, departureMin, 'back to the departure')).departed).toBe(true);
  }, T);

  it('morning leg: false overnight while leg 1 is complete, true from its own departure on Day 2', async () => {
    const [evening, morning] = watchedJobs(await api.simulator());
    const { detail } = await readJob(morning);
    const [relayPickup, delivery] = stopsOfJob(detail);
    expect(detail.trip.direction).toBe('morning');
    expect(detail.trip.id).toBe(morning.tripId);
    const { departureMin } = detail.trip;
    expect(departureMin).toBeGreaterThan(DAY_2_MIN);

    // Day 1: the second carrier has not left, whatever the first one does.
    expect((await jobAt(morning, city.settings.simStartMin, 'the start of the run')).departed).toBe(false);
    expect((await jobAt(morning, evening.dropoff.serviceEndMin, 'leg 1 is complete')).departed).toBe(false);
    // Overnight: the first carrier left long ago, the second not yet.
    expect((await jobAt(evening, DAY_2_MIN, 'the start of Day 2, leg 1')).departed).toBe(true);
    expect(await jobAt(morning, DAY_2_MIN, 'the start of Day 2, leg 2')).toStrictEqual({ departed: false, stopsDone: 0, status: 'assigned' });
    expect(await jobAt(morning, departureMin - 1, 'one minute before the morning departure'))
      .toStrictEqual({ departed: false, stopsDone: 0, status: 'assigned' });

    // From its departure on.
    expect(departureMin).toBeLessThan(relayPickup.serviceEndMin);
    expect(await jobAt(morning, departureMin, 'the morning departure')).toStrictEqual({ departed: true, stopsDone: 0, status: 'assigned' });
    expect((await jobAt(morning, departureMin + 1, 'just after the morning departure')).departed).toBe(true);
    expect(await jobAt(morning, relayPickup.serviceEndMin, 'the package is collected')).toStrictEqual({ departed: true, stopsDone: 1, status: 'in_progress' });
    expect(await jobAt(morning, delivery.serviceEndMin, 'the package is handed over')).toStrictEqual({ departed: true, stopsDone: 2, status: 'completed' });
    expect((await jobAt(morning, city.settings.simEndMin, 'the end of the run')).departed).toBe(true);
  }, T);
});

describe('departed of every job of the default NYC run (#791)', () => {
  it('is "the clock is at or past the departure of the job\'s trip", the same in the dashboard and in GET /jobs/:id, at five moments of the run', async () => {
    const start = await api.simulator();
    expect(start.jobs.length).toBeGreaterThan(0);
    const minutes = momentMinutes(start, city.settings);
    const seen = { left: 0, notLeft: 0, leftBeforeAnyStop: 0 };

    for (const timeMin of Object.values(minutes)) {
      const sim = await moveClock(api, timeMin);
      const dashboards = new Map<string, EmployeeDashboard>();
      for (const employeeId of new Set(sim.jobs.map((j) => j.employeeId))) {
        const res = await api.get<EmployeeDashboard>(`/employees/${enc(employeeId)}/dashboard`);
        expect(res.status).toBe(200);
        dashboards.set(employeeId, res.body);
      }
      for (const job of sim.jobs) {
        const what = `job ${job.id} at minute ${timeMin}`;
        const dashboard = dashboards.get(job.employeeId)!;
        const row = jobRows(dashboard).find((r) => r.job.id === job.id);
        expect(row, `${what}: in its employee's dashboard`).toBeDefined();
        const detail = (await api.get<JobResponse>(`/jobs/${enc(job.id)}`)).body;
        // The job's trip: the one GET /jobs/:id sends, which is the carrier's own trip of the dashboard.
        const trip = dashboard.trips.find((t) => t.id === job.tripId);
        expect(trip, `${what}: its trip ${job.tripId}`).toBeDefined();
        expect(detail.trip, what).toStrictEqual(trip);
        const expected = timeMin >= trip!.departureMin;

        expect(row!.departed, what).toBe(expected);
        expect(detail.departed, `${what}: GET /jobs/:id`).toBe(expected);
        // A carrier who handled a stop has left: the flag never trails the stop marks or the status.
        if (row!.stopsDone! > 0) expect(row!.departed, `${what}: ${row!.stopsDone} stops done`).toBe(true);
        if (row!.status !== 'assigned') expect(row!.departed, `${what}: status ${row!.status}`).toBe(true);
        // And the first stop is never before the departure, so the rows of the page read in order.
        expect(stopsOfJob(row!)[0].arrivalMin, what).toBeGreaterThanOrEqual(trip!.departureMin);

        if (expected) seen.left += 1; else seen.notLeft += 1;
        if (expected && row!.stopsDone === 0) seen.leftBeforeAnyStop += 1;
      }
    }
    // The five moments together show jobs whose commute has left and jobs whose commute has not.
    expect(seen.left).toBeGreaterThan(0);
    expect(seen.notLeft).toBeGreaterThan(0);
    console.log(`departed at five moments: ${seen.left} job rows left, ${seen.notLeft} not left, ${seen.leftBeforeAnyStop} left with no stop done yet`);
  }, T);

  it('at the start of the run no commute has left; at the end every one has', async () => {
    const sim = await api.simulator();
    for (const [timeMin, expected] of [[city.settings.simStartMin, false], [city.settings.simEndMin, true]] as const) {
      await moveClock(api, timeMin);
      for (const employeeId of new Set(sim.jobs.map((j) => j.employeeId))) {
        const dashboard = (await api.get<EmployeeDashboard>(`/employees/${enc(employeeId)}/dashboard`)).body;
        for (const row of jobRows(dashboard)) expect(row.departed, `job ${row.job.id} at minute ${timeMin}`).toBe(expected);
      }
    }
  }, T);

  it('adds one true or false per job to the dashboard body, which stays inside the poll byte budget', async () => {
    const minutes = momentMinutes(await api.simulator(), city.settings);
    for (const timeMin of [minutes.start, minutes.evening, minutes.end]) {
      const sim = await moveClock(api, timeMin);
      let rows = 0;
      for (const employeeId of new Set(sim.jobs.map((j) => j.employeeId))) {
        const res = await api.get<EmployeeDashboard>(`/employees/${enc(employeeId)}/dashboard`);
        const dashboard = res.body;
        const strip = (list: EmployeeJobView[]) => list.map(({ departed: _departed, ...rest }) => rest);
        const without = { ...dashboard, assigned: strip(dashboard.assigned), completed: strip(dashboard.completed) };
        const added = JSON.stringify(dashboard).length - JSON.stringify(without).length;
        const count = jobRows(dashboard).length;
        // `,"departed":true` is 16 bytes, `,"departed":false` is 17.
        expect(added, `bytes added to the dashboard of ${employeeId} by ${count} job rows at minute ${timeMin}`).toBeLessThanOrEqual(17 * count);
        expect(added).toBeGreaterThanOrEqual(16 * count);
        for (const row of jobRows(dashboard)) expect(typeof row.departed, `departed of ${row.job.id}`).toBe('boolean');
        // The budget of v2-poll-budget-pages.test.ts, on every carrier's dashboard.
        expect(JSON.stringify(dashboard).length, `dashboard of ${employeeId} at minute ${timeMin}`).toBeLessThanOrEqual(DASH_MAX_BYTES);
        rows += count;
      }
      expect(rows).toBe(sim.jobs.length);
    }
  }, T);
});
