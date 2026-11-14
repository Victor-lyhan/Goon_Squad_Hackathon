// @vitest-environment jsdom
// #584: the links of the Employee page are in-app navigation. The real shell and the real Employee page
// in the app's BrowserRouter on jsdom's own history, against a fake /api/v2. A click changes the URL
// through the router (pushState), the app cancels the browser's own navigation, and the page stays
// mounted; a click with a modifier key is left to the browser, so the links stay real links.
//
// jsdom's `location.assign` and `location.reload` cannot be replaced by a spy (unforgeable), and an
// anchor never calls them anyway: the browser loads the `href` itself unless the click is cancelled. So
// "no reload" is checked two ways: the click reaches `window` already cancelled, and the source of the
// Employee page never touches `window.location`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../client/src/App';
import { JOB_OTHER_TITLE, jobDetail } from '../../client/src/components/employee/v2/jobDetailV2Model';
import { JOB_LOADING_TEXT, LOADING_TEXT, NOT_FOUND_TITLE } from '../../client/src/components/employee/v2/page/employeePageModel';
import { isRouterClick, pathOf } from '../../client/src/components/employee/v2/page/PageLink';
import type { EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import { T, jobResponseFor } from './employee-v2-dom-helpers';
import { businesses, dashboard, directView, relayView } from './employee-v2-workspace-sample';
import { button, deferred, flush, link, mount, textOf } from './kitDom';

// The simulator is another module; a one-line page is enough to see that the route was opened.
vi.mock('../../client/src/pages/v2/SimulatorV2', () => ({
  default: () => <p data-page="simulator">Simulator page</p>,
}));

const ME = dashboard.employee.id; // emp-001
const OTHER = 'emp-002';
const EMPLOYEES = [{ id: ME, name: 'Maya Chen' }, { id: OTHER, name: 'Luis Ortega' }];
const otherDashboard: EmployeeDashboard = {
  ...dashboard, employee: { ...dashboard.employee, id: OTHER, name: 'Luis Ortega' }, assigned: [], completed: [],
};
/** A job of the other employee, as `GET /api/v2/jobs/:id` answers it. */
const otherJob: JobResponse = {
  ...jobResponseFor(directView),
  job: { ...directView.job, id: 'job-other', employeeId: OTHER },
};
const JOBS: Record<string, JobResponse> = {
  [directView.job.id]: jobResponseFor(directView),
  [relayView.job.id]: jobResponseFor(relayView),
  [otherJob.job.id]: otherJob,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake fetch for the Employee page. `holdJobs()` keeps job answers pending until `release()`. */
function fakeApi() {
  const calls: string[] = [];
  let gate: Promise<void> | null = null;
  let open = () => {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    calls.push(url);
    if (url === '/api/health') return new Response(null, { status: 200 });
    if (url === '/api/v2/employees') return json(200, { employees: EMPLOYEES });
    if (url === '/api/v2/businesses') return json(200, { businesses });
    if (url === `/api/v2/employees/${ME}/dashboard`) return json(200, dashboard);
    if (url === `/api/v2/employees/${OTHER}/dashboard`) return json(200, otherDashboard);
    const job = /^\/api\/v2\/jobs\/(.+)$/.exec(url);
    if (job && JOBS[decodeURIComponent(job[1])]) {
      if (gate) await gate;
      return json(200, JOBS[decodeURIComponent(job[1])]);
    }
    return json(404, { error: 'Not found' }); // also /api/v2/map: the route preview is not part of this test
  }));
  return {
    calls,
    holdJobs: () => { const d = deferred<void>(); gate = d.promise; open = () => d.resolve(); },
    release: () => { gate = null; open(); },
  };
}

const where = () => window.location.pathname + window.location.search;

/**
 * A click as the browser delivers it. Returns whether the app had cancelled it by the time it reached
 * `window` (true = the router took it, false = the browser would open the `href`). The listener then
 * cancels it itself, so jsdom does not try to load a document.
 */
function clickLink(a: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  let cancelled: boolean | null = null;
  const seen = (e: Event) => { cancelled = e.defaultPrevented; e.preventDefault(); };
  window.addEventListener('click', seen, { once: true });
  act(() => {
    a.focus();
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  });
  window.removeEventListener('click', seen);
  if (cancelled === null) throw new Error('the click never reached window');
  return cancelled;
}

async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 200 && !ok(); i++) await flush();
  if (!ok()) throw new Error(`timed out waiting for ${what}; page: ${textOf(document.body).slice(0, 300)}`);
}

/** The real shell in the app's BrowserRouter at `path`, with the header's lists passed in. */
async function open(path: string) {
  window.history.pushState(null, '', path);
  const m = mount(
    <BrowserRouter>
      <AppShell
        initialV2={{ status: 'ready', employees: EMPLOYEES as never }}
        initialV2Businesses={{ status: 'ready', businesses: businesses as never }}
      />
    </BrowserRouter>,
  );
  const c = m.container;
  const page = () => c.querySelector<HTMLElement>('.ep');
  const row = (jobId: string) => c.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`);
  const heading = () => c.querySelector<HTMLElement>('#job-v2-title');
  const back = async () => { await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 0)); }); };
  return { ...m, c, page, row, heading, back, main: () => c.querySelector<HTMLElement>('main#main-content')! };
}

let api: ReturnType<typeof fakeApi>;
beforeEach(() => { localStorage.clear(); api = fakeApi(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Employee page links in the app router', () => {
  it('View job opens the job on the same page: the URL changes, nothing reloads, the list stays until the job is in', async () => {
    const p = await open(`/employee/${ME}`);
    await until(() => !!p.row(relayView.job.id), 'the delivery list');
    const pageNode = p.page();
    const mainNode = p.main();
    const entries = window.history.length;
    const dashboardLoads = () => api.calls.filter((u) => u.endsWith('/dashboard')).length;
    const loadsBefore = dashboardLoads();

    const viewJob = link(p.row(relayView.job.id)!, 'View job');
    expect(viewJob.getAttribute('href')).toBe(`/employee/${ME}?job=${relayView.job.id}`);

    api.holdJobs();
    expect(clickLink(viewJob)).toBe(true); // the app cancelled the browser's navigation
    expect(where()).toBe(`/employee/${ME}?job=${relayView.job.id}`);
    expect(window.history.length).toBe(entries + 1); // one new entry, so Back returns to the list

    // The job's detail is still on its way: the polled list stays, with no loading text and the link focused.
    await flush();
    expect(p.row(relayView.job.id)).not.toBeNull();
    expect(p.row(directView.job.id)).not.toBeNull();
    expect(textOf(p.c)).not.toContain(LOADING_TEXT);
    expect(textOf(p.c)).not.toContain(JOB_LOADING_TEXT);
    expect(document.activeElement).toBe(viewJob);

    api.release();
    await until(() => !!p.heading(), 'the job view');
    // The same job, on the same mounted page: no second first load.
    const model = jobDetail(jobResponseFor(relayView), businesses, dashboard.home.neighborhood);
    expect(textOf(p.heading()!)).toBe(model.title);
    expect(link(p.c, 'Watch this package').getAttribute('href')).toBe(`/simulator?package=${relayView.shipment.id}`);
    expect(document.activeElement).toBe(p.heading());
    expect(p.row(relayView.job.id)).toBeNull();
    expect(p.page()).toBe(pageNode);
    expect(p.main()).toBe(mainNode);
    expect(dashboardLoads() - loadsBefore).toBeLessThanOrEqual(3); // polls, not a restart per render

    // Back to deliveries drops ?job= and focus returns to the row's link (PR #557).
    act(() => { button(p.c, 'Back to deliveries').click(); });
    await until(() => !!p.row(relayView.job.id), 'the list after closing');
    expect(where()).toBe(`/employee/${ME}`);
    expect(document.activeElement).toBe(link(p.row(relayView.job.id)!, 'View job'));
  }, T);

  it('the browser Back button closes a job opened from the list and focus returns to its row', async () => {
    const p = await open(`/employee/${ME}`);
    await until(() => !!p.row(directView.job.id), 'the delivery list');
    expect(clickLink(link(p.row(directView.job.id)!, 'View job'))).toBe(true);
    await until(() => !!p.heading(), 'the job view');
    expect(where()).toBe(`/employee/${ME}?job=${directView.job.id}`);

    await p.back();
    await until(() => !!p.row(directView.job.id), 'the list after Back');
    expect(where()).toBe(`/employee/${ME}`);
    expect(p.heading()).toBeNull();
    expect(document.activeElement).toBe(link(p.row(directView.job.id)!, 'View job'));
  }, T);

  it('Watch in simulator opens the simulator route without a document load, with focus on the main content', async () => {
    const p = await open(`/employee/${ME}`);
    await until(() => !!p.row(directView.job.id), 'the delivery list');
    const mainNode = p.main();
    const watch = link(p.row(directView.job.id)!, 'Watch in simulator');
    expect(watch.getAttribute('href')).toBe(`/simulator?package=${directView.shipment.id}`);

    expect(clickLink(watch)).toBe(true);
    await until(() => !!p.c.querySelector('[data-page="simulator"]'), 'the simulator page');
    expect(where()).toBe(`/simulator?package=${directView.shipment.id}`);
    expect(p.main()).toBe(mainNode); // the shell was not rebuilt
    expect(p.page()).toBeNull();
    expect(document.activeElement).toBe(mainNode); // not left on <body> after the clicked link is gone

    await p.back();
    await until(() => !!p.row(directView.job.id), 'the Employee page after Back');
    expect(where()).toBe(`/employee/${ME}`);
  }, T);

  it('Watch this package opens the simulator route from the job view', async () => {
    const p = await open(`/employee/${ME}?job=${directView.job.id}`);
    await until(() => !!p.heading(), 'the job view');
    const watch = link(p.c, 'Watch this package');
    expect(watch.getAttribute('href')).toBe(`/simulator?package=${directView.shipment.id}`);
    expect(watch.className).toBe('job-v2__link');

    expect(clickLink(watch)).toBe(true);
    await until(() => !!p.c.querySelector('[data-page="simulator"]'), 'the simulator page');
    expect(where()).toBe(`/simulator?package=${directView.shipment.id}`);
    expect(document.activeElement).toBe(p.main());

    // Back shows the same job again.
    await p.back();
    await until(() => !!p.heading(), 'the job view after Back');
    expect(where()).toBe(`/employee/${ME}?job=${directView.job.id}`);
  }, T);

  it('Open it on the right employee page moves to the owner\'s page with the same job', async () => {
    const p = await open(`/employee/${ME}?job=${otherJob.job.id}`);
    await until(() => textOf(p.c).includes(JOB_OTHER_TITLE), 'the other-employee note');
    const to = link(p.c, 'Open it on the right employee page');
    expect(to.getAttribute('href')).toBe(`/employee/${OTHER}?job=${otherJob.job.id}`);

    expect(clickLink(to)).toBe(true);
    expect(where()).toBe(`/employee/${OTHER}?job=${otherJob.job.id}`);
    await until(() => !!p.heading(), 'the job on its owner\'s page');
    expect(textOf(p.heading()!)).toBe(otherJob.shipment.label);
    expect(textOf(p.c)).not.toContain(JOB_OTHER_TITLE);
    expect(document.activeElement).toBe(p.heading());
  }, T);

  it('the links of the not-found state use the router too', async () => {
    const p = await open('/employee/emp-999');
    await until(() => textOf(p.c).includes(NOT_FOUND_TITLE), 'the not-found state');
    const to = link(p.c, 'Open an employee in the current city');
    expect(to.getAttribute('href')).toBe(`/employee/${ME}`);
    expect(link(p.c, 'Back to the start page').getAttribute('href')).toBe('/');

    expect(clickLink(to)).toBe(true);
    await until(() => !!p.row(directView.job.id), 'the first employee\'s list');
    expect(where()).toBe(`/employee/${ME}`);
  }, T);

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['middle button', { button: 1 }],
  ] as [string, MouseEventInit][])('a %s click is left to the browser (new tab): not cancelled, no in-app navigation', async (_name, init) => {
    const p = await open(`/employee/${ME}`);
    await until(() => !!p.row(directView.job.id), 'the delivery list');
    const mainNode = p.main();
    for (const name of ['View job', 'Watch in simulator']) {
      expect(clickLink(link(p.row(directView.job.id)!, name), init), name).toBe(false);
      await flush();
      expect(where(), name).toBe(`/employee/${ME}`);
      expect(p.row(directView.job.id), name).not.toBeNull();
      expect(document.activeElement, name).not.toBe(mainNode); // focus is not moved for a new-tab click
    }
  }, T);
});

describe('one main landmark', () => {
  it('the shell has the only <main> on every screen of the Employee page', async () => {
    const mains = () => [...document.querySelectorAll('main')];
    const p = await open(`/employee/${ME}`);
    expect(mains()).toHaveLength(1); // loading
    await until(() => !!p.row(directView.job.id), 'the delivery list');
    expect(mains()).toEqual([p.main()]);
    expect(p.page()!.tagName).toBe('DIV');
    expect(p.main().contains(p.page())).toBe(true);

    clickLink(link(p.row(directView.job.id)!, 'View job'));
    await until(() => !!p.heading(), 'the job view');
    expect(mains()).toEqual([p.main()]);
    p.unmount();

    const q = await open('/employee/emp-999');
    await until(() => textOf(q.c).includes(NOT_FOUND_TITLE), 'the not-found state');
    expect(mains()).toEqual([q.main()]);
    expect(q.page()!.tagName).toBe('DIV');
  }, T);
});

describe('PageLink rules', () => {
  it('pathOf drops the query, the hash and a trailing slash', () => {
    expect(pathOf('/employee/emp-1?job=j-1')).toBe('/employee/emp-1');
    expect(pathOf('/employee/emp-1/')).toBe('/employee/emp-1');
    expect(pathOf('/simulator?package=shp-1#x')).toBe('/simulator');
    expect(pathOf('/')).toBe('/');
  });

  it('only a plain left click in the same tab belongs to the router', () => {
    const plain = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false };
    expect(isRouterClick(plain)).toBe(true);
    expect(isRouterClick(plain, '_self')).toBe(true);
    expect(isRouterClick(plain, '_blank')).toBe(false);
    expect(isRouterClick({ ...plain, button: 1 })).toBe(false);
    expect(isRouterClick({ ...plain, defaultPrevented: true })).toBe(false);
    for (const key of ['metaKey', 'altKey', 'ctrlKey', 'shiftKey'] as const) {
      expect(isRouterClick({ ...plain, [key]: true }), key).toBe(false);
    }
  });
});

describe('the Employee page source', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(f) ? [path] : [];
  });
  const sources = [...files('client/src/components/employee/v2'), 'client/src/pages/v2/EmployeeV2.tsx'];

  it('never navigates through window.location (no assign, reload or href write)', () => {
    expect(sources.length).toBeGreaterThan(10);
    for (const path of sources) {
      const code = readFileSync(path, 'utf8');
      expect(code, path).not.toMatch(/location\s*\.\s*(assign|reload|replace)\s*\(/);
      expect(code, path).not.toMatch(/location(\.href)?\s*=[^=]/);
    }
  });

  it('renders no plain <a href> and no <main>: links go through PageLink', () => {
    for (const path of sources.filter((f) => f.endsWith('.tsx') && !f.endsWith('PageLink.tsx'))) {
      const code = readFileSync(path, 'utf8');
      expect(code, path).not.toMatch(/<a\s[^>]*href=/);
      expect(code, path).not.toMatch(/<main[\s>]/);
    }
  });
});
