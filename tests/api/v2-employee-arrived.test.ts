// #836: the Employee job view marks its end row ("Arrive home" / "Arrive at work") done when the commute
// arrives, not when the job is completed. `EmployeeJobView.arrived` says it: true once the simulation minute
// is at or past the `finishMin` of the job's leg, the time the row itself shows. It is filled by one builder
// (`buildJobView`, server/api/v2/views.ts), so the employee's dashboard row and GET /jobs/:id carry the same
// flag. The job status is untouched: a job is `completed` when its last stop is handled (DECISIONS pass 3),
// and an evening carrier then still drives home (PR #835 saw "Arrive home (done)" 23 minutes early).
// The server is the one of v2-e2e-nyc-helper.ts: the real v2 runtime on a temp copy of `fixtures/nyc`, no
// key, no network. The delivery is the README's demo request on a fresh run: the ```demo-request block, sent
// the way the New delivery form sends it (as v2-readme-demo.test.ts does). Its businesses and carriers are
// read from the block and found by name, and every minute is read from the answers (DECISIONS pass 54).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { emptyDraft, toRequest } from '../../client/src/components/business/v2/newDeliveryModel';
import { jobDetail } from '../../client/src/components/employee/v2/jobDetailV2Model';
import { formatMin } from '../../client/src/ui/format';
import type { EmployeeDashboard, EmployeeJobView, JobResponse, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Employee, Job, Leg, NetworkBusiness, Stop } from '../../shared/v2/types';
import {
  copyNycFixtures, DAY_2_MIN, readCity, recordFetch, REPO_ROOT, startNycApi, type City, type NycApi,
} from './v2-e2e-nyc-helper';
import { jobRows, momentMinutes, moveClock } from './v2-nyc-consistency-helper';
import { DASH_MAX_BYTES } from './v2-poll-budget-helper';

/** Timeout of every test and hook (DECISIONS pass 19 and 52): each boots a real HTTP server. */
const T = 30_000;

// ---------- the README ----------

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
/** The block's lines as `key: value`. The keys are checked by v2-readme-demo.test.ts. */
const demo: Record<string, string> = Object.fromEntries(
  block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

// ---------- the server ----------

const net = recordFetch();
let fixturesDir = '';
let api: NycApi;
let city: City;

beforeEach(async () => {
  fixturesDir = copyNycFixtures();
  api = await startNycApi(net, { fixturesDir });
  expect(api.runtime.reason).toBeUndefined();
  expect(api.runtime.status).toBe('ready');
  city = await readCity(api);
}, T);
afterEach(async () => {
  try {
    net.expectNoOutgoing();
    api?.expectRepoFilesUntouched();
  } finally {
    await api?.close();
    if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
}, T);
afterAll(() => net.restore());

const enc = encodeURIComponent;

/** The one entry of the run with this name. A name the run does not have, or has twice, fails. */
function byName<V extends { name: string }>(list: V[], name: string, what: string): V {
  const found = list.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`README names the ${what} "${name}", and the default run has ${found.length} of them`);
  return found[0];
}

type Demo = {
  sender: NetworkBusiness; recipient: NetworkBusiness;
  eveningCarrier: Employee; morningCarrier: Employee;
  plan: DeliveryPlan; evening: Job; morning: Job;
};

/** Sends the README's demo request on the fresh run and gives its two jobs, the evening leg first. */
async function sendDemoRequest(): Promise<Demo> {
  const sender = byName(city.businesses, demo.sender, 'sender');
  const recipient = byName(city.businesses, demo.recipient, 'recipient');
  const eveningCarrier = byName(city.employees, demo.evening_carrier, 'evening carrier');
  const morningCarrier = byName(city.employees, demo.morning_carrier, 'morning carrier');
  const request = toRequest({
    ...emptyDraft(), recipientId: recipient.id, label: demo.package, category: TYPE_OF[demo.type],
    weightKg: demo.weight_kg, description: demo.contents,
  }, sender.id, 'arrived-demo');
  const res = await api.post<ShipmentResponse>('/shipments', request);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.matched).toBe(true);
  const plan = res.body.plan;
  if (!plan) throw new Error('the demo request has a plan');
  expect(plan.kind).toBe('relay');
  expect(plan.legs.map((leg) => leg.employeeId)).toStrictEqual([eveningCarrier.id, morningCarrier.id]);

  const sim = await api.simulator();
  const jobs = sim.jobs.filter((j) => j.shipmentId === res.body.shipment.id).sort((a, b) => a.legIndex - b.legIndex);
  expect(jobs.map((j) => j.employeeId)).toStrictEqual([eveningCarrier.id, morningCarrier.id]);
  return { sender, recipient, eveningCarrier, morningCarrier, plan, evening: jobs[0], morning: jobs[1] };
}

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

type Seen = { arrived: boolean | undefined; departed: boolean | undefined; stopsDone: number | undefined; status: string };

/** Seeks, then reads the job from both answers, which must agree. */
async function jobAt(job: Job, timeMin: number, step: string): Promise<Seen> {
  await moveClock(api, timeMin);
  const { row, detail } = await readJob(job);
  const what = `${step} (minute ${timeMin})`;
  expect(detail.arrived, `${what}: GET /jobs/:id and the dashboard agree`).toBe(row.arrived);
  expect(detail.departed, what).toBe(row.departed);
  expect(detail.stopsDone, what).toBe(row.stopsDone);
  expect(detail.status, what).toBe(row.status);
  return { arrived: row.arrived, departed: row.departed, stopsDone: row.stopsDone, status: row.status };
}

/** Seeks, then reads only `arrived` of GET /jobs/:id: the cheap read of the minute-by-minute walks. */
async function arrivedAt(job: Job, timeMin: number): Promise<boolean | undefined> {
  await moveClock(api, timeMin);
  const detail = await api.get<JobResponse>(`/jobs/${enc(job.id)}`);
  expect(detail.status).toBe(200);
  return detail.body.arrived;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_v, i) => from + i);

/** The job's leg of its plan, and the leg's stops as the page lists them (the job's own two when the leg has none). */
const legOf = (view: EmployeeJobView): Leg => view.plan.legs[view.job.legIndex];
const stopsOfJob = (view: EmployeeJobView): Stop[] => {
  const leg = legOf(view);
  return leg?.stops?.length ? leg.stops : [view.job.pickup, view.job.dropoff];
};

/** The end row of the job page, built by the page's own model from the answer of GET /jobs/:id. */
function endRow(detail: JobResponse, dashboard: EmployeeDashboard) {
  const route = jobDetail(detail, city.businesses, dashboard.home.neighborhood).route;
  return route[route.length - 1];
}

describe(`arrived of the jobs of the README demo request ("${demo.package}") on a fresh NYC run (#836)`, () => {
  it(`evening leg (${demo.evening_carrier}): false at every minute before the leg's finish minute, also while the job is completed, and true from it`, async () => {
    const { evening, eveningCarrier } = await sendDemoRequest();
    const { detail } = await readJob(evening);
    const leg = legOf(detail);
    const stops = stopsOfJob(detail);
    const drop = stops[stops.length - 1];
    const { finishMin } = leg;
    const startMin = city.settings.simStartMin;
    expect(detail.job.employeeId).toBe(eveningCarrier.id);
    expect(detail.trip.direction).toBe('evening');
    expect(Number.isInteger(finishMin)).toBe(true);
    expect(startMin).toBeLessThan(detail.trip.departureMin);
    expect(finishMin).toBeLessThan(DAY_2_MIN);
    // The case the page got wrong: the carrier drives on after the relay drop, so the job is completed
    // before the commute arrives.
    expect(drop.kind).toBe('hub_drop');
    expect(drop.serviceEndMin, `the relay drop ends (${drop.serviceEndMin}) before the carrier is home (${finishMin})`).toBeLessThan(finishMin);

    // Every minute from the start of the run to one minute before the finish: not arrived.
    const before = range(startMin, finishMin - 1);
    const seenBefore: (boolean | undefined)[] = [];
    for (const timeMin of before) seenBefore.push(await arrivedAt(evening, timeMin));
    expect(before.filter((_t, i) => seenBefore[i] !== false), 'minutes before the finish that do not answer arrived: false').toStrictEqual([]);
    // Every minute from the finish for a quarter of an hour, then the later moments of the run: arrived.
    const after = [...range(finishMin, finishMin + 15), DAY_2_MIN, city.settings.simEndMin];
    const seenAfter: (boolean | undefined)[] = [];
    for (const timeMin of after) seenAfter.push(await arrivedAt(evening, timeMin));
    expect(after.filter((_t, i) => seenAfter[i] !== true), 'minutes at or after the finish that do not answer arrived: true').toStrictEqual([]);

    // The steps of the leg, with the other marks: only `arrived` waits for the finish.
    expect(await jobAt(evening, startMin, 'the start of the run'))
      .toStrictEqual({ arrived: false, departed: false, stopsDone: 0, status: 'assigned' });
    expect(await jobAt(evening, detail.trip.departureMin, 'the departure'))
      .toMatchObject({ arrived: false, departed: true });
    expect(await jobAt(evening, drop.serviceEndMin, 'the relay drop is handled'))
      .toStrictEqual({ arrived: false, departed: true, stopsDone: stops.length, status: 'completed' });
    expect(await jobAt(evening, finishMin - 1, 'one minute before the carrier is home'))
      .toStrictEqual({ arrived: false, departed: true, stopsDone: stops.length, status: 'completed' });
    expect(await jobAt(evening, finishMin, 'the carrier is home'))
      .toStrictEqual({ arrived: true, departed: true, stopsDone: stops.length, status: 'completed' });
    expect(await jobAt(evening, city.settings.simEndMin, 'the end of the run'))
      .toStrictEqual({ arrived: true, departed: true, stopsDone: stops.length, status: 'completed' });
    // A seek back takes the mark back: nothing is stored.
    expect((await jobAt(evening, finishMin - 1, 'back to one minute before the finish')).arrived).toBe(false);
    expect((await jobAt(evening, finishMin, 'back to the finish')).arrived).toBe(true);
  }, T);

  it(`evening leg: the page's "Arrive home" row shows the finish time and is ticked from that minute, not from "Completed"`, async () => {
    const { evening } = await sendDemoRequest();
    const first = await readJob(evening);
    const { finishMin } = legOf(first.detail);
    const stops = stopsOfJob(first.detail);
    const dropEnd = stops[stops.length - 1].serviceEndMin;

    const rowAt = async (timeMin: number) => {
      await moveClock(api, timeMin);
      const { detail, dashboard } = await readJob(evening);
      const model = jobDetail(detail, city.businesses, dashboard.home.neighborhood);
      return { ...endRow(detail, dashboard), status: model.statusLabel, marks: model.route.map((r) => r.done) };
    };
    const allDone = stops.map(() => true);
    // The relay drop is handled: every row but the last is ticked, and the label reads "Completed".
    expect(await rowAt(dropEnd)).toMatchObject({
      kind: 'end', action: 'Arrive home', time: formatMin(finishMin), done: false, status: 'Completed', marks: [true, ...allDone, false],
    });
    expect(await rowAt(finishMin - 1)).toMatchObject({ action: 'Arrive home', done: false, status: 'Completed' });
    expect(await rowAt(finishMin)).toMatchObject({
      kind: 'end', action: 'Arrive home', time: formatMin(finishMin), done: true, status: 'Completed', marks: [true, ...allDone, true],
    });
    // The row never shows a place ID: the carrier's home is its neighborhood.
    expect((await rowAt(finishMin)).place).toBe(`Home · ${first.dashboard.home.neighborhood}`);
  }, T);

  it(`morning leg (${demo.morning_carrier}): false through Day 1 and the night, true from the arrival at work`, async () => {
    const { evening, morning, morningCarrier } = await sendDemoRequest();
    const { detail, dashboard } = await readJob(morning);
    const leg = legOf(detail);
    const stops = stopsOfJob(detail);
    const delivery = stops[stops.length - 1];
    const { finishMin } = leg;
    expect(detail.job.employeeId).toBe(morningCarrier.id);
    expect(detail.trip.direction).toBe('morning');
    expect(detail.trip.departureMin).toBeGreaterThan(DAY_2_MIN);
    expect(delivery.kind).toBe('delivery');
    // A leg never arrives before its last stop is handled.
    expect(finishMin).toBeGreaterThanOrEqual(delivery.serviceEndMin);

    // Day 1 and the night: the first carrier gets home, the second has not left.
    const eveningFinish = (await readJob(evening)).detail.plan.legs[0].finishMin;
    expect((await jobAt(morning, city.settings.simStartMin, 'the start of the run')).arrived).toBe(false);
    expect((await jobAt(evening, eveningFinish, 'leg 1 is home')).arrived).toBe(true);
    expect((await jobAt(morning, eveningFinish, 'leg 1 is home, leg 2')).arrived).toBe(false);
    expect(await jobAt(morning, DAY_2_MIN, 'the start of Day 2'))
      .toStrictEqual({ arrived: false, departed: false, stopsDone: 0, status: 'assigned' });

    // Every minute from one before the departure to one before the arrival at work: not arrived.
    const before = range(detail.trip.departureMin - 1, finishMin - 1);
    const seenBefore: (boolean | undefined)[] = [];
    for (const timeMin of before) seenBefore.push(await arrivedAt(morning, timeMin));
    expect(before.filter((_t, i) => seenBefore[i] !== false), 'minutes before the arrival that do not answer arrived: false').toStrictEqual([]);
    // From the arrival on.
    const after = [...range(finishMin, finishMin + 15), city.settings.simEndMin].filter((t) => t <= city.settings.simEndMin);
    const seenAfter: (boolean | undefined)[] = [];
    for (const timeMin of after) seenAfter.push(await arrivedAt(morning, timeMin));
    expect(after.filter((_t, i) => seenAfter[i] !== true), 'minutes at or after the arrival that do not answer arrived: true').toStrictEqual([]);

    expect(await jobAt(morning, finishMin - 1, 'one minute before the arrival at work')).toMatchObject({ arrived: false, departed: true });
    expect(await jobAt(morning, finishMin, 'the arrival at work'))
      .toStrictEqual({ arrived: true, departed: true, stopsDone: stops.length, status: 'completed' });
    // The page's row: "Arrive at work", at the leg's finish time, ticked.
    const atWork = await readJob(morning);
    expect(endRow(atWork.detail, dashboard)).toMatchObject({ kind: 'end', action: 'Arrive at work', time: formatMin(finishMin), done: true });
    // A morning leg that ends at its last stop is ticked when that stop ends, as before #836.
    if (finishMin === delivery.serviceEndMin) {
      expect(await jobAt(morning, delivery.serviceEndMin, 'the package is handed over, which is the arrival'))
        .toStrictEqual({ arrived: true, departed: true, stopsDone: stops.length, status: 'completed' });
    }
  }, T);
});

describe('arrived of every job of the NYC run with the demo request (#836)', () => {
  /** Every job row of every carrier at this minute, with the answer of GET /jobs/:id. */
  async function allJobsAt(timeMin: number): Promise<{ sim: SimulatorResponse; rows: { job: Job; row: EmployeeJobView; detail: JobResponse; dashboard: EmployeeDashboard }[] }> {
    const sim = await moveClock(api, timeMin);
    const dashboards = new Map<string, EmployeeDashboard>();
    for (const employeeId of new Set(sim.jobs.map((j) => j.employeeId))) {
      const res = await api.get<EmployeeDashboard>(`/employees/${enc(employeeId)}/dashboard`);
      expect(res.status).toBe(200);
      dashboards.set(employeeId, res.body);
    }
    const rows = [];
    for (const job of sim.jobs) {
      const dashboard = dashboards.get(job.employeeId)!;
      const row = jobRows(dashboard).find((r) => r.job.id === job.id);
      expect(row, `job ${job.id} at minute ${timeMin}: in its employee's dashboard`).toBeDefined();
      const detail = (await api.get<JobResponse>(`/jobs/${enc(job.id)}`)).body;
      rows.push({ job, row: row!, detail, dashboard });
    }
    return { sim, rows };
  }

  it('is "the clock is at or past the finish of the job\'s leg", the same in the dashboard and in GET /jobs/:id, at the moments of the run and at every leg\'s finish', async () => {
    await sendDemoRequest();
    const start = await api.simulator();
    expect(start.jobs.length).toBeGreaterThan(2);
    // The five moments of the run, and one minute before and at the finish of every leg.
    const finishes = start.plans.flatMap((plan) => plan.legs.map((leg) => leg.finishMin));
    const minutes = [...new Set([
      ...Object.values(momentMinutes(start, city.settings)), ...finishes.flatMap((t) => [t - 1, t]),
    ])].sort((a, b) => a - b);
    const seen = { arrived: 0, notArrived: 0, completedNotArrived: 0, tickedByThePage: 0 };

    for (const timeMin of minutes) {
      const { rows } = await allJobsAt(timeMin);
      for (const { job, row, detail, dashboard } of rows) {
        const what = `job ${job.id} at minute ${timeMin}`;
        const stops = stopsOfJob(row);
        const expected = timeMin >= legOf(row).finishMin;

        expect(row.arrived, what).toBe(expected);
        expect(detail.arrived, `${what}: GET /jobs/:id`).toBe(expected);
        // A carrier who arrived has left and handled every stop: the flag never runs ahead of the others.
        if (row.arrived) {
          expect(row.departed, what).toBe(true);
          expect(row.stopsDone, what).toBe(stops.length);
          expect(row.status, what).toBe('completed');
        }
        // And the finish is never before the end of the last stop, so the rows of the page read in order.
        expect(legOf(row).finishMin, what).toBeGreaterThanOrEqual(stops[stops.length - 1].serviceEndMin);
        // The page's end row is this flag, nothing else.
        const end = endRow(detail, dashboard);
        expect(end.done, `${what}: the page's end row`).toBe(expected);
        expect(end.time, what).toBe(formatMin(legOf(row).finishMin));

        if (expected) seen.arrived += 1; else seen.notArrived += 1;
        if (!expected && row.status === 'completed') seen.completedNotArrived += 1;
        if (end.done) seen.tickedByThePage += 1;
      }
    }
    expect(seen.arrived).toBeGreaterThan(0);
    expect(seen.notArrived).toBeGreaterThan(0);
    // The case of the issue is in the run: a completed job whose carrier has not arrived yet.
    expect(seen.completedNotArrived).toBeGreaterThan(0);
    expect(seen.tickedByThePage).toBe(seen.arrived);
    console.log(`arrived at ${minutes.length} minutes: ${seen.arrived} job rows arrived, ${seen.notArrived} not arrived, ${seen.completedNotArrived} of them completed`);
  }, T);

  it('at the start of the run no commute has arrived; at the end every one has', async () => {
    await sendDemoRequest();
    for (const [timeMin, expected] of [[city.settings.simStartMin, false], [city.settings.simEndMin, true]] as const) {
      const { rows } = await allJobsAt(timeMin);
      expect(rows.length).toBeGreaterThan(0);
      for (const { job, row, detail } of rows) {
        expect(row.arrived, `job ${job.id} at minute ${timeMin}`).toBe(expected);
        expect(detail.arrived, `job ${job.id} at minute ${timeMin}: GET /jobs/:id`).toBe(expected);
      }
    }
  }, T);

  it('adds one true or false per job to the dashboard body, which stays inside the poll byte budget', async () => {
    await sendDemoRequest();
    const minutes = momentMinutes(await api.simulator(), city.settings);
    for (const timeMin of [minutes.start, minutes.evening, minutes.end]) {
      const sim = await moveClock(api, timeMin);
      let rows = 0;
      for (const employeeId of new Set(sim.jobs.map((j) => j.employeeId))) {
        const dashboard = (await api.get<EmployeeDashboard>(`/employees/${enc(employeeId)}/dashboard`)).body;
        const strip = (list: EmployeeJobView[]) => list.map(({ arrived: _arrived, ...rest }) => rest);
        const without = { ...dashboard, assigned: strip(dashboard.assigned), completed: strip(dashboard.completed) };
        const added = JSON.stringify(dashboard).length - JSON.stringify(without).length;
        const count = jobRows(dashboard).length;
        // `,"arrived":true` is 15 bytes, `,"arrived":false` is 16.
        expect(added, `bytes added to the dashboard of ${employeeId} by ${count} job rows at minute ${timeMin}`).toBeLessThanOrEqual(16 * count);
        expect(added).toBeGreaterThanOrEqual(15 * count);
        for (const row of jobRows(dashboard)) expect(typeof row.arrived, `arrived of ${row.job.id}`).toBe('boolean');
        // The budget of v2-poll-budget-pages.test.ts, on every carrier's dashboard.
        expect(JSON.stringify(dashboard).length, `dashboard of ${employeeId} at minute ${timeMin}`).toBeLessThanOrEqual(DASH_MAX_BYTES);
        rows += count;
      }
      expect(rows).toBe(sim.jobs.length);
    }
  }, T);
});
