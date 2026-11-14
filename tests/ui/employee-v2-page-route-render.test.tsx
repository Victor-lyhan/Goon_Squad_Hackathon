import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { pageScreen } from '../../client/src/components/employee/v2/page/employeePageModel';
import { RouteSlot } from '../../client/src/components/employee/v2/page/RouteSlot';
import { MAP_FAILED_TEXT, MAP_LOADING_TEXT, type RunMapSlot } from '../../client/src/components/employee/v2/page/runMapModel';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, TRIPS, WORK, withLine } from './employee-v2-route-sample';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const noop = () => {};
/** How many times `piece` is in `whole`. */
const count = (whole: string, piece: string) => whole.split(piece).length - 1;
const legendOf = (html: string) => html.match(/<ul class="ecr__legend"[\s\S]*?<\/ul>/)![0];
const previewOf = (html: string) => html.match(/<section class="ecr"[\s\S]*?<\/section>/)![0];
const saveOk = async (): Promise<CommuteResponse> => ({ employee: DASHBOARD.employee, home: HOME, trips: TRIPS, rematchedShipmentIds: [] });
const JOB_RESPONSE: JobResponse = { ...JOB, trip: TRIPS[0] };

function ready(d: EmployeeDashboard = DASHBOARD): EmployeeWorkspaceState {
  let s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  s = employeeWorkspaceReducer(s, { type: 'businesses', businesses: BUSINESSES });
  return s;
}
const withJob = (s: EmployeeWorkspaceState) => employeeWorkspaceReducer(s, { type: 'job', job: JOB_RESPONSE });

/** The page the way EmployeeV2 assembles it: the job goes to the preview only when it is the open, own job. */
function renderPage(state: EmployeeWorkspaceState, jobId: string | null, slot: RunMapSlot = { kind: 'map', map: MAP }) {
  const job = pageScreen(state, jobId).kind === 'job' ? state.job : null;
  const routePreview = state.dashboard
    ? <RouteSlot slot={slot} dashboard={state.dashboard} businesses={state.businesses} job={job} onRetry={noop} />
    : null;
  return renderToStaticMarkup(
    <EmployeePageView
      state={state} jobId={jobId} saveCommute={saveOk} refetchNow={async () => {}} markSeen={noop}
      onCloseJob={noop} search={async () => []} employeeHref={(id) => `/nyc/employee/${id}`} routePreview={routePreview}
    />,
  );
}

beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

describe('route preview in the Employee page', () => {
  it('shows the commute on the map below the commute summary, with no job stops', () => {
    const html = renderPage(ready(), null);
    const t = text(html);
    expect(html).toContain('aria-label="Your commute on the map"');
    expect(t).toContain('Evening: 34 min, 9.8 km'); // the trip's own fields
    expect(t).toContain('Morning: 31 min, 9.7 km');
    expect(html).not.toContain('aria-label="Delivery stops"');
    expect(t).not.toContain('Route line not loaded yet');
    // The deliveries list keeps working next to the preview.
    expect(t).toContain('Sample boxes');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('each commute departure is on the workspace once, as "5:30 PM", in the commute card (#626)', () => {
    const html = renderPage(ready(), null);
    const t = text(html);
    expect(count(t, '5:30 PM')).toBe(1); // the evening departure
    expect(count(t, '8:30 AM')).toBe(1); // the morning departure
    expect(t).toContain('Departs 5:30 PM');
    expect(t).toContain('Departs 8:30 AM');
    expect(t).not.toMatch(/[ap]\.m\./);
    expect(t).not.toContain('leaves');
    // The card comes first; the preview below it repeats no clock time.
    expect(html.indexOf('ew-commute-heading')).toBeLessThan(html.indexOf('class="ecr"'));
    const preview = text(previewOf(html));
    expect(preview).not.toMatch(/\d:\d\d/);
    // The map cannot load here (no key): the text under it still names both directions.
    expect(preview).toContain('Google Maps key missing.');
    expect(preview).toContain('Evening: 34 min, 9.8 km');
    expect(preview).toContain('Morning: 31 min, 9.7 km');
  });

  it('the legend lists "Delivery route" only when one is drawn: not on the workspace, yes with a job open (#626)', () => {
    const workspace = renderPage(ready(), null);
    expect(text(legendOf(workspace))).toBe('Your normal commute');
    expect(text(previewOf(workspace))).not.toContain('Delivery route');

    const open = renderPage(withJob(ready()), JOB.job.id);
    expect(text(legendOf(open))).toBe('Your normal commute Delivery route');
    expect(text(open)).not.toMatch(/[ap]\.m\./);

    // A job is open but none of its lines is cached: nothing of it is drawn, so nothing is listed.
    const noLines = renderPage(withJob(ready()), JOB.job.id, { kind: 'map', map: { ...MAP, polylines: MAP.polylines.slice(0, 2) } });
    expect(text(legendOf(noLines))).toBe('Your normal commute');
  });

  it('numbers the open job stops on the map; closing the job removes them', () => {
    const open = renderPage(withJob(ready()), JOB.job.id);
    expect(open).toContain('aria-label="Delivery stops"');
    const t = text(open);
    expect(t).toContain('1 Pickup · Bakery Row');
    expect(t).toContain('2 Drop at relay point · Atlas Books');
    expect(open).toContain('aria-label="Your commute on the map"');

    const closed = renderPage(withJob(ready()), null);
    expect(closed).toContain('aria-label="Your commute on the map"');
    expect(closed).not.toContain('aria-label="Delivery stops"');
  });

  it('does not pass a job that is still loading', () => {
    const html = renderPage(ready(), JOB.job.id);
    expect(html).not.toContain('aria-label="Your commute on the map"');
    expect(html).not.toContain('aria-label="Delivery stops"');
  });

  it('a commute pair without a cached line reads "Route line not loaded yet"', () => {
    const html = renderPage(ready(), null, { kind: 'map', map: withLine(WORK.id, HOME.id, null) });
    expect(text(html)).toContain('Route line not loaded yet');
  });

  it('a one-line loading note while the map is pending', () => {
    const html = renderPage(ready(), null, { kind: 'loading', text: MAP_LOADING_TEXT });
    expect(html).toContain(`<p class="ep-route-note" role="status">${MAP_LOADING_TEXT}</p>`);
    expect(html).not.toContain('aria-label="Your commute on the map"');
    expect(text(html)).toContain('Sample boxes');
  });

  it('a failure shows a short message with Retry, and the rest of the page keeps working', () => {
    const html = renderPage(ready(), null, { kind: 'failed', text: MAP_FAILED_TEXT, map: null });
    const t = text(html);
    expect(t).toContain(`${MAP_FAILED_TEXT} Retry`);
    expect(html).toMatch(/<button type="button" class="ep-btn ep-btn-link">Retry<\/button>/);
    expect(t).toContain('Edit commute');
    expect(t).toContain('Sample boxes');
    const job = renderPage(withJob(ready()), JOB.job.id, { kind: 'failed', text: MAP_FAILED_TEXT, map: null });
    expect(text(job)).toContain(MAP_FAILED_TEXT);
    expect(text(job)).toContain('Sample boxes');
  });

  it('nothing extra in the slot for travel_data_missing', () => {
    const html = renderPage(ready(), null, { kind: 'none' });
    expect(html).not.toContain('ep-route');
    expect(text(html)).toContain('Sample boxes');
  });
});

describe('390 px', () => {
  const css = readFileSync('client/src/components/employee/v2/page/employeePage.css', 'utf8');
  it('the slot can shrink and sets no fixed width wider than 390 px', () => {
    expect(css).toMatch(/\.ep-route\s*\{[^}]*min-width:\s*0/);
    const widths = [...css.matchAll(/(?:^|[^-])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(widths.every((w) => w <= 390)).toBe(true);
  });
});
