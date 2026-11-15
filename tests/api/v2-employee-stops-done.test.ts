// #781: the Employee job view marks each stop done from the server's count, not from a guess off the job
// status. `EmployeeJobView.stopsDone` is how many of the job's leg stops, in order, have a `serviceEndMin`
// at or before the simulation minute. It is filled by one builder (`buildJobView`, server/api/v2/views.ts),
// so the employee's dashboard row and GET /jobs/:id carry the same number.
// The server is the one of v2-e2e-nyc-helper.ts: the real v2 runtime on the committed `fixtures/nyc`,
// no key, no network, with its state files in a temp folder.
// Only the demo package's label is pinned (the homepage button opens it, docs/mvp3.md P4); its carriers
// and every minute are read from the answers (DECISIONS pass 54).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmployeeDashboard, EmployeeJobView, JobResponse, SimulatorResponse } from '../../shared/v2/api';
import type { Job, Stop } from '../../shared/v2/types';
import { DAY_2_MIN, readCity, recordFetch, startNycApi, type City, type FetchRecorder, type NycApi } from './v2-e2e-nyc-helper';
import { jobRows, jobViewOf, momentMinutes, moveClock, simulatorJob } from './v2-nyc-consistency-helper';

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

/** Seeks, then reads `stopsDone` from both answers, which must agree. */
async function stopsDoneAt(job: Job, timeMin: number, step: string): Promise<{ stopsDone: number | undefined; status: string }> {
  await moveClock(api, timeMin);
  const { row, detail } = await readJob(job);
  expect(detail.stopsDone, `${step} (minute ${timeMin}): GET /jobs/:id and the dashboard agree`).toBe(row.stopsDone);
  expect(detail.status, `${step} (minute ${timeMin})`).toBe(row.status);
  return { stopsDone: row.stopsDone, status: row.status };
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

describe(`stopsDone of the jobs of "${LABEL}" on the default NYC run (#781)`, () => {
  it('evening leg: 0 before and just after the commute leaves, 1 once the pickup is handled, 2 after the drop at the relay point', async () => {
    const [evening] = watchedJobs(await api.simulator());
    const { detail } = await readJob(evening);
    const [pickup, drop] = stopsOfJob(detail);
    expect(stopsOfJob(detail)).toHaveLength(2);
    expect([pickup.kind, drop.kind]).toStrictEqual(['pickup', 'hub_drop']);
    expect(detail.trip.direction).toBe('evening');
    const { departureMin } = detail.trip;
    expect(drop.serviceEndMin).toBeLessThan(DAY_2_MIN);

    // The commute has left and the pickup is not handled yet: this minute must exist for the test to mean anything.
    const justLeft = departureMin + 1;
    expect(justLeft, `a minute between the departure (${departureMin}) and the end of the pickup (${pickup.serviceEndMin})`)
      .toBeLessThan(pickup.serviceEndMin);

    // A fresh run stands before the departure.
    expect(city.settings.simStartMin).toBeLessThan(departureMin);
    expect(await stopsDoneAt(evening, city.settings.simStartMin, 'before the departure')).toStrictEqual({ stopsDone: 0, status: 'assigned' });
    expect((await stopsDoneAt(evening, justLeft, 'just after the departure')).stopsDone).toBe(0);
    expect((await stopsDoneAt(evening, pickup.serviceEndMin - 1, 'while the pickup is handled')).stopsDone).toBe(0);
    // "At or before the simulation minute": the pickup counts from its own `serviceEndMin` on.
    expect(await stopsDoneAt(evening, pickup.serviceEndMin, 'the pickup is handled')).toStrictEqual({ stopsDone: 1, status: 'in_progress' });
    expect((await stopsDoneAt(evening, pickup.serviceEndMin + 1, 'just after the pickup')).stopsDone).toBe(1);
    expect((await stopsDoneAt(evening, drop.serviceEndMin - 1, 'while the drop is handled')).stopsDone).toBe(1);
    expect(await stopsDoneAt(evening, drop.serviceEndMin, 'the drop is handled')).toStrictEqual({ stopsDone: 2, status: 'completed' });
    expect((await stopsDoneAt(evening, drop.serviceEndMin + 1, 'after the drop')).stopsDone).toBe(2);
    // A seek back takes the marks back: nothing is stored.
    expect((await stopsDoneAt(evening, justLeft, 'back to just after the departure')).stopsDone).toBe(0);
  }, T);

  it('morning leg: 0 overnight while leg 1 is complete, then 1 and 2 on Day 2', async () => {
    const [evening, morning] = watchedJobs(await api.simulator());
    const { detail } = await readJob(morning);
    const [relayPickup, delivery] = stopsOfJob(detail);
    expect([relayPickup.kind, delivery.kind]).toStrictEqual(['hub_pickup', 'delivery']);

    // Overnight: the first carrier's two stops are done, the second carrier's none.
    expect((await stopsDoneAt(evening, DAY_2_MIN, 'the start of Day 2, leg 1')).stopsDone).toBe(2);
    expect(await stopsDoneAt(morning, DAY_2_MIN, 'the start of Day 2, leg 2')).toStrictEqual({ stopsDone: 0, status: 'assigned' });
    expect((await stopsDoneAt(morning, detail.trip.departureMin + 1, 'just after the morning departure')).stopsDone)
      .toBe(relayPickup.serviceEndMin <= detail.trip.departureMin + 1 ? 1 : 0);
    expect((await stopsDoneAt(morning, relayPickup.serviceEndMin, 'the package is collected')).stopsDone).toBe(1);
    expect(await stopsDoneAt(morning, delivery.serviceEndMin, 'the package is handed over')).toStrictEqual({ stopsDone: 2, status: 'completed' });
  }, T);
});

describe('stopsDone of every job of the default NYC run (#781)', () => {
  it('is the count of the leg\'s stops handled by the clock\'s minute, the same in the dashboard and in GET /jobs/:id, at five moments of the run', async () => {
    const start = await api.simulator();
    expect(start.jobs.length).toBeGreaterThan(0);
    const minutes = momentMinutes(start, city.settings);
    const seen = new Set<number>();

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
        const row = jobRows(dashboards.get(job.employeeId)!).find((r) => r.job.id === job.id);
        expect(row, `${what}: in its employee's dashboard`).toBeDefined();
        const detail = (await api.get<JobResponse>(`/jobs/${enc(job.id)}`)).body;
        const stops = stopsOfJob(row!);
        const expected = stops.filter((s) => s.serviceEndMin <= timeMin).length;

        expect(row!.stopsDone, what).toBe(expected);
        expect(detail.stopsDone, `${what}: GET /jobs/:id`).toBe(expected);
        // The count and the status tell one story (DECISIONS pass 3).
        expect(row!.status, what).toBe(expected === 0 ? 'assigned' : expected === stops.length ? 'completed' : 'in_progress');

        // The key list of a job row: the four fields every reader shares, plus the count and the
        // `departed` flag of #791. `trip` only in GET /jobs/:id.
        expect(Object.keys(row!).sort(), what).toStrictEqual(['departed', 'job', 'plan', 'shipment', 'status', 'stopsDone']);
        expect(Object.keys(detail).sort(), what).toStrictEqual(['departed', 'job', 'plan', 'shipment', 'status', 'stopsDone', 'trip']);
        // Without the count, the row is still exactly the simulator's own word on the job.
        expect(jobViewOf(row!), what).toStrictEqual(simulatorJob(sim, job.id));
        seen.add(expected);
      }
    }
    // The five moments together show a job with nothing done, one half done and one all done.
    expect([...seen].sort()).toStrictEqual([0, 1, 2]);
  }, T);

  it('adds one small whole number per job to the dashboard body, no list', async () => {
    const sim = await moveClock(api, momentMinutes(await api.simulator(), city.settings).evening);
    let rows = 0;
    for (const employeeId of new Set(sim.jobs.map((j) => j.employeeId))) {
      const dashboard = (await api.get<EmployeeDashboard>(`/employees/${enc(employeeId)}/dashboard`)).body;
      // Only the count is taken out: the row keeps its `departed` flag (#791, measured in v2-employee-departed.test.ts).
      const strip = (list: EmployeeJobView[]) => list.map((row) => ({ ...jobViewOf(row), departed: row.departed }));
      const without = { ...dashboard, assigned: strip(dashboard.assigned), completed: strip(dashboard.completed) };
      const added = JSON.stringify(dashboard).length - JSON.stringify(without).length;
      const count = jobRows(dashboard).length;
      // `,"stopsDone":2` is 14 bytes.
      expect(added, `bytes added to the dashboard of ${employeeId} by ${count} job rows`).toBeLessThanOrEqual(16 * count);
      for (const row of jobRows(dashboard)) {
        expect(Number.isInteger(row.stopsDone) && row.stopsDone! >= 0, `stopsDone of ${row.job.id} = ${row.stopsDone}`).toBe(true);
        expect(row.stopsDone).toBeLessThanOrEqual(stopsOfJob(row).length);
      }
      rows += count;
    }
    expect(rows).toBe(sim.jobs.length);
  }, T);
});
