// Issue #513: the MVP II job detail (`?job=`) rendered from the real GET /api/v2/jobs/:id answers of the default
// NYC run, for every job at five moments of the day (DECISIONS pass 56). Demo step 4 (the new job with its stops
// and reward) runs through this view. Rules only: no story ID, name or count is pinned (pass 54).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobResponse } from '../../shared/v2/api';
import type { Stop } from '../../shared/v2/types';
import { formatCents } from '../../client/src/ui/format';
import { STOP_ACTION, clock24, extraDistanceText } from '../../client/src/components/employee/v2/jobDetailV2Model';
import {
  STATUS_LABEL, T, at, buildRealRun, businessName, dashboardAt, elementWith, expectCleanPage, jobAt, momentsOf,
  readyState, renderPage, textOf, type Moment, type RealRun,
} from './employee-v2-real-helper';

let real: RealRun;
let moments: Moment[];

beforeAll(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  real = buildRealRun();
  moments = momentsOf(real);
}, T);
afterAll(() => vi.unstubAllEnvs());

const legOf = (j: JobResponse) => j.plan.legs[j.job.legIndex];

/** The `<li>` rows of the job's route, in order: kind and visible text. */
function routeRows(html: string): { kind: string; text: string }[] {
  const list = elementWith(html, 'class="job-v2__route"');
  if (!list) throw new Error('the job detail has no route list');
  return [...list.matchAll(/<li[^>]*data-kind="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ kind: m[1], text: textOf(m[2]) }));
}

/** "17:32–17:34" or "17:15" to minutes of the day, in order of appearance. */
const minutesIn = (time: string) => [...time.matchAll(/(\d{2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));

/** Renders every job of the run at every moment, as the page shows `?job=<id>` on its carrier's page. */
function eachJob(fn: (j: JobResponse, html: string, where: string) => void) {
  for (const moment of moments) {
    const now = at(real, moment.timeMin);
    expect(now.run.jobs.length).toBeGreaterThan(0);
    for (const { id } of now.run.jobs) {
      const j = jobAt(now, id);
      const d = dashboardAt(now, j.job.employeeId);
      const html = renderPage(readyState(d, real.businesses, now.run.runId, j), id, real.map);
      fn(j, html, `${id} at ${moment.label}`);
    }
  }
}

describe('job detail on the real NYC run, every job at five moments', () => {
  it('opens the detail (not a loading, missing or other-employee state)', () => {
    eachJob((j, html, where) => {
      expect(html, where).toContain('class="job-v2"');
      expect(textOf(elementWith(html, 'id="job-v2-title"')!), where).toBe(j.shipment.label);
    });
  }, T);

  it('lists the stops in order, at network businesses of the directory, with times that never go back', () => {
    eachJob((j, html, where) => {
      const leg = legOf(j);
      expect(leg, where).toBeDefined();
      const stops: Stop[] = leg.stops;
      expect(stops.length, where).toBeGreaterThanOrEqual(2);
      // The API's own order and times never go back.
      const apiTimes = [j.trip.departureMin, ...stops.flatMap((s) => [s.arrivalMin, s.serviceStartMin, s.serviceEndMin]), leg.finishMin];
      for (let i = 1; i < apiTimes.length; i++) expect(apiTimes[i], `${where}: API time ${i}`).toBeGreaterThanOrEqual(apiTimes[i - 1]);

      const rows = routeRows(html);
      expect(rows.map((r) => r.kind), where).toStrictEqual(['start', ...stops.map((s) => s.kind), 'end']);
      stops.forEach((s, i) => {
        const row = rows[i + 1];
        expect(real.businesses.some((b) => b.id === s.placeId), `${where}: stop ${i + 1} at ${s.placeId}`).toBe(true);
        expect(row.text, where).toContain(businessName(real.businesses, s.placeId));
        expect(row.text, where).toContain(`${clock24(s.arrivalMin)}–${clock24(s.serviceEndMin)}`);
        expect(row.text, where).toContain(STOP_ACTION[s.kind]);
      });
      // What the page shows never goes back either, start to end (no leg crosses midnight on screen).
      const shown = rows.flatMap((r) => minutesIn(r.text.slice(0, 12)));
      for (let i = 1; i < shown.length; i++) expect(shown[i], `${where}: shown time ${i}`).toBeGreaterThanOrEqual(shown[i - 1]);
      // The commute ends are a business (by name) or the home (by neighborhood only).
      const ends = [rows[0].text, rows[rows.length - 1].text];
      expect(ends.some((t) => t.includes('Home ·')), where).toBe(true);
    });
  }, T);

  it('explains a relay leg naming the relay business, and shows no relay text on a direct delivery', () => {
    let relays = 0;
    eachJob((j, html, where) => {
      const relay = elementWith(html, 'class="job-v2__relay"');
      if (j.plan.kind === 'relay') {
        relays += 1;
        expect(j.plan.relayBusinessId, where).toBeTruthy();
        expect(relay, where).not.toBeNull();
        const t = textOf(relay!);
        expect(t, where).toContain(businessName(real.businesses, j.plan.relayBusinessId!));
        const other = j.job.legIndex === 0 ? j.shipment.destinationBusinessId : j.shipment.originBusinessId;
        expect(t, where).toContain(businessName(real.businesses, other));
        // The relay stop of this leg is that business.
        const relayStops = legOf(j).stops.filter((s) => s.kind === 'hub_drop' || s.kind === 'hub_pickup');
        expect(relayStops.length, where).toBe(1);
        expect(relayStops[0].placeId, where).toBe(j.plan.relayBusinessId);
      } else {
        expect(relay, where).toBeNull();
      }
    });
    // Not pinned to a number: the run must simply have a relay for this rule to be exercised (SPEC demo step 5).
    expect(relays).toBeGreaterThan(0);
  }, T);

  it('shows the API extra minutes, reward and status', () => {
    eachJob((j, html, where) => {
      const numbers = textOf(elementWith(html, 'class="job-v2__numbers"')!);
      // Reward first, then extra time, then extra distance (#551).
      expect(numbers, where).toContain(`Reward ${formatCents(j.job.rewardCents)} Extra time +${legOf(j).extraMin} min Extra distance `);
      // The API's extra distance in words (#551): "+3.4 km", "5.5 km shorter" or "No extra distance".
      const d = legOf(j).extraDistanceM;
      const km = (Math.round(Math.abs(d) / 100) / 10).toString();
      const words = km === '0' ? 'No extra distance' : d < 0 ? `${km} km shorter` : `+${km} km`;
      expect(numbers, where).toContain(`Extra distance ${words}`);
      expect(html, where).toContain(`data-status="${j.status}"`);
      expect(textOf(elementWith(html, 'class="job-v2__status"')!), where).toContain(STATUS_LABEL[j.status]);
    });
  }, T);

  it('has a leg whose detour is shorter than the usual commute, so the "shorter" wording above is exercised', () => {
    // Real Google routes do this; the sample data never did. Not a count: just that the case exists.
    expect(real.run.assignments.plans.some((p) => p.legs.some((l) => l.extraDistanceM <= -50))).toBe(true);
    expect(extraDistanceText(-5496)).toBe('5.5 km shorter');
    expect(extraDistanceText(-16)).toBe('No extra distance');
    expect(extraDistanceText(3400)).toBe('+3.4 km');
  }, T);

  it('never puts a minus sign directly before a number, nor NaN or undefined, anywhere in the job view (#551)', () => {
    eachJob((_j, html, where) => {
      const view = elementWith(html, 'class="job-v2"');
      expect(view, where).not.toBeNull();
      const t = textOf(view!);
      // A sign: an ASCII hyphen or Unicode minus not joined to a word before it. Queens house numbers
      // ("10-93 Jackson Avenue") and the en dash of "17:32–17:34" are not signs.
      const m = /(?:^|[^\w])[-\u2212]\s*\d/.exec(t);
      if (m) throw new Error(`${where}: a minus before a number in the job view: ${t.slice(Math.max(0, m.index - 60), m.index + 20)}`);
      expect(t, where).not.toMatch(/NaN|undefined/);
      expect(textOf(elementWith(html, 'class="job-v2__numbers"')!), where).not.toContain('+0 km');
    });
  }, T);

  it('numbers the same stops under the route preview, by business name', () => {
    eachJob((j, html, where) => {
      const list = elementWith(html, 'aria-label="Delivery stops"');
      expect(list, where).not.toBeNull();
      const labels = [...list!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
      const stops = legOf(j).stops;
      expect(labels.length, where).toBe(stops.length);
      stops.forEach((s, i) => {
        expect(labels[i].startsWith(`${i + 1} `), where).toBe(true);
        expect(labels[i], where).toContain(businessName(real.businesses, s.placeId));
      });
    });
  }, T);

  it('never shows undefined, NaN, null, Invalid, "hub", a coordinate or a home street address', () => {
    eachJob((_j, html, where) => expectCleanPage(html, where, real.run.scenario.homes, real.businesses));
  }, T);
});
