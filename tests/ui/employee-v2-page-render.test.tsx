import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import { LOCKED_MESSAGE, draftFromSaved, nextDraft } from '../../client/src/components/employee/v2/commuteFormModel';
import {
  RECONNECTING_TEXT, RUN_CHANGED_NOTE, TRAVEL_DATA_MISSING_TEXT, employeeWorkspaceReducer, initialWorkspaceState,
  type EmployeeWorkspaceState,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView, type EmployeePageViewProps } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { pageScreen, outcomeFromError } from '../../client/src/components/employee/v2/page/employeePageModel';
import { ApiRequestError } from '../../client/src/api/v2';
import { businesses as workBusinesses, dashboard } from './employee-v2-workspace-sample';
import { businesses as jobBusinesses, eveningDirect } from './employeeV2JobSample';

const businesses = [...workBusinesses, ...jobBusinesses];
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const noop = () => {};
const saveOk = async (): Promise<CommuteResponse> => ({ employee: dashboard.employee, home: dashboard.home, trips: [], rematchedShipmentIds: [] });

function ready(d: EmployeeDashboard = dashboard, runId = 'run-1'): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

function render(state: EmployeeWorkspaceState, p: Partial<EmployeePageViewProps> = {}) {
  return renderToStaticMarkup(
    <EmployeePageView
      state={state} jobId={null} saveCommute={saveOk} refetchNow={async () => {}} markSeen={noop}
      onCloseJob={noop} search={async () => []} employeeHref={(id) => `/nyc/employee/${id}`} {...p}
    />,
  );
}

/** No "hub", NaN or undefined in what a user can read. */
function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined/);
  expect(text(html)).not.toMatch(/hub/i);
}

describe('hook states', () => {
  it('loading', () => {
    const h = render(initialWorkspaceState);
    expect(text(h)).toContain('Loading your workspace');
    expectClean(h);
  });

  it('not_found links to a valid employee and the start page, without redirecting', () => {
    const h = render({ ...initialWorkspaceState, view: 'not_found', fallbackEmployeeId: 'emp-007' });
    expect(text(h)).toContain('This employee is not in the current city');
    expect(h).toContain('href="/nyc/employee/emp-007"');
    expect(h).toContain('href="/"');
    expectClean(h);
    const none = render({ ...initialWorkspaceState, view: 'not_found', fallbackEmployeeId: null });
    expect(text(none)).toContain('no employees in the current city');
    expect(none).not.toContain('/nyc/employee/');
  });

  it("unavailable shows the state's text", () => {
    const h = render({ ...initialWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT } });
    expect(text(h)).toContain('NYC travel data is not loaded on this server yet.');
    expectClean(h);
  });

  it('error has a Retry button', () => {
    const h = render({ ...initialWorkspaceState, view: 'error', error: 'Internal server error' });
    expect(text(h)).toContain('Internal server error');
    expect(h).toMatch(/<button[^>]*>Retry<\/button>/);
  });
});

// #584: the shell's <main id="main-content"> is the page's only main landmark.
describe('root element', () => {
  it('every screen is a <div class="ep"> and renders no <main>', () => {
    const job = { ...eveningDirect(), job: { ...eveningDirect().job, employeeId: dashboard.employee.id } } as JobResponse;
    const screens = [
      render(initialWorkspaceState),
      render({ ...initialWorkspaceState, view: 'not_found', fallbackEmployeeId: 'emp-007' }),
      render({ ...initialWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: 'x' } }),
      render({ ...initialWorkspaceState, view: 'error', error: 'HTTP 500' }),
      render(ready()),
      render(ready(), { jobId: 'job-x' }),
      render({ ...ready(), job }, { jobId: job.job.id }),
      render({ ...ready(), jobMissing: true }, { jobId: 'job-x' }),
    ];
    for (const h of screens) {
      expect(h.startsWith('<div class="ep"')).toBe(true);
      expect(h).not.toMatch(/<main[\s>]/);
    }
  });
});

describe('ready', () => {
  it('shows the workspace with the commute, deliveries and New marks', () => {
    const s = { ...ready(), newJobIds: [dashboard.assigned[0].job.id] };
    const h = render(s);
    const t = text(h);
    for (const part of ['Maya Chen', 'Saved commute', 'Assigned deliveries', 'Earnings', 'Completed deliveries']) expect(t).toContain(part);
    expect(h).toContain('class="ew-new"');
    expect(h).toMatch(/<button type="button" class="ew-btn">Edit commute<\/button>/);
    expect(t).not.toContain(RECONNECTING_TEXT);
    expectClean(h);
  });

  it('a failed poll after a first success keeps the content and shows the reconnecting line', () => {
    const s = employeeWorkspaceReducer(ready(), { type: 'dashboardFailed', error: new ApiRequestError(0, 'Failed to fetch') });
    const t = text(render(s));
    expect(t).toContain(RECONNECTING_TEXT);
    expect(t).toContain('Assigned deliveries');
  });

  it('a run change shows the note', () => {
    const s = employeeWorkspaceReducer(ready(), { type: 'dashboard', dashboard: { ...dashboard, version: 1 }, runId: 'run-2' });
    expect(s.runChanged).toBe(true);
    expect(text(render(s))).toContain(RUN_CHANGED_NOTE);
    expect(text(render(ready()))).not.toContain(RUN_CHANGED_NOTE);
  });

  it('renders the routePreview slot below the commute', () => {
    const t = text(render(ready(), { routePreview: <p>ROUTE PREVIEW</p> }));
    expect(t.indexOf('Saved commute')).toBeLessThan(t.indexOf('ROUTE PREVIEW'));
    expect(t.indexOf('ROUTE PREVIEW')).toBeLessThan(t.indexOf('Assigned deliveries'));
  });
});

describe('commute editor', () => {
  it('Edit commute puts the form with the address search in the commute slot', () => {
    const h = render(ready(), { initialEditing: true });
    const t = text(h);
    expect(t).toContain('Edit commute');
    expect(h).toContain('aria-label="Commute"');
    expect(t).toContain('Home: Astoria'); // the address search shows the saved home with Change
    expect(h).toMatch(/<button type="button" class="addr-search__btn">Change<\/button>/);
    expect(t).not.toContain('Saved commute');
    expect(t).toContain('Assigned deliveries');
    expectClean(h);
  });

  it('typed form input survives a poll with a newer version', () => {
    const v1 = ready();
    const typed = { ...draftFromSaved(dashboard.employee, dashboard.home), maxExtraMin: 22 };
    // A poll brings version 4: new objects, same saved commute values.
    const polled: EmployeeDashboard = JSON.parse(JSON.stringify({ ...dashboard, version: 4 }));
    const v2 = employeeWorkspaceReducer(v1, { type: 'dashboard', dashboard: polled, runId: 'run-1' });
    expect(v2.dashboard).not.toBe(v1.dashboard);
    expect(v2.dashboard!.version).toBe(4);
    // The page keeps the same screen (the form stays mounted) ...
    expect(pageScreen(v2, null)).toEqual(pageScreen(v1, null));
    // ... and the form's poll rule keeps the typed draft for the new props objects.
    const kept = nextDraft(typed, { employee: v1.dashboard!.employee, home: v1.dashboard!.home }, { employee: v2.dashboard!.employee, home: v2.dashboard!.home });
    expect(kept).toBe(typed);
    const h = render(v2, { initialEditing: true, initialDraft: kept });
    expect(h).toMatch(/type="number"[^>]*value="22"/);
  });

  it('saving disables the form and shows the slow-home hint', () => {
    const h = render(ready(), { initialEditing: true, initialOutcome: { kind: 'saving' } });
    expect(text(h)).toContain('Saving. A new home address can take a few seconds.');
    expect(h).toMatch(/<button type="button" class="ep-btn" disabled="">Close<\/button>/);
    expect(h).toContain('ep-form ep-form--quiet');
  });

  it('a successful save closes the form and shows the matched count from the response', () => {
    const h = render(ready(), { initialOutcome: { kind: 'saved', matched: 2 } });
    const t = text(h);
    expect(t).toContain('Commute saved. 2 waiting deliveries were matched.');
    expect(h).not.toContain('aria-label="Commute"');
    expect(t).toContain('Saved commute');
    const none = text(render(ready(), { initialOutcome: { kind: 'saved', matched: 0 } }));
    expect(none).toContain('Commute saved.');
    expect(none).not.toContain('were matched');
  });

  // #634: the note is for the moment after a save; it is not carried into a job view or the playback.
  it('the saved note is not shown in a job view or while the run is locked', () => {
    const saved = { initialOutcome: { kind: 'saved', matched: 1 } as const };
    expect(text(render(ready(), saved))).toContain('Commute saved.');
    expect(text(render(ready(), { ...saved, jobId: 'job-x' }))).not.toContain('Commute saved');
    const locked = text(render(ready({ ...dashboard, phase: 'locked' }), saved));
    expect(locked).not.toContain('Commute saved');
    expect(locked).toContain('Assigned deliveries');
  });

  it("a 409 keeps the form open with the server's text", () => {
    const outcome = outcomeFromError(new ApiRequestError(409, 'Planning is locked: start a new planning cycle.'));
    const h = render(ready(), { initialEditing: true, initialOutcome: outcome });
    expect(text(h)).toContain('Planning is locked: start a new planning cycle.');
    expect(h).toContain('aria-label="Commute"');
    expect(h).not.toContain(LOCKED_MESSAGE);
  });

  it('503 and timeout keep the form open with their text; 400 leaves the message to the form', () => {
    const e503 = outcomeFromError(new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing'));
    expect(text(render(ready(), { initialEditing: true, initialOutcome: e503 }))).toContain(TRAVEL_DATA_MISSING_TEXT);
    const timeout = outcomeFromError(new ApiRequestError(0, 'timed out', undefined, 'timeout'));
    const th = render(ready(), { initialEditing: true, initialOutcome: timeout });
    expect(text(th)).toContain('20 seconds');
    expect(th).toContain('aria-label="Commute"');
    const bad = render(ready(), { initialEditing: true, initialOutcome: { kind: 'invalid', message: 'Bad time' } });
    expect(bad).toContain('class="ep-form"');
    expect(bad).not.toContain('ep-form--quiet');
  });
});

describe('?job=', () => {
  const own: JobResponse = (() => { const j = eveningDirect(); return { ...j, job: { ...j.job, employeeId: 'emp-001' } }; })();

  /** #634: a job screen has exactly one h1, the employee's name, before the first h2. */
  function expectNameHeading(html: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Maya Chen<\/h1>/);
    const h2 = html.search(/<h2[\s>]/);
    if (h2 >= 0) expect(html.search(/<h1[\s>]/)).toBeLessThan(h2);
  }

  it('shows the job detail for one of my jobs', () => {
    const s = employeeWorkspaceReducer(ready(), { type: 'job', job: own });
    const h = render(s, { jobId: own.job.id });
    expect(text(h)).toContain('Brand proofs');
    expect(h).toMatch(/Back to deliveries/);
    expect(text(h)).not.toContain('Assigned deliveries');
    expectClean(h);
    expectNameHeading(h);
  });

  it('a missing job renders JobV2Missing', () => {
    const s = employeeWorkspaceReducer(ready(), { type: 'jobMissing' });
    const h = render(s, { jobId: 'job-gone' });
    const t = text(h);
    expect(t).toContain('This delivery is no longer assigned to you');
    expect(t).toContain('It was re-matched or the run changed. Your current deliveries are on your page.');
    expect(t).not.toMatch(/city/i);
    expect(t).toContain('Back to deliveries');
    expectNameHeading(h);
  });

  it("another employee's job renders JobV2Other with a link to its owner", () => {
    const s = employeeWorkspaceReducer(ready(), { type: 'job', job: eveningDirect() });
    const h = render(s, { jobId: eveningDirect().job.id });
    expect(text(h)).toContain('This delivery is assigned to another carrier');
    expect(text(h)).not.toMatch(/city/i);
    expect(text(h)).toContain('Back to deliveries');
    expect(h).toContain(`href="/employee/emp-01?job=${eveningDirect().job.id}"`);
    expect(text(h)).not.toContain('Brand proofs');
    expectNameHeading(h);
  });

  it('shows a loading line until the job arrives', () => {
    const h = render(ready(), { jobId: 'job-x' });
    expect(text(h)).toContain('Loading delivery');
    expectNameHeading(h);
  });

  it('the workspace keeps its one h1', () => {
    expect(render(ready()).match(/<h1[\s>]/g)).toHaveLength(1);
  });
});

describe('imports and CSS', () => {
  const root = join(__dirname, '../../client/src');
  const folder = join(root, 'components/employee/v2/page');
  const files = [join(root, 'pages/v2/EmployeeV2.tsx'), ...readdirSync(folder).filter((f) => /\.tsx?$/.test(f)).map((f) => join(folder, f))];
  const sources = files.map((f) => [f, readFileSync(f, 'utf8')] as const);

  it('imports API helpers only from client/src/api/v2 and nothing from MVP 1 employee files', () => {
    for (const [f, src] of sources) {
      const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const s of specs.filter((x) => x.startsWith('.'))) {
        const target = resolve(dirname(f), s);
        if (target.startsWith(join(root, 'api'))) expect(target, f).toBe(join(root, 'api/v2'));
        // MVP 1 employee files sit directly in components/employee/; v2 files are under v2/.
        if (target.startsWith(join(root, 'components/employee/'))) expect(target, f).toMatch(/components\/employee\/v2\//);
      }
      expect(src, f).not.toMatch(/['"`][^'"`]*\bhub\b[^'"`]*['"`]/i);
    }
  });

  it('the page CSS has no fixed width above 390 px', () => {
    const css = readFileSync(join(folder, 'employeePage.css'), 'utf8');
    const widths = [...css.matchAll(/(?:^|[\s;{])(min-width|width)\s*:\s*(\d+)px/g)].map((m) => Number(m[2]));
    expect(widths.every((w) => w <= 390)).toBe(true);
    expect(css).toMatch(/@media \(max-width: 390px\)/);
  });
});
