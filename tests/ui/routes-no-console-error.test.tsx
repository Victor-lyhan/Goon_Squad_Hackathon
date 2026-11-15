// @vitest-environment jsdom
// #768: every page route of the app is silent in the console. PR #753 (#746) fixed React's dev-only key-spread
// error on `/`; this guards the other routes the demo opens against the same kind of noise.
//
// Each route is opened the way the browser opens it: the URL is set, then the tree of client/src/main.tsx is
// mounted (`<StrictMode><App /></StrictMode>`, so the real BrowserRouter, header, route table and pages, with
// the dev-only double mount of every effect). The app talks through the real client/src/api to a REAL server:
// `startRehearsalApi()` of demo-rehearse-twice-helper.ts (`createV2Runtime` on a temp copy of fixtures/nyc, a
// temp state file, no key, no network). The poll timers are fake and the requests are real, as in
// tests/ui/demo-rehearse-twice.test.tsx.
//
// The Business, Employee and simulator pages are lazy routes (#885) and are NOT loaded ahead here: the first
// open of each goes through the shell's loading line, and that must be silent too.
//
// A route is checked after its first load, after every poll and retry timer of the app has fired at least
// once, and after the page is left (unmounted). Any `console.error` or `console.warn` call fails it, and the
// failure shows the message. So that a blank or broken page cannot pass as "silent", each route must also show
// its own landmark, never the error fallback or "Page not found", and no request may be refused.
//
// No story ID or name is written here (DECISIONS pass 54): the accounts are the ones the README's
// ```demo-request block names, and the journey is the package the homepage's "Watch a package" opens.
import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { Employee, NetworkBusiness } from '../../shared/v2/types';
import App from '../../client/src/App';
import { getBusinesses, getEmployees, getSimulator } from '../../client/src/api/v2';
import { RUN_CHECK_INTERVAL_MS as BUSINESS_RUN_CHECK_MS } from '../../client/src/components/business/v2/live/businessPoller';
import { RUN_CHECK_INTERVAL_MS as EMPLOYEE_RUN_CHECK_MS } from '../../client/src/components/employee/v2/live/employeePoller';
import { SIM_POLL_MS } from '../../client/src/components/sim/v2/live/simPoller';
import { WATCH_LABEL } from '../../client/src/pages/Landing';
import { NYC_RETRY_EVERY_MS, WATCH_PACKAGE_LABEL, watchPackageId } from '../../client/src/pages/landingModel';
import { HEALTH_POLL_MS } from '../../client/src/ui/connectionModel';
import { ERROR_FALLBACK_TITLE } from '../../client/src/ui/ErrorBoundary';
import { RUN_POLL_MS } from '../../client/src/ui/shellModel';
import { nycFilesState } from '../api/v2-e2e-nyc-helper';
import {
  T, advancePolls, byName, readmeDemo, settle, startRehearsalApi, useFakePollTimers,
  type Logged, type RehearsalApi,
} from './demo-rehearse-twice-helper';
import { buttons, link, mount, textOf } from './kitDom';
import { workspacePagesImported } from './lazy-pages-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

// The pages run with no browser key, so nothing may load from Google (the maps show their no-key state).
const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

/** Long enough for every poll, run check and retry timer of the shell and the pages to fire at least once. */
const ONE_OF_EVERY_TIMER_MS = Math.max(
  SIM_POLL_MS, RUN_POLL_MS, HEALTH_POLL_MS, NYC_RETRY_EVERY_MS, BUSINESS_RUN_CHECK_MS, EMPLOYEE_RUN_CHECK_MS,
);

const demo = readmeDemo();
const enc = encodeURIComponent;

let api: RehearsalApi;
let nycBefore: string[];
let sim: SimulatorResponse;
let businesses: NetworkBusiness[];
let employees: Employee[];
/** The sender and the employee the README's demo opens. */
let business: NetworkBusiness;
let employee: Employee;
/** The package the homepage's "Watch a package" opens: the Navy Yard one on the default run. */
let journeyId: string;

let error: MockInstance;
let warn: MockInstance;
/** Every console.error and console.warn call so far, as text (so a failure shows the message). */
const logged = () => [
  ...error.mock.calls.map((args) => `console.error: ${args.map(String).join(' ')}`),
  ...warn.mock.calls.map((args) => `console.warn: ${args.map(String).join(' ')}`),
];

beforeAll(async () => {
  nycBefore = nycFilesState();
  api = await startRehearsalApi();
  businesses = (await getBusinesses()).businesses;
  employees = (await getEmployees()).employees;
  sim = await getSimulator();
  business = byName(businesses, demo.sender, 'sender');
  employee = byName(employees, demo.employee, 'employee');
  const watched = watchPackageId(sim);
  if (!watched) throw new Error('the default run has no package for "Watch a package"');
  journeyId = watched;
});
afterAll(async () => {
  await api?.close();
  expect(nycFilesState()).toStrictEqual(nycBefore); // nothing was written to the committed fixtures/nyc
});
beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  window.localStorage.clear(); // no remembered demo account: a bare path opens the first one
  useFakePollTimers();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
  warn.mockRestore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
  expect(api.outgoing).toStrictEqual([]);
  expect(api.googleCalls).toStrictEqual([]);
});

// ---------- opening a route ----------

/** The path and query string in the address bar now. */
const address = () => window.location.pathname + window.location.search;

/**
 * Opens `url` as a page load does, lets every timer of the app fire once, checks the page with `shown`, then
 * leaves the page. Fails on any console.error or console.warn, on a refused request and on a broken page.
 */
async function openRoute(url: string, shown: (main: HTMLElement) => void, endsAt = url): Promise<void> {
  window.history.replaceState(null, '', url);
  const from = api.log.length;
  const page = mount(<StrictMode><App /></StrictMode>);
  // A workspace page is a lazy route (#885): the first open of each shows the shell's loading line until the
  // page's module arrives, as in the browser. The wait is one `act`, so React renders the page inside it.
  await act(async () => { await workspacePagesImported(); });
  await settle(api);
  expect(logged(), `${url}: the console after the first load`).toStrictEqual([]);

  await advancePolls(api, ONE_OF_EVERY_TIMER_MS);
  expect(logged(), `${url}: the console after the polls`).toStrictEqual([]);

  // The page is really there: this route's own content, in the app's <main>, under the header.
  expect(address(), `${url}: the address`).toBe(endsAt);
  const main = page.container.querySelector<HTMLElement>('main#main-content');
  if (!main) throw new Error(`${url}: the app shell has no <main>`);
  expect(page.container.querySelector('header.shell-header'), `${url}: the header`).not.toBeNull();
  expect(textOf(main), `${url}: not the error fallback`).not.toContain(ERROR_FALLBACK_TITLE);
  expect(textOf(main), `${url}: not the 404 page`).not.toContain('Page not found');
  shown(main);

  // It asked the server for something, and nothing was refused. A request with no answer is one the app
  // aborted itself (StrictMode's first mount, a poll replaced by a newer one): it must have been asked again
  // and answered, or the page would be showing less than it should.
  const requests = api.log.slice(from);
  expect(requests.length, `${url}: requests sent`).toBeGreaterThan(0);
  const line = (r: Logged) => `${r.method} ${r.path}`;
  expect(
    requests.filter((r) => r.status !== null && r.status >= 400).map((r) => `${line(r)} ${r.status}`),
    `${url}: refused requests`,
  ).toStrictEqual([]);
  const answered = new Set(requests.filter((r) => r.status !== null).map(line));
  expect(
    [...new Set(requests.filter((r) => r.status === null).map(line))].filter((l) => !answered.has(l)),
    `${url}: requests that never got an answer`,
  ).toStrictEqual([]);

  // Leaving the page (the header's links do this) is silent too.
  page.unmount();
  await settle(api);
  expect(logged(), `${url}: the console after leaving the page`).toStrictEqual([]);
}

// ---------- what each page shows once it has loaded ----------

function homepage(main: HTMLElement): void {
  // The button links to the journey only once the homepage has its three answers.
  expect(link(main, WATCH_LABEL).getAttribute('href')).toBe(`/simulator?package=${enc(journeyId)}&play=1`);
}

function businessPage(of: NetworkBusiness) {
  return (main: HTMLElement): void => {
    expect(textOf(main)).toContain(of.name);
    expect(buttons(main, 'New delivery').length).toBeGreaterThan(0);
    expect(main.querySelectorAll('tr.bw-row').length, 'rows of the deliveries table').toBeGreaterThan(0);
  };
}

function employeePage(of: Employee) {
  return (main: HTMLElement): void => {
    expect(textOf(main)).toContain(of.name);
    expect(buttons(main, 'Edit commute')).toHaveLength(1);
    expect(main.querySelector('section[aria-labelledby="ew-assigned-heading"]'), 'Assigned deliveries').not.toBeNull();
  };
}

const playPause = (main: HTMLElement) => buttons(main, /^(Play|Pause)$/);
const journey = (main: HTMLElement) => main.querySelector('section[aria-label="Package journey"]');

function simulatorNetwork(main: HTMLElement): void {
  expect(playPause(main)).toHaveLength(1);
  expect(journey(main), 'no journey without ?package=').toBeNull();
}

function simulatorJourney(main: HTMLElement): void {
  expect(playPause(main)).toHaveLength(1);
  expect(journey(main), 'the journey of ?package=').not.toBeNull();
  expect(textOf(main)).toContain(WATCH_PACKAGE_LABEL);
}

describe('every page route renders with no console.error and no console.warn (#768)', () => {
  it('the server has the README\'s accounts and the "Watch a package" journey', () => {
    expect(api.runtime.status).toBe('ready');
    expect(sim.shipments.find((s) => s.id === journeyId)?.label).toBe(WATCH_PACKAGE_LABEL);
    expect(sim.plans.filter((p) => p.shipmentId === journeyId)).toHaveLength(1);
  });

  it('/', async () => {
    await openRoute('/', homepage);
  });

  it('/business/:id', async () => {
    await openRoute(`/business/${enc(business.id)}`, businessPage(business));
  });

  it('/employee/:id', async () => {
    await openRoute(`/employee/${enc(employee.id)}`, employeePage(employee));
  });

  it('/simulator', async () => {
    await openRoute('/simulator', simulatorNetwork);
  });

  it('/simulator?package=<the Navy Yard package>', async () => {
    await openRoute(`/simulator?package=${enc(journeyId)}`, simulatorJourney);
  });

  it('/business with no ID, which redirects to the first business', async () => {
    await openRoute('/business', businessPage(businesses[0]), `/business/${enc(businesses[0].id)}`);
  });

  it('/employee with no ID, which redirects to the first employee', async () => {
    await openRoute('/employee', employeePage(employees[0]), `/employee/${enc(employees[0].id)}`);
  });
});
