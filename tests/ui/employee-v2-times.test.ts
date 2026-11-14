// Issue #583 (DECISIONS pass 60): every moment of a delivery on the Employee pages reads "Day 2, 8:05 AM"
// (`formatMin`), in the assigned rows and in the job view; the saved commute keeps its daily clock ("5:15 PM");
// durations and money are as they were. Checked on the hand-built samples of the model tests and on the story
// employees of the real default NYC run (read from fixtures/nyc/demoStory.json: no ID, name or count is pinned,
// DECISIONS pass 54), on the models and on the rendered page.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmployeeDashboard, EmployeeJobView, JobResponse } from '../../shared/v2/api';
import type { NetworkBusiness } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { commuteSummary, deliveryRows } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { jobDetail } from '../../client/src/components/employee/v2/jobDetailV2Model';
import { formatClock, formatMin } from '../../client/src/ui/format';
import { businesses as jobBusinesses, eveningDirect, morningDirect, relayLeg1, relayLeg2, STATUSES } from './employeeV2JobSample';
import { businesses as sampleBusinesses, dashboard as sampleDashboard } from './employee-v2-workspace-sample';
import {
  T, at, buildRealRun, dashboardAt, elementWith, jobAt, momentsOf, readyState, renderPage, textOf,
  type Moment, type RealRun,
} from './employee-v2-real-helper';

/** The one format of a moment of a delivery (the runs here have two days). */
const MOMENT = /^Day [12], \d{1,2}:\d{2} (AM|PM)$/;
/** A daily clock time of the saved commute: no day. */
const CLOCK = /^\d{1,2}:\d{2} (AM|PM)$/;

/** Every clock-like piece of a text, with the day and the AM/PM it carries, or without them. */
const timesIn = (text: string): string[] =>
  [...text.matchAll(/(?:Day \d+, )?\d{1,2}:\d{2}(?: ?(?:[AP]M|[ap]\.m\.))?/g)].map((m) => m[0]);

/** Every string value of a model, hrefs left out (an ID is not a text on screen). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!/href$/i.test(k)) strings(v, out);
  }
  return out;
}

/** A model shows at least `min` times, and each one is a full "Day N, h:mm AM/PM". */
function expectOnlyMoments(model: unknown, min: number, where: string): void {
  const times = strings(model).flatMap(timesIn);
  expect(times.length, `${where}: times in the model`).toBeGreaterThanOrEqual(min);
  for (const t of times) expect(t, `${where}: "${t}"`).toMatch(MOMENT);
}

const legOf = (j: EmployeeJobView) => j.plan.legs[j.job.legIndex];

/** The assigned row of one job: its two times are the API's minutes in the one format. */
function expectRowTimes(view: EmployeeJobView, businesses: NetworkBusiness[], where: string) {
  const [row] = deliveryRows([view], businesses, 'Astoria');
  expect(row.pickupTime, where).toMatch(MOMENT);
  expect(row.dropoffTime, where).toMatch(MOMENT);
  expect(row.pickupTime, where).toBe(formatMin(view.job.pickup.serviceStartMin));
  expect(row.dropoffTime, where).toBe(formatMin(view.job.dropoff.serviceStartMin));
  expect(row.pickup.startsWith(`${row.pickupTime} · `), where).toBe(true);
  expect(row.dropoff.startsWith(`${row.dropoffTime} · `), where).toBe(true);
  expectOnlyMoments(row, 4, where); // pickup and drop-off, each as a time and inside its line
  // Durations and money are not moments and keep their form.
  expect(row.extraMin, where).toMatch(/^\+\d+ min$/);
  expect(row.reward, where).toMatch(/^\$\d+\.\d{2}$/);
  return row;
}

/** The job view of one job: the trip line and every route row carry one full moment each. */
function expectJobTimes(job: JobResponse, businesses: NetworkBusiness[], where: string) {
  const m = jobDetail(job, businesses, 'Astoria');
  const stops = legOf(job).stops;
  expect(m.route.map((r) => r.time), where).toStrictEqual([
    formatMin(job.trip.departureMin), ...stops.map((s) => formatMin(s.serviceStartMin)), formatMin(legOf(job).finishMin),
  ]);
  for (const r of m.route) expect(r.time, `${where}: ${r.key}`).toMatch(MOMENT);
  expect(timesIn(m.trip), where).toStrictEqual([formatMin(job.trip.departureMin)]);
  expectOnlyMoments(m, m.route.length + 1, where);
  // Durations, distance and money keep their form (#551).
  const number = (key: string) => m.numbers.find((n) => n.key === key)!.value;
  expect(number('reward'), where).toMatch(/^\$\d+\.\d{2}$/);
  expect(number('extra-time'), where).toMatch(/^(\+\d+ min|\d+ min shorter)$/);
  expect(number('extra-distance'), where).toMatch(/^(\+\d+(\.\d)? km|\d+(\.\d)? km shorter|No extra distance)$/);
  expect(number('usual-commute'), where).toMatch(/^(\d+ min|\d+ h( \d+ min)?)$/);
  return m;
}

describe('delivery times on the hand-built samples', () => {
  it('the assigned and completed rows: "Day N, h:mm AM/PM", and the morning relay leg says Day 2', () => {
    const views = [...sampleDashboard.assigned, ...sampleDashboard.completed];
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      const row = expectRowTimes(v, sampleBusinesses, v.job.id);
      const day = v.job.tripId.endsWith('-morn') ? 'Day 2, ' : 'Day 1, ';
      expect(row.pickupTime.startsWith(day), v.job.id).toBe(true);
      expect(row.dropoffTime.startsWith(day), v.job.id).toBe(true);
    }
    const [morning] = deliveryRows(views.filter((v) => v.job.tripId.endsWith('-morn')), sampleBusinesses, 'Astoria');
    expect(morning.pickupTime).toBe('Day 2, 8:40 AM');
    expect(morning.dropoffTime).toBe('Day 2, 9:10 AM');
  });

  it.each(STATUSES)('the job view at %s: one full moment per row and on the trip line, Day 2 on a morning leg', (status) => {
    for (const make of [eveningDirect, morningDirect, relayLeg1, relayLeg2]) {
      const job = make(status);
      const m = expectJobTimes(job, jobBusinesses, `${job.job.id} ${status}`);
      const day = job.trip.direction === 'morning' ? 'Day 2, ' : 'Day 1, ';
      for (const r of m.route) expect(r.time.startsWith(day), `${job.job.id}: ${r.key}`).toBe(true);
    }
    expect(jobDetail(morningDirect(status), jobBusinesses, 'Park Slope').route[1].time).toBe('Day 2, 8:48 AM');
  });

  it('the saved commute keeps its daily clock times: no day on a departure setting', () => {
    const { trips } = commuteSummary(sampleDashboard, sampleBusinesses);
    expect(trips.map((t) => t.departure)).toEqual(['5:30 PM', '8:30 AM']);
    for (const t of trips) expect(t.departure).toMatch(CLOCK);
    expect(strings(commuteSummary(sampleDashboard, sampleBusinesses)).join(' ')).not.toContain('Day ');
  });
});

describe('delivery times for the story employees of the real NYC run', () => {
  let real: RealRun;
  let moments: Moment[];
  let storyIds: string[];

  beforeAll(() => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    real = buildRealRun();
    moments = momentsOf(real);
    storyIds = readNycFixtures(NYC_FIXTURES_DIR).storyFile.featuredEmployees.map((e) => e.id);
  }, T);
  afterAll(() => vi.unstubAllEnvs());

  /** Every job (assigned or completed) of every story employee, at each of the five moments of the day. */
  function eachStoryJob(fn: (view: EmployeeJobView, job: JobResponse, d: EmployeeDashboard, where: string) => void): number {
    let jobs = 0;
    for (const moment of moments) {
      const now = at(real, moment.timeMin);
      for (const id of storyIds) {
        const d = dashboardAt(now, id);
        for (const view of [...d.assigned, ...d.completed]) {
          jobs += 1;
          fn(view, jobAt(now, view.job.id), d, `${view.job.id} of ${id} at ${moment.label}`);
        }
      }
    }
    return jobs;
  }

  it('the story has employees with jobs, on the evening and on the morning commute', () => {
    expect(storyIds.length).toBeGreaterThan(0);
    const directions = new Set<string>();
    expect(eachStoryJob((_v, job) => directions.add(job.trip.direction))).toBeGreaterThan(0);
    expect([...directions].sort()).toEqual(['evening', 'morning']);
  }, T);

  it('every time of the assigned row and of the job view is "Day N, h:mm AM/PM", and the two agree', () => {
    eachStoryJob((view, job, _d, where) => {
      const row = expectRowTimes(view, real.businesses, where);
      const m = expectJobTimes(job, real.businesses, where);
      // The same stop has the same time in the list and in the job view.
      expect(m.route[1].time, where).toBe(row.pickupTime);
      expect(m.route[m.route.length - 2].time, where).toBe(row.dropoffTime);
    });
  }, T);

  it('a Day 2 morning stop says "Day 2" in the row and in the job view; an evening stop says "Day 1"', () => {
    let morningStops = 0;
    eachStoryJob((view, job, _d, where) => {
      const row = deliveryRows([view], real.businesses, 'Astoria')[0];
      const m = jobDetail(job, real.businesses, 'Astoria');
      legOf(job).stops.forEach((s, i) => {
        const day = `Day ${Math.floor(s.serviceStartMin / 1440) + 1}, `;
        expect(m.route[i + 1].time.startsWith(day), `${where}: stop ${i + 1}`).toBe(true);
        if (job.trip.direction === 'morning') {
          morningStops += 1;
          expect(s.serviceStartMin, where).toBeGreaterThanOrEqual(1440);
          expect(m.route[i + 1].time.startsWith('Day 2, '), `${where}: stop ${i + 1}`).toBe(true);
        } else {
          expect(m.route[i + 1].time.startsWith('Day 1, '), `${where}: stop ${i + 1}`).toBe(true);
        }
      });
      const rowDay = job.trip.direction === 'morning' ? 'Day 2, ' : 'Day 1, ';
      expect(row.pickupTime.startsWith(rowDay), where).toBe(true);
      expect(row.dropoffTime.startsWith(rowDay), where).toBe(true);
      expect(m.trip, where).toContain(`leaves ${rowDay}`);
    });
    expect(morningStops).toBeGreaterThan(0);
  }, T);

  it('on the rendered page: no 24-hour time and no time without its day in the delivery lists or the job view', () => {
    eachStoryJob((view, job, d, where) => {
      // The lists of the workspace.
      const page = renderPage(readyState(d, real.businesses, real.run.runId), null, real.map);
      for (const id of ['ew-assigned-heading', 'ew-completed-heading']) {
        const section = elementWith(page, `aria-labelledby="${id}"`);
        if (section === null) continue; // the completed list is only there once something is completed
        for (const t of timesIn(textOf(section))) expect(t, `${where}: "${t}" in ${id}`).toMatch(MOMENT);
      }
      const li = elementWith(page, `data-job-id="${view.job.id}"`);
      expect(li, where).not.toBeNull();
      expect(timesIn(textOf(li!)), where).toStrictEqual([
        formatMin(view.job.pickup.serviceStartMin), formatMin(view.job.dropoff.serviceStartMin),
      ]);
      // The job view.
      const jobPage = renderPage(readyState(d, real.businesses, real.run.runId, job), view.job.id, real.map);
      const detail = elementWith(jobPage, 'class="job-v2"');
      expect(detail, where).not.toBeNull();
      const shown = timesIn(textOf(detail!));
      expect(shown.length, where).toBe(legOf(job).stops.length + 3); // trip line, start, each stop, end
      for (const t of shown) expect(t, `${where}: "${t}" in the job view`).toMatch(MOMENT);
    });
  }, T);

  it('the saved commute of a story employee keeps "h:mm AM/PM" with no day', () => {
    const now = at(real, moments[0].timeMin);
    for (const id of storyIds) {
      const d = dashboardAt(now, id);
      const summary = commuteSummary(d, real.businesses);
      for (const t of summary.trips.filter((x) => x.available)) {
        expect(t.departure, `${id} ${t.direction}`).toMatch(CLOCK);
        expect(t.departure, `${id} ${t.direction}`).toBe(formatClock(d.trips.find((x) => x.direction === t.direction)!.departureMin));
      }
      const commute = elementWith(renderPage(readyState(d, real.businesses, real.run.runId), null, real.map), 'aria-labelledby="ew-commute-heading"');
      expect(commute, id).not.toBeNull();
      expect(textOf(commute!), id).not.toMatch(/Day \d/);
    }
  }, T);
});
