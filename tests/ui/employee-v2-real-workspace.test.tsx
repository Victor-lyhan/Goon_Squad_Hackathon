// Issue #513: the MVP II Employee workspace rendered from the real responses of the default NYC run, for every
// employee at five moments of the day (DECISIONS pass 56). Demo step 1 (the saved commute) runs through this page.
// Rules only: no story ID, name or count is pinned (pass 54), so the story can be retuned under these tests.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatCents, formatClock } from '../../client/src/ui/format';
import { EMPTY_TEXT, LOCKED_TEXT } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import {
  STATUS_LABEL, T, at, buildRealRun, businessName, dashboardAt, elementWith, expectCleanPage, jobIdsIn, momentsOf,
  readyState, renderPage, textOf, type Moment, type RealRun,
} from './employee-v2-real-helper';

let real: RealRun;
let moments: Moment[];

beforeAll(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''); // no key: the map shows its fallback, the text stays
  real = buildRealRun();
  moments = momentsOf(real);
}, T);
afterAll(() => vi.unstubAllEnvs());

describe('the five moments come from the run', () => {
  it('are in order inside the run and the two leg minutes have a job in progress', () => {
    const { simStartMin, simEndMin } = real.run.scenario.settings;
    const times = moments.map((m) => m.timeMin);
    expect([...times].sort((a, b) => a - b)).toStrictEqual(times);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(simStartMin);
      expect(t).toBeLessThanOrEqual(simEndMin);
    }
    for (const m of [moments[1], moments[3]]) {
      expect(Object.values(at(real, m.timeMin).snapshot.jobStatus), m.label).toContain('in_progress');
    }
  }, T);
});

describe('the clean-page rule itself', () => {
  it('catches undefined, a home coordinate, "hub" and a street address that is not a business', () => {
    const home = real.run.scenario.homes[0];
    const biz = real.businesses[0];
    const check = (html: string) => () => expectCleanPage(html, 'sample', real.run.scenario.homes, real.businesses);
    expect(check(`<p>${biz.name} · ${biz.address}</p>`)).not.toThrow();
    expect(check('<p>Earned undefined</p>')).toThrow();
    expect(check(`<p>Home at ${home.lat}</p>`)).toThrow();
    expect(check('<p>Relay hub</p>')).toThrow();
    expect(check('<p>Home: 30-01 Example St, Queens</p>')).toThrow();
  }, T);
});

describe('Employee workspace on the real NYC run, every employee at five moments', () => {
  it('shows the saved commute first: workplace, home neighborhood, both departures, the detour limit', () => {
    for (const moment of moments) {
      const now = at(real, moment.timeMin);
      for (const employee of now.run.scenario.employees) {
        const where = `${employee.id} at ${moment.label}`;
        const d = dashboardAt(now, employee.id);
        const html = renderPage(readyState(d, real.businesses, now.run.runId), null, real.map);
        const text = textOf(html);

        const commute = elementWith(html, 'aria-labelledby="ew-commute-heading"');
        expect(commute, where).not.toBeNull();
        const c = textOf(commute!);
        // Issue 957: the band (earnings, then the assigned list with the next job) is first; the commute
        // comes after it and before the completed list.
        const first = text.indexOf('Saved commute');
        expect(first, where).toBeGreaterThan(text.indexOf('Assigned deliveries'));
        expect(text.indexOf('Earnings'), where).toBeGreaterThanOrEqual(0);
        expect(text.indexOf('Earnings'), where).toBeLessThan(text.indexOf('Assigned deliveries'));
        expect(first, where).toBeLessThan(text.indexOf('Completed deliveries'));

        expect(c, where).toContain(businessName(real.businesses, d.employee.businessId));
        expect(d.home.neighborhood.trim(), where).not.toBe('');
        expect(c, where).toContain(d.home.neighborhood);
        for (const direction of ['evening', 'morning'] as const) {
          const trip = d.trips.find((t) => t.direction === direction);
          const available = direction === 'evening' ? d.employee.availableEvening : d.employee.availableMorning;
          const departure = direction === 'evening' ? d.employee.eveningDepartureMin : d.employee.morningDepartureMin;
          if (available) {
            expect(trip, `${where}: the API sent no ${direction} trip`).toBeDefined();
            expect(trip!.departureMin, where).toBe(departure);
            expect(c, where).toContain(`Departs ${formatClock(trip!.departureMin)}`);
          } else {
            expect(c, where).toContain(`Not available in the ${direction}`);
          }
        }
        expect(c, where).toContain(`Up to ${d.employee.maxExtraMin} min extra per trip`);
        // The edit button follows the API phase; a locked run says why.
        const locked = d.phase === 'locked';
        expect(text.includes(LOCKED_TEXT), where).toBe(locked);
        expect(/<button[^>]*disabled=""[^>]*>Edit commute<\/button>/.test(commute!), where).toBe(locked);
        expect(c, where).toContain('Edit commute');
        expectCleanPage(html, where, real.run.scenario.homes, real.businesses);
      }
    }
  }, T);

  it('groups the deliveries by the API job status, with the API reward, extra minutes and status label', () => {
    for (const moment of moments) {
      const now = at(real, moment.timeMin);
      for (const employee of now.run.scenario.employees) {
        const where = `${employee.id} at ${moment.label}`;
        const d = dashboardAt(now, employee.id);
        const html = renderPage(readyState(d, real.businesses, now.run.runId), null, real.map);

        const assigned = elementWith(html, 'aria-labelledby="ew-assigned-heading"')!;
        const completed = elementWith(html, 'aria-labelledby="ew-completed-heading"')!;
        expect(jobIdsIn(assigned), where).toStrictEqual(d.assigned.map((v) => v.job.id));
        expect(jobIdsIn(completed), where).toStrictEqual(d.completed.map((v) => v.job.id));
        for (const v of d.assigned) expect(v.status, where).not.toBe('completed');
        for (const v of d.completed) expect(v.status, where).toBe('completed');
        // The status the snapshot gives each job, never one the browser worked out.
        for (const v of [...d.assigned, ...d.completed]) expect(v.status, where).toBe(now.snapshot.jobStatus[v.job.id] ?? 'assigned');

        for (const v of [...d.assigned, ...d.completed]) {
          const row = elementWith(html, `data-job-id="${v.job.id}"`);
          expect(row, `${where} ${v.job.id}`).not.toBeNull();
          const r = textOf(row!);
          expect(row!, where).toContain(`class="ew-status is-${v.status}"`);
          expect(r, where).toContain(STATUS_LABEL[v.status]);
          expect(r, where).toContain(v.shipment.label);
          expect(r, where).toContain(formatCents(v.job.rewardCents));
          expect(r, where).toContain(`+${v.plan.legs[v.job.legIndex].extraMin} min`);
          expect(r, where).toContain(businessName(real.businesses, v.job.pickup.placeId));
          expect(r, where).toContain(businessName(real.businesses, v.job.dropoff.placeId));
        }
      }
    }
  }, T);

  it('shows the API earnings in cents, formatted, and the empty state for an employee without jobs', () => {
    for (const moment of moments) {
      const now = at(real, moment.timeMin);
      for (const employee of now.run.scenario.employees) {
        const where = `${employee.id} at ${moment.label}`;
        const d = dashboardAt(now, employee.id);
        const html = renderPage(readyState(d, real.businesses, now.run.runId), null, real.map);

        const money = textOf(elementWith(html, 'class="ew-earnings"')!);
        expect(money, where).toBe(`Earned ${formatCents(d.earnedCents)} Projected ${formatCents(d.projectedCents)}`);
        expect(Number.isInteger(d.earnedCents) && Number.isInteger(d.projectedCents), where).toBe(true);

        const assigned = textOf(elementWith(html, 'aria-labelledby="ew-assigned-heading"')!);
        const completed = textOf(elementWith(html, 'aria-labelledby="ew-completed-heading"')!);
        if (d.assigned.length === 0) expect(assigned, where).toContain(EMPTY_TEXT);
        else expect(assigned, where).not.toContain(EMPTY_TEXT);
        if (d.completed.length === 0) expect(completed, where).toContain('No completed deliveries yet.');
        else expect(completed, where).not.toContain('No completed deliveries yet.');
      }
    }
  }, T);

  it('lists every job of the run on its own carrier page and nowhere else', () => {
    for (const moment of moments) {
      const now = at(real, moment.timeMin);
      const seen = new Map<string, string>();
      for (const employee of now.run.scenario.employees) {
        const d = dashboardAt(now, employee.id);
        for (const v of [...d.assigned, ...d.completed]) {
          expect(seen.has(v.job.id), `${v.job.id} at ${moment.label}`).toBe(false);
          expect(v.job.employeeId).toBe(employee.id);
          seen.set(v.job.id, employee.id);
        }
      }
      expect([...seen.keys()].sort()).toStrictEqual(now.run.jobs.map((j) => j.id).sort());
    }
  }, T);

  it('has employees both with and without jobs, so both page shapes above were really rendered', () => {
    const now = at(real, moments[0].timeMin);
    const counts = now.run.scenario.employees.map((e) => {
      const d = dashboardAt(now, e.id);
      return d.assigned.length + d.completed.length;
    });
    expect(counts.some((n) => n === 0)).toBe(true);
    expect(counts.some((n) => n > 0)).toBe(true);
  }, T);
});
