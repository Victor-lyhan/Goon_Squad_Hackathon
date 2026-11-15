// Issue #882: design audit of the Employee page (commute, deliveries, job view). Each block pins one
// finding of the headless-Chrome pass at 1440, 900 and 390 px and its fix:
//   1. loading, empty and error states in plain words, for the page and for the job view;
//   2. words: the simulator's status words, no "hub", "trip id" or raw ID, numbers in IBM Plex Mono;
//   3. the job route is a checklist that says each row's state in words;
//   4. 44 px touch targets on a phone, with the phone rules starting at 480 px;
//   5. keyboard and screen reader: named row links, one look for the secondary buttons, a tidy focus ring.
// Static markup and the CSS text only; no browser and no network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import { ApiRequestError } from '../../client/src/api/v2';
import { EmployeeWorkspace } from '../../client/src/components/employee/v2/EmployeeWorkspace';
import {
  COMPLETED_EMPTY, EMPTY_TEXT, EMPTY_TITLE, EMPTY_WHY, EMPTY_WHY_UNAVAILABLE, assignedEmpty, commuteSummary, deliveryRows,
} from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { JobDetailV2 } from '../../client/src/components/employee/v2/JobDetailV2';
import {
  JOB_FAILED_TEXT, JOB_FAILED_TITLE, JOB_MISSING_TEXT, JOB_MISSING_TITLE, ROW_NOT_DONE_TEXT, STOP_ACTION, jobDetail,
} from '../../client/src/components/employee/v2/jobDetailV2Model';
import { createEmployeePoller, type EmployeeWorkspaceApi } from '../../client/src/components/employee/v2/live/employeePoller';
import {
  CANT_REACH_TEXT, SERVER_ERROR_TEXT, TOO_SLOW_TEXT, employeeWorkspaceReducer, initialWorkspaceState, loadErrorText,
  type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView, type EmployeePageViewProps } from '../../client/src/components/employee/v2/page/EmployeePageView';
import {
  ERROR_TITLE, JOB_LOADING_TEXT, LOADING_TEXT, pageScreen,
} from '../../client/src/components/employee/v2/page/employeePageModel';
import { JOB_STATUS_LABEL } from '../../client/src/components/sim/v2/inspector/inspectorModel';
import {
  V2_DIR, accessibleName, all, matchesSelector, parseCss, parseHtml, tabOrder, textOf, v2CssFiles, type CssRule, type El,
} from './employee-v2-qa-helpers';
import { businesses as workBusinesses, dashboard, emptyDashboard } from './employee-v2-workspace-sample';
import { dash, jobResponse } from './employeeV2DataSample';
import { STATUSES, businesses as jobBusinesses, eveningDirect, morningDirect, relayLeg1, relayLeg2 } from './employeeV2JobSample';

const businesses = [...workBusinesses, ...jobBusinesses];
const noop = () => {};
const saveOk = async (): Promise<CommuteResponse> => ({ employee: dashboard.employee, home: dashboard.home, trips: [], rematchedShipmentIds: [] });
const text = (html: string) => textOf(parseHtml(html));

function ready(d: EmployeeDashboard = dashboard): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

function page(state: EmployeeWorkspaceState, p: Partial<EmployeePageViewProps> = {}): string {
  return renderToStaticMarkup(
    <EmployeePageView
      state={state} jobId={null} saveCommute={saveOk} refetchNow={async () => {}} markSeen={noop}
      onCloseJob={noop} search={async () => []} employeeHref={(id) => `/employee/${id}`} {...p}
    />,
  );
}

const jobHtml = (job: JobResponse) =>
  renderToStaticMarkup(<JobDetailV2 job={job} businesses={businesses} homeNeighborhood="Astoria" onBack={noop} />);

/** The dashboard of the carrier of `job`, so the page shows the job view and not "another carrier". */
const dashboardOf = (job: JobResponse): EmployeeDashboard => ({ ...dashboard, employee: { ...dashboard.employee, id: job.job.employeeId } });

// ---------- CSS ----------

const cssOf = (name: string) => parseCss(readFileSync(join(V2_DIR, name), 'utf8'));
const ALL_RULES = v2CssFiles().flatMap((f) => parseCss(readFileSync(f, 'utf8')));
const selectors = (r: CssRule) => r.selector.split(',').map((s) => s.replace(/\s+/g, ' ').trim());
/** The widest screen a rule's `max-width` media reaches; Infinity for a rule outside any width media. */
const reach = (r: CssRule) => {
  const widths = r.media.flatMap((m) => [...m.matchAll(/max-width:\s*(\d+)px/g)].map((x) => Number(x[1])));
  return widths.length ? Math.min(...widths) : Infinity;
};
/** The value a 390 px screen gets for `prop` on `selector`: the last rule that applies there wins. */
function at390(rules: CssRule[], selector: string, prop: string): string | undefined {
  let value: string | undefined;
  for (const r of rules) {
    if (reach(r) < 390 || r.media.some((m) => /min-width|prefers-/.test(m)) || !selectors(r).includes(selector)) continue;
    for (const d of r.decls) if (d.prop === prop) value = d.value;
  }
  return value;
}
/** The value outside every media query. */
function base(rules: CssRule[], selector: string, prop: string): string | undefined {
  let value: string | undefined;
  for (const r of rules) {
    if (r.media.length || !selectors(r).includes(selector)) continue;
    for (const d of r.decls) if (d.prop === prop) value = d.value;
  }
  return value;
}

// ---------- 1. States in plain words ----------

describe('#882 states: loading, empty and error in plain words', () => {
  const CLIENT_WORDS = /Failed to fetch|Request failed|timed out after|Network error|NaN|undefined|\b[45]\d\d\b/;

  it('loading names what is loading: the commute and the deliveries, then the one delivery', () => {
    expect(LOADING_TEXT).toBe('Loading your commute and deliveries…');
    expect(JOB_LOADING_TEXT).toBe('Loading this delivery…');
    const html = page(initialWorkspaceState);
    expect(html).toContain(`<p class="ep-state" role="status">${LOADING_TEXT}</p>`);
    // A job link opened directly shows the employee's name and the job's own loading line.
    const job = page(ready(), { jobId: 'job-x' });
    expect(text(job)).toContain(JOB_LOADING_TEXT);
    expect(text(job)).not.toContain(LOADING_TEXT);
  });

  it('a failed first load says what happened and what to do, never the HTTP client\'s own words', () => {
    const cases: [string, unknown, string][] = [
      ['no connection', new ApiRequestError(0, 'Failed to fetch', undefined, 'network'), CANT_REACH_TEXT],
      ['a timeout', new ApiRequestError(0, 'Request timed out after 8000 ms', undefined, 'timeout'), TOO_SLOW_TEXT],
      ['a 500 with no body', new ApiRequestError(500, 'Request failed (500)'), SERVER_ERROR_TEXT],
      ['a 502 with an empty message', new ApiRequestError(502, ''), SERVER_ERROR_TEXT],
      ['something that is not an API error', new TypeError('x is not a function'), SERVER_ERROR_TEXT],
    ];
    for (const [name, error, want] of cases) {
      expect(loadErrorText(error), name).toBe(want);
      const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboardFailed', error });
      expect(s.view, name).toBe('error');
      const html = page(s);
      expect(text(html), name).toContain(`${ERROR_TITLE} ${want} Retry`);
      expect(text(html), name).not.toMatch(CLIENT_WORDS);
      expect(html, name).toMatch(/<section class="ep-state ep-problem" role="alert">/);
    }
    expect(ERROR_TITLE).toBe('Your commute and deliveries could not be loaded');
    expect(CANT_REACH_TEXT).toMatch(/^Can't reach the Relay server\./); // the header banner's and the simulator's sentence
  });

  it('a sentence the server wrote itself is shown as it is', () => {
    const own = 'The run is being rebuilt. Try again in a few seconds.';
    expect(loadErrorText(new ApiRequestError(500, own))).toBe(own);
  });

  it('an empty assigned list says "No deliveries for you yet" and why', () => {
    expect(EMPTY_TITLE).toBe('No deliveries for you yet.');
    expect(EMPTY_TEXT).toBe(`${EMPTY_TITLE} ${EMPTY_WHY}`);
    const html = renderToStaticMarkup(<EmployeeWorkspace dashboard={emptyDashboard} businesses={businesses} />);
    const root = parseHtml(html);
    const [assigned, completed] = all(root, (e) => e.attrs.class === 'ew-empty');
    expect(textOf(assigned)).toBe(`${EMPTY_TITLE} ${EMPTY_WHY}`);
    expect(textOf(completed)).toBe(`${COMPLETED_EMPTY.title} ${COMPLETED_EMPTY.why}`);
    // The title is its own element, in ink; the reason after it is muted.
    expect(html).toContain(`<p class="ew-empty"><span class="ew-empty-title">${EMPTY_TITLE}</span> ${EMPTY_WHY}</p>`);
    expect(base(cssOf('EmployeeWorkspace.css'), '.ew-empty-title', 'font-weight')).toBe('600');
    for (const t of [EMPTY_WHY, EMPTY_WHY_UNAVAILABLE, COMPLETED_EMPTY.why]) expect(t).not.toMatch(/hub|automatic|trip id/i);
  });

  it('the reason is the saved commute\'s when both commutes are switched off', () => {
    const off: EmployeeDashboard = {
      ...emptyDashboard, employee: { ...emptyDashboard.employee, availableEvening: false, availableMorning: false },
    };
    expect(assignedEmpty(commuteSummary(off, businesses))).toEqual({ title: EMPTY_TITLE, why: EMPTY_WHY_UNAVAILABLE });
    expect(assignedEmpty(commuteSummary(emptyDashboard, businesses))).toEqual({ title: EMPTY_TITLE, why: EMPTY_WHY });
    const html = renderToStaticMarkup(<EmployeeWorkspace dashboard={off} businesses={businesses} />);
    expect(text(html)).toContain(`${EMPTY_TITLE} ${EMPTY_WHY_UNAVAILABLE}`);
    expect(EMPTY_WHY_UNAVAILABLE).toContain('Edit commute'); // the button that changes it, by its name
    // One commute still on: the general reason.
    const evening = { ...off, employee: { ...off.employee, availableEvening: true } };
    expect(assignedEmpty(commuteSummary(evening, businesses)).why).toBe(EMPTY_WHY);
  });

  it('the job view has an empty state (the delivery is gone) and an error state (its request failed)', () => {
    const gone = page(employeeWorkspaceReducer(ready(), { type: 'jobMissing' }), { jobId: 'job-x' });
    expect(text(gone)).toContain(`${JOB_MISSING_TITLE} ${JOB_MISSING_TEXT} Back to deliveries`);

    const failed = employeeWorkspaceReducer(ready(), { type: 'jobFailed' });
    expect(failed.jobFailed).toBe(true);
    expect(pageScreen(failed, 'job-x')).toEqual({ kind: 'job_failed' });
    const html = page(failed, { jobId: 'job-x' });
    expect(text(html)).toContain(`${dashboard.employee.name} ${JOB_FAILED_TITLE} ${JOB_FAILED_TEXT} Back to deliveries`);
    expect(text(html)).not.toContain(JOB_LOADING_TEXT);
    expect(text(html)).not.toMatch(CLIENT_WORDS);
    expect(JOB_FAILED_TITLE).toBe('This delivery could not be loaded');
    // With no `?job=` the flag shows nothing: the workspace is on screen.
    expect(pageScreen(failed, null)).toEqual({ kind: 'workspace' });
  });

  it('a failed job request keeps a job that is on screen, and the next answer clears the failure', () => {
    const job = eveningDirect('in_progress');
    const shown = employeeWorkspaceReducer(ready(dashboardOf(job)), { type: 'job', job });
    expect(employeeWorkspaceReducer(shown, { type: 'jobFailed' })).toBe(shown); // same object: nothing re-renders
    expect(pageScreen(shown, job.job.id)).toEqual({ kind: 'job' });

    const failed = employeeWorkspaceReducer(ready(dashboardOf(job)), { type: 'jobFailed' });
    expect(employeeWorkspaceReducer(failed, { type: 'jobFailed' })).toBe(failed);
    const back = employeeWorkspaceReducer(failed, { type: 'job', job });
    expect(back.jobFailed).toBe(false);
    expect(pageScreen(back, job.job.id)).toEqual({ kind: 'job' });
    // A 404, another job and a new run each clear it too.
    expect(employeeWorkspaceReducer(failed, { type: 'jobMissing' })).toMatchObject({ jobFailed: false, jobMissing: true });
    expect(employeeWorkspaceReducer(failed, { type: 'jobCleared' }).jobFailed).toBe(false);
    const gone = employeeWorkspaceReducer(employeeWorkspaceReducer(ready(), { type: 'jobMissing' }), { type: 'jobFailed' });
    expect(gone).toMatchObject({ jobFailed: false, jobMissing: true }); // "no longer assigned" is not replaced
    const newRun = employeeWorkspaceReducer(failed, { type: 'dashboard', dashboard: { ...dashboardOf(job), version: 9 }, runId: 'run-2' });
    expect(newRun.jobFailed).toBe(false);
  });
});

describe('#882 the poller reports a failed job request', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(getJob: EmployeeWorkspaceApi['getJob']) {
    let state = initialWorkspaceState;
    const actions: WorkspaceAction[] = [];
    const api: EmployeeWorkspaceApi = {
      getEmployeeDashboard: async () => dash(1, ['job-1']),
      getJob,
      getBusinesses: async () => ({ businesses: [] }),
      getEmployees: async () => ({ employees: [] }),
      getMap: async () => ({ runId: 'run-1' }),
    };
    const poller = createEmployeePoller('emp-01', api, {
      dispatch: (a) => { actions.push(a); state = employeeWorkspaceReducer(state, a); },
    });
    return { poller, actions, get: () => state };
  }

  it('a 500 on the job is "could not be loaded", and the next good answer shows the job', async () => {
    let fail = true;
    const f = setup(async (id) => {
      if (fail) throw new ApiRequestError(500, 'Request failed (500)');
      return jobResponse(id);
    });
    f.poller.watchJob('job-1');
    f.poller.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.get().view).toBe('ready');
    expect(f.get().jobFailed).toBe(true);
    expect(pageScreen(f.get(), 'job-1')).toEqual({ kind: 'job_failed' });
    fail = false;
    await vi.advanceTimersByTimeAsync(1000); // the poller asks again on its own: no Retry button needed
    expect(f.get().jobFailed).toBe(false);
    expect(pageScreen(f.get(), 'job-1')).toEqual({ kind: 'job' });
    f.poller.stop();
  });

  it('a 404 stays "no longer assigned to you" and an aborted request says nothing', async () => {
    const gone = setup(async () => { throw new ApiRequestError(404, 'Unknown job'); });
    gone.poller.watchJob('job-1');
    gone.poller.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(gone.get()).toMatchObject({ jobMissing: true, jobFailed: false });
    gone.poller.stop();

    const aborted = setup(async () => { throw new ApiRequestError(0, 'Request aborted', undefined, 'abort'); });
    aborted.poller.watchJob('job-1');
    aborted.poller.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(aborted.actions.some((a) => a.type === 'jobFailed')).toBe(false);
    expect(pageScreen(aborted.get(), 'job-1')).toEqual({ kind: 'job_loading' });
    aborted.poller.stop();
  });
});

// ---------- 2. Words and numbers ----------

describe('#882 words: the simulator\'s status words, no jargon, numbers in mono', () => {
  const jobs = [eveningDirect, morningDirect, relayLeg1, relayLeg2];
  const screens: [string, string][] = [
    ['workspace', page(ready())],
    ['editor', page(ready(), { initialEditing: true })],
    ['empty workspace', page(ready(emptyDashboard))],
    ['loading', page(initialWorkspaceState)],
    ['job failed', page(employeeWorkspaceReducer(ready(), { type: 'jobFailed' }), { jobId: 'job-x' })],
    ...jobs.flatMap((make) => STATUSES.map((s): [string, string] => [`${make.name} ${s}`, jobHtml(make(s))])),
  ];

  it('a job\'s status reads as in the simulator\'s inspector, in the list and in the job view', () => {
    for (const status of STATUSES) {
      const view = { ...dashboard.assigned[0], status };
      expect(deliveryRows([view], businesses, 'Astoria')[0].statusLabel).toBe(JOB_STATUS_LABEL[status]);
      expect(jobDetail(eveningDirect(status), businesses, 'Astoria').statusLabel).toBe(JOB_STATUS_LABEL[status]);
    }
    expect(text(page(ready()))).toContain('Completed deliveries'); // the list is named after the status word
  });

  it('no screen says "hub" or "trip id", or shows a raw ID, in its text or in a name read aloud', () => {
    const JARGON = /\bhubs?\b|trip id|\b(emp|job|shp|plan|trip|biz|home)-[\w.-]+/i;
    for (const [name, html] of screens) {
      expect(text(html), name).not.toMatch(JARGON);
      for (const [, label] of html.matchAll(/aria-label="([^"]*)"/g)) expect(label, name).not.toMatch(JARGON);
    }
    for (const action of Object.values(STOP_ACTION)) expect(action).not.toMatch(/hub/i);
    expect(STOP_ACTION.hub_drop).toContain('relay point');
    expect(STOP_ACTION.hub_pickup).toContain('relay point');
  });

  it('every time, distance, duration and amount of money is set in IBM Plex Mono', () => {
    // The selectors this folder's CSS sets in the mono family, read from the CSS itself.
    const mono = ALL_RULES
      .filter((r) => r.decls.some((d) => (d.prop === 'font-family' || d.prop === 'font') && d.value.includes('--font-mono')))
      .flatMap(selectors);
    expect(mono).toEqual(expect.arrayContaining(['.ew-mono', '.job-v2__time', '.job-v2__trip', '.job-v2__number dd']));
    const NUMBER = /\d{1,2}:\d{2}\s?(AM|PM)|\$\d|\b\d+(\.\d+)?\s?(km|min|m)\b/;
    const inMono = (e: El | null): boolean => !!e && (mono.some((s) => matchesSelector(e, s)) || inMono(e.parent));
    let seen = 0;
    for (const [name, html] of screens) {
      for (const e of all(parseHtml(html), (x) => x.children.some((c) => typeof c === 'string' && NUMBER.test(c)))) {
        if (e.tag === 'option') continue;
        seen += 1;
        expect(inMono(e), `${name}: "${textOf(e)}" in <${e.tag} class="${e.attrs.class ?? ''}">`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(40); // the check saw the commute, the rows, the earnings and the job views
  });

  it('no label is set in capitals: the line above the job title is a sentence', () => {
    for (const r of ALL_RULES) {
      for (const d of r.decls) expect(`${r.selector} { ${d.prop}: ${d.value} }`).not.toMatch(/text-transform:\s*uppercase/);
    }
    expect(base(cssOf('JobDetailV2.css'), '.job-v2__kind', 'letter-spacing')).toBeUndefined();
    expect(jobHtml(relayLeg1())).toContain('<p class="job-v2__kind">Relay leg 1 of 2: drop at the relay point</p>');
  });
});

// ---------- 3. The checklist ----------

describe('#882 the job route is a checklist', () => {
  const job = (over: Partial<JobResponse>) => ({ ...relayLeg1('in_progress'), ...over });
  const rows = (html: string) => all(parseHtml(html), (e) => e.attrs.class === 'job-v2__stop');
  const child = (row: El, cls: string) => all(row, (e) => e.attrs.class === cls)[0];

  it('reads top to bottom: leave work, collect, drop, arrive home, each with its time first', () => {
    const list = rows(jobHtml(job({ departed: true, stopsDone: 1, arrived: false })));
    expect(list.map((r) => r.attrs['data-kind'])).toEqual(['start', 'pickup', 'hub_drop', 'end']);
    expect(list.map((r) => textOf(child(r, 'job-v2__action')))).toEqual([
      'Leave work (done)', 'Collect the package (done)', 'Leave it at the relay point for the morning carrier', 'Arrive home',
    ]);
    for (const r of list) {
      // box, time, then what to do and where: the order a 390 px screen stacks them in
      expect(r.children.map((c) => (typeof c === 'string' ? c : c.attrs.class))).toEqual(['job-v2__check', 'job-v2__time', 'job-v2__stop-body']);
      expect(r.parent?.tag).toBe('ol');
    }
  });

  it('the tick box is a picture only; the state is said in words on every row', () => {
    const list = rows(jobHtml(job({ departed: true, stopsDone: 1, arrived: false })));
    for (const r of list) {
      const done = r.attrs['data-done'] === 'true';
      const box = child(r, 'job-v2__check');
      expect(box.attrs['aria-hidden']).toBe('true');
      expect(all(box, (e) => e.tag === 'svg').length).toBe(done ? 1 : 0); // the tick is drawn only when done
      // What a screen reader gets from the row, with the box left out.
      const said = textOf(r);
      expect(/\(done\)/.test(said)).toBe(done);
      expect(said.includes(ROW_NOT_DONE_TEXT)).toBe(!done);
      const sr = all(r, (e) => e.attrs.class === 'job-v2__sr');
      expect(sr.map(textOf)).toEqual(done ? [] : [ROW_NOT_DONE_TEXT]);
    }
    expect(ROW_NOT_DONE_TEXT).toBe('Not done yet');
  });

  it('the ticks are the server\'s fields and nothing else', () => {
    const marks = (j: JobResponse) => rows(jobHtml(j)).map((r) => r.attrs['data-done'] === 'true');
    // Status "completed" alone ticks nothing the server has not counted.
    expect(marks(job({ status: 'completed', departed: false, stopsDone: 0, arrived: false }))).toEqual([false, false, false, false]);
    expect(marks(job({ status: 'assigned', departed: true, stopsDone: 2, arrived: true }))).toEqual([true, true, true, true]);
    expect(marks(job({ departed: true, stopsDone: 1, arrived: false }))).toEqual([true, true, false, false]);
  });

  it('the "Not done yet" text is on the page for screen readers and takes no room', () => {
    const css = cssOf('JobDetailV2.css');
    expect(base(css, '.job-v2__sr', 'position')).toBe('absolute');
    expect(base(css, '.job-v2__sr', 'clip')).toBe('rect(0 0 0 0)');
    expect(base(css, '.job-v2__sr', 'width')).toBe('1px');
    expect(base(css, '.job-v2__sr', 'display')).toBeUndefined(); // display: none would hide it from them too
    expect(base(css, '.job-v2__stop', 'position')).toBe('relative'); // the hidden text stays inside its row
  });

  it('a row is at least 44 px tall and one column of text at 390 px; done is never the colour alone', () => {
    const css = cssOf('JobDetailV2.css');
    expect(base(css, '.job-v2__stop', 'min-height')).toBe('44px');
    expect(base(css, '.job-v2__stop', 'grid-template-columns')).toBe('18px 136px minmax(0, 1fr)');
    expect(at390(css, '.job-v2__stop', 'grid-template-columns')).toBe('18px minmax(0, 1fr)');
    expect(at390(css, '.job-v2__stop-body', 'grid-column')).toBe('2');
    expect(base(css, '.job-v2__check', 'width')).toBe('18px');
    expect(base(css, ".job-v2__stop[data-done='true'] .job-v2__check", 'background')).toBe('var(--ok, #2F6B4F)');
    // The old timeline rule down the left side went with the boxes.
    expect(base(css, '.job-v2__route', 'border-left')).toBeUndefined();
  });
});

// ---------- 4. Touch targets ----------

describe('#882 44 px touch targets on a phone', () => {
  const TARGETS: [string, string[]][] = [
    ['EmployeeWorkspace.css', ['.ew-btn', '.ew-row-links a']],
    ['page/employeePage.css', ['.ep-btn', '.ep-links a', '.ep-btn-link']],
    ['CommuteForm.css', ['.cf select', ".cf input[type='time']", ".cf input[type='number']", ".cf-detour input[type='range']", '.cf-check', '.cf-btn']],
    ['AddressSearch.css', ['.addr-search__option', '.addr-search__btn', '.addr-search__input']],
    ['JobDetailV2.css', ['.job-v2__link', '.job-v2__button', '.job-v2__stop']],
  ];

  it('every button, link, field and checklist row is at least 44 px tall at 390 px', () => {
    for (const [file, list] of TARGETS) {
      const css = cssOf(file);
      for (const selector of list) {
        const value = at390(css, selector, 'min-height');
        expect(value, `${file} ${selector}`).toMatch(/^\d+px$/);
        expect(parseInt(value!, 10), `${file} ${selector}`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('a text link gets its height from a flex box, so the words stay centred', () => {
    expect(at390(cssOf('EmployeeWorkspace.css'), '.ew-row-links a', 'display')).toBe('inline-flex');
    expect(at390(cssOf('page/employeePage.css'), '.ep-links a', 'display')).toBe('inline-flex');
    expect(at390(cssOf('page/employeePage.css'), '.ep-btn-link', 'display')).toBe('inline-flex');
  });

  it('the phone rules of every file start at 480 px, so a 412 or 430 px phone gets them too', () => {
    for (const file of ['EmployeeWorkspace.css', 'page/employeePage.css', 'CommuteForm.css', 'AddressSearch.css', 'JobDetailV2.css']) {
      const widths = cssOf(file).filter((r) => r.decls.some((d) => d.prop === 'min-height' && d.value === '44px')).map(reach);
      expect(widths.length, file).toBeGreaterThan(0);
      for (const w of widths) expect(w, file).toBeGreaterThanOrEqual(480);
    }
    // The form is one column from the same width down.
    expect(at390(cssOf('CommuteForm.css'), '.cf-row', 'grid-template-columns')).toBe('1fr');
    const cf = cssOf('CommuteForm.css').find((r) => selectors(r).includes('.cf-row') && r.media.length > 0)!;
    expect(reach(cf)).toBe(480);
  });
});

// ---------- 5. Keyboard and screen reader ----------

describe('#882 keyboard and screen reader', () => {
  it('a row\'s two links are named after its package and still start with the words on screen', () => {
    const root = parseHtml(page(ready()));
    const rows = all(root, (e) => e.attrs.class === 'ew-row');
    expect(rows.length).toBe(dashboard.assigned.length + dashboard.completed.length);
    const names: string[] = [];
    for (const row of rows) {
      const label = textOf(all(row, (e) => e.attrs.class === 'ew-strong')[0]);
      const links = tabOrder(row);
      expect(links.map(textOf)).toEqual(['View job', 'Watch in simulator']);
      expect(links.map((l) => accessibleName(root, l))).toEqual([`View job: ${label}`, `Watch in simulator: ${label}`]);
      for (const l of links) expect(accessibleName(root, l).startsWith(textOf(l))).toBe(true);
      names.push(...links.map((l) => accessibleName(root, l)));
    }
    expect(new Set(names).size).toBe(names.length); // no two links of the page read the same
  });

  it('every control of the commute form and the address search has a name and a focus style', () => {
    const root = parseHtml(page(ready(), { initialEditing: true }));
    const editor = all(root, (e) => e.attrs.class === 'ep-editor')[0];
    const focus = ALL_RULES
      .filter((r) => r.decls.some((d) => (d.prop.startsWith('outline') && d.value !== 'none') || d.prop === 'box-shadow'))
      .flatMap(selectors).filter((s) => s.includes(':focus-visible')).map((s) => s.replace(/:focus-visible/g, ''));
    const stops = tabOrder(editor);
    expect(stops.map((e) => accessibleName(root, e))).toEqual([
      'Close', 'Workplace', 'Change', 'Evening departure (Day 1, work to home)', 'Morning departure (Day 2, home to work)',
      'Available on the evening commute', 'Available on the morning commute', 'Maximum detour (minutes)', 'Maximum detour slider (minutes)',
    ]);
    for (const e of stops) {
      expect(focus.some((s) => matchesSelector(e, s)), `<${e.tag} class="${e.attrs.class ?? ''}"> has no focus style`).toBe(true);
    }
  });

  it('Close and Retry look like Edit commute: one secondary button, the same height', () => {
    const pageCss = cssOf('page/employeePage.css');
    const work = cssOf('EmployeeWorkspace.css');
    for (const prop of ['min-height', 'border', 'color', 'font-weight', 'background']) {
      expect(base(pageCss, '.ep-btn', prop), prop).toBe(base(work, '.ew-btn', prop));
    }
    expect(base(pageCss, '.ep-btn', 'color')).toBe('var(--accent, #1D5075)');
    expect(base(pageCss, '.ep-btn', 'min-height')).toBe('36px');
    // The link-style button inside a note stays a text link.
    expect(base(pageCss, '.ep-btn-link', 'font-weight')).toBe('400');
    expect(base(pageCss, '.ep-btn-link', 'border')).toBe('0');
  });

  it('in the editor the form and the address search are as wide as the card, under Close', () => {
    const rule = cssOf('page/employeePage.css').find((r) => selectors(r).includes('.ep-form .cf'))!;
    expect(selectors(rule)).toEqual(['.ep-form .cf', '.ep-form .addr-search']);
    expect(rule.decls).toEqual([{ prop: 'max-width', value: 'none' }]);
    expect(rule.media).toEqual([]);
    // On their own the two keep their widths.
    expect(base(cssOf('CommuteForm.css'), '.cf', 'max-width')).toBe('640px');
    expect(base(cssOf('AddressSearch.css'), '.addr-search', 'max-width')).toBe('560px');
  });

  it('the job title\'s focus ring is around the title, and the numbers box has one bottom line', () => {
    const css = cssOf('JobDetailV2.css');
    expect(base(css, '.job-v2__title', 'align-self')).toBe('flex-start');
    expect(base(css, '.job-v2__title', 'max-width')).toBe('100%');
    expect(base(css, '.job-v2__number', 'margin-bottom')).toBe('-1px');
    expect(base(css, '.job-v2__numbers', 'overflow')).toBe('hidden');
  });
});
