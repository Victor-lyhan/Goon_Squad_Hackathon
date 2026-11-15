// Issue #823: the "(done)" ticks of the Employee job view (`?job=`) while a delivery moves, on the real default
// NYC run. The check in headless Chrome (1440 and 390 px, the demo carriers' pages, the run sought through
// every step of both legs) found the start and stop rows right at every step, and one fault: the end row
// ("Arrive home") is ticked when the last stop is handled, before the carrier is home. That fault is a gap in
// the contract (no field says the commute has arrived), so it is the `it.fails` test at the end, not a fix.
//
// Every job of the run is rendered at each minute where one of its ticks may change: one minute before its
// trip leaves, at the departure, at each stop's start of handling, one minute before and at its end of
// handling, one minute before and at the leg's finish, and at both ends of the run. The answers are the real
// `GET /api/v2/jobs/:id` views (employee-v2-real-helper.ts). Rules only: no story ID, name or count (DECISIONS
// pass 54, 56).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobResponse } from '../../shared/v2/api';
import {
  T, at, buildRealRun, dashboardAt, elementWith, jobAt, readyState, renderPage, textOf, type At, type RealRun,
} from './employee-v2-real-helper';

type Row = { kind: string; done: boolean; text: string };
type Seen = {
  where: string;
  timeMin: number;
  job: JobResponse;
  /** The route rows as rendered: the start, one per stop, the end. */
  rows: Row[];
};

let real: RealRun;
/** Every job at every one of its own step minutes, rendered once for the whole file. */
let seen: Seen[] = [];

const legOf = (j: JobResponse) => j.plan.legs[j.job.legIndex];

function routeRows(html: string): Row[] {
  const list = elementWith(html, 'class="job-v2__route"');
  if (!list) throw new Error('the job detail has no route list');
  return [...list.matchAll(/<li[^>]*data-kind="([^"]+)"[^>]*data-done="(true|false)"[^>]*>([\s\S]*?)<\/li>/g)]
    .map((m) => ({ kind: m[1], done: m[2] === 'true', text: textOf(m[3]) }));
}

/** The minutes at which a tick of this job may change, inside the run, in order. */
function stepMinutes(j: JobResponse, startMin: number, endMin: number): number[] {
  const leg = legOf(j);
  const minutes = [
    startMin, j.trip.departureMin - 1, j.trip.departureMin,
    ...leg.stops.flatMap((s) => [s.serviceStartMin, s.serviceEndMin - 1, s.serviceEndMin]),
    leg.finishMin - 1, leg.finishMin, endMin,
  ];
  return [...new Set(minutes.filter((m) => m >= startMin && m <= endMin))].sort((a, b) => a - b);
}

beforeAll(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  real = buildRealRun();
  const startMin = real.run.clock.timeMin;
  const endMin = real.run.scenario.settings.simEndMin;
  const moments = new Map<number, At>();
  const moment = (t: number) => moments.get(t) ?? moments.set(t, at(real, t)).get(t)!;
  seen = [];
  for (const { id } of real.run.jobs) {
    for (const timeMin of stepMinutes(jobAt(moment(startMin), id), startMin, endMin)) {
      const now = moment(timeMin);
      const job = jobAt(now, id);
      const dashboard = dashboardAt(now, job.job.employeeId);
      const html = renderPage(readyState(dashboard, real.businesses, now.run.runId, job), id, real.map);
      seen.push({ where: `${id} at minute ${timeMin}`, timeMin, job, rows: routeRows(html) });
    }
  }
}, T);
afterAll(() => vi.unstubAllEnvs());

describe('Employee job view on the real NYC run: the ticks at every step of every job (#823)', () => {
  it('renders every job at each of its step minutes, with a row for the start, each stop and the end', () => {
    expect(real.run.jobs.length).toBeGreaterThan(0);
    // At least: the start of the run, before and at the departure, each stop's end, the end of the run.
    expect(seen.length).toBeGreaterThanOrEqual(real.run.jobs.length * 5);
    for (const s of seen) {
      expect(s.rows.map((r) => r.kind), s.where).toStrictEqual(['start', ...legOf(s.job).stops.map((x) => x.kind), 'end']);
    }
  }, T);

  it('the start row ("Leave work" / "Leave home") is ticked from the minute the trip leaves, and not one minute before', () => {
    const before = seen.filter((s) => s.timeMin === s.job.trip.departureMin - 1);
    const atDeparture = seen.filter((s) => s.timeMin === s.job.trip.departureMin);
    expect(atDeparture.length).toBe(real.run.jobs.length);
    expect(before.length).toBeGreaterThan(0);
    for (const s of seen) {
      const left = s.timeMin >= s.job.trip.departureMin;
      expect(s.job.departed, `${s.where}: the API's departed`).toBe(left);
      expect(s.rows[0].done, `${s.where}: start row`).toBe(left);
    }
  }, T);

  it('stop row i is ticked from the minute its handling ends, never during the handling, and the count is the API\'s stopsDone', () => {
    let duringHandling = 0;
    for (const s of seen) {
      const { stops } = legOf(s.job);
      const ticked = s.rows.slice(1, -1).map((r) => r.done);
      expect(ticked, `${s.where}: stop rows`).toStrictEqual(stops.map((x) => s.timeMin >= x.serviceEndMin));
      expect(ticked, `${s.where}: stop rows against stopsDone ${s.job.stopsDone}`).toStrictEqual(stops.map((_x, i) => i < s.job.stopsDone!));
      duringHandling += stops.filter((x) => s.timeMin >= x.serviceStartMin && s.timeMin < x.serviceEndMin).length;
    }
    // The case a wrong rule would tick early was really rendered: the carrier is at the stop, not done yet.
    expect(duringHandling).toBeGreaterThan(0);
  }, T);

  it('the ticks only ever go forward along the route: a ticked row never follows an unticked stop', () => {
    for (const s of seen) {
      const marks = s.rows.map((r) => r.done);
      // The start and the stops: once one is unticked, every later one is.
      const firstOpen = marks.slice(0, -1).indexOf(false);
      if (firstOpen !== -1) expect(marks.slice(firstOpen), `${s.where}: ${marks.join(',')}`).not.toContain(true);
    }
  }, T);

  it('a tick is the words " (done)" after the action, and a row without the tick does not carry them', () => {
    for (const s of seen) {
      for (const row of s.rows) {
        expect(/\(done\)/.test(row.text), `${s.where}: ${row.text}`).toBe(row.done);
      }
    }
  }, T);

  it('nothing is ticked at the start of the run, and every row is at its end', () => {
    const startMin = real.run.clock.timeMin;
    const endMin = real.run.scenario.settings.simEndMin;
    const first = seen.filter((s) => s.timeMin === startMin);
    const last = seen.filter((s) => s.timeMin === endMin);
    expect(first.length).toBe(real.run.jobs.length);
    expect(last.length).toBe(real.run.jobs.length);
    for (const s of first) expect(s.rows.some((r) => r.done), s.where).toBe(false);
    for (const s of last) expect(s.rows.every((r) => r.done), s.where).toBe(true);
  }, T);

  it('the end row ("Arrive home" / "Arrive at work") is never ticked before the last stop is done, and is ticked from the leg\'s finish', () => {
    for (const s of seen) {
      const leg = legOf(s.job);
      const end = s.rows[s.rows.length - 1];
      if (s.timeMin < leg.stops[leg.stops.length - 1].serviceEndMin) expect(end.done, `${s.where}: end row before the last stop`).toBe(false);
      if (s.timeMin >= leg.finishMin) expect(end.done, `${s.where}: end row at or after the finish`).toBe(true);
    }
  }, T);

  it('some legs go on after their last stop (an evening carrier drives home after the drop), so the end row has its own minute', () => {
    const later = real.run.jobs.filter((job) => {
      const j = jobAt(at(real, real.run.clock.timeMin), job.id);
      const leg = legOf(j);
      return leg.finishMin > leg.stops[leg.stops.length - 1].serviceEndMin;
    });
    expect(later.length).toBeGreaterThan(0);
  }, T);

  // NEEDS CONTRACT (#823, seen in headless Chrome on the demo's evening carrier): the end row is ticked from
  // the job status ("completed" = the last stop is handled), so "Arrive home" reads "(done)" while the carrier
  // is still driving home: from the drop's end to the leg's `finishMin`, the time the row itself shows. The
  // page has no minute and may not work one out (AGENTS hard rules), and no field says the commute has
  // arrived. The fix is one more optional field next to `departed` (for example `arrived`: the simulation
  // minute is at or past the leg's `finishMin`), filled in server/api/v2/views.ts and read by `routeRows`.
  // When that lands this test passes: remove `.fails`.
  it.fails('NEEDS CONTRACT: the end row is not ticked before the leg\'s finish minute', () => {
    const early = seen
      .filter((s) => s.timeMin < legOf(s.job).finishMin && s.rows[s.rows.length - 1].done)
      .map((s) => `${s.where}: "${s.rows[s.rows.length - 1].text}" (finish ${legOf(s.job).finishMin})`);
    expect(early).toStrictEqual([]);
  }, T);
});
