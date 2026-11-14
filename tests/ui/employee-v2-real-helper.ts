// Helper for the Employee workspace tests on the real NYC run (tests/ui/employee-v2-real-*, issue #513).
// Builds the default NYC run the way the server does at boot, from the committed files and with no key and no
// network: `readNycFixtures` + `buildDefaultRun` (server/api/v2/bootRun.ts), travel from `createCachedProvider`
// over the committed cache, the real `snapshotAt`, then the read views of server/api/v2/views.ts. Nothing is
// written anywhere. The page is assembled the way client/src/pages/v2/EmployeeV2.tsx assembles it.
// Like every test on the real fixtures these assert rules only: no story ID, name or count (DECISIONS pass 54, 56).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect } from 'vitest';
import type { EmployeeDashboard, JobResponse, MapResponse } from '../../shared/v2/api';
import type { Home, JobStatus, NetworkBusiness, Run, Snapshot, Trip } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR, buildDefaultRun, readNycFixtures } from '../../server/api/v2/bootRun';
import { employeeDashboard, jobResponse, mapResponse } from '../../server/api/v2/views';
import { readTravelFiles } from '../../server/geo/cache';
import { createCachedProvider, type CachedProvider } from '../../server/geo/providers';
import { snapshotAt } from '../../server/domain/v2/simulation';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { pageScreen } from '../../client/src/components/employee/v2/page/employeePageModel';
import { RouteSlot } from '../../client/src/components/employee/v2/page/RouteSlot';

/**
 * Timeout of every test and hook (DECISIONS pass 19). Building the run takes well under 1 s and a whole file
 * under 3 s locally, so this is far more than 3x.
 */
export const T = 60_000;

// ---------- the run ----------

export type RealRun = {
  run: Run;
  travel: CachedProvider;
  /** The directory as GET /api/v2/businesses answers it. */
  businesses: NetworkBusiness[];
  /** GET /api/v2/map: fetched once per run by the page. */
  map: MapResponse;
};

/** The default NYC run from the committed `fixtures/nyc`. Call once per test file. */
export function buildRealRun(): RealRun {
  const files = readTravelFiles(NYC_FIXTURES_DIR);
  if (!files) throw new Error('fixtures/nyc has no travel cache (matrix.json / polylines.json)');
  const travel = createCachedProvider(files);
  const run = buildDefaultRun({ travel, places: files.matrix.places, fixtures: readNycFixtures(NYC_FIXTURES_DIR) });
  return { run, travel, businesses: run.scenario.businesses, map: mapResponse(run, travel) };
}

// ---------- the five moments of the day (DECISIONS pass 56) ----------

export type Moment = { label: string; timeMin: number };

const directionOf = (run: Run, tripId: string): Trip['direction'] | undefined =>
  run.trips.find((t) => t.id === tripId)?.direction;

/**
 * The first minute at which some job of `direction` is in progress per the real snapshot: a minute inside that
 * leg, read from the run, so a story retune moves it with the data.
 */
export function minuteInsideLeg(real: RealRun, direction: Trip['direction']): number {
  const { run, travel } = real;
  const jobs = run.jobs
    .filter((j) => directionOf(run, j.tripId) === direction)
    .sort((a, b) => a.pickup.serviceStartMin - b.pickup.serviceStartMin || (a.id < b.id ? -1 : 1));
  for (const job of jobs) {
    for (let t = job.pickup.arrivalMin; t <= job.dropoff.serviceEndMin; t++) {
      if (snapshotAt(run, t, travel).jobStatus[job.id] === 'in_progress') return t;
    }
  }
  throw new Error(`No ${direction} job of the default NYC run is ever in progress`);
}

export function momentsOf(real: RealRun): Moment[] {
  return [
    { label: 'minute 930 (start of the run)', timeMin: 930 },
    { label: 'inside the evening leg', timeMin: minuteInsideLeg(real, 'evening') },
    { label: 'minute 1440 (midnight, overnight)', timeMin: 1440 },
    { label: 'inside the morning leg', timeMin: minuteInsideLeg(real, 'morning') },
    { label: 'minute 2160 (end of the run)', timeMin: 2160 },
  ];
}

export type At = { run: Run; snapshot: Snapshot; timeMin: number };

/**
 * The run as the server holds it after a seek to `timeMin`: the clock moved, nothing else. After the start the
 * run is locked, as it is once the demo pressed Play (DECISIONS pass 2).
 */
export function at(real: RealRun, timeMin: number): At {
  const phase = timeMin === real.run.clock.timeMin ? real.run.clock.phase : 'locked';
  const run: Run = { ...real.run, clock: { ...real.run.clock, timeMin, playing: false, phase } };
  return { run, snapshot: snapshotAt(run, timeMin, real.travel), timeMin };
}

export function dashboardAt(a: At, employeeId: string): EmployeeDashboard {
  const d = employeeDashboard(a.run, a.snapshot, employeeId);
  if (!d) throw new Error(`GET /employees/${employeeId}/dashboard would be a 404 at minute ${a.timeMin}`);
  return d;
}

export function jobAt(a: At, jobId: string): JobResponse {
  const j = jobResponse(a.run, a.snapshot, jobId);
  if (!j) throw new Error(`GET /jobs/${jobId} would be a 404 at minute ${a.timeMin}`);
  return j;
}

// ---------- the page, assembled like client/src/pages/v2/EmployeeV2.tsx ----------

/** The data hook's state after the dashboard, the directory and (for `?job=`) the job arrived. */
export function readyState(dashboard: EmployeeDashboard, businesses: NetworkBusiness[], runId: string, job?: JobResponse): EmployeeWorkspaceState {
  let s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard, runId });
  s = employeeWorkspaceReducer(s, { type: 'businesses', businesses });
  if (job) s = employeeWorkspaceReducer(s, { type: 'job', job });
  return s;
}

const noop = () => {};

/** Static markup of the whole Employee page with the route preview slot filled from `map`. */
export function renderPage(state: EmployeeWorkspaceState, jobId: string | null, map: MapResponse | null): string {
  const job = state.dashboard && pageScreen(state, jobId).kind === 'job' ? state.job : null;
  const routePreview = state.dashboard
    ? createElement(RouteSlot, {
      slot: map ? { kind: 'map', map } : { kind: 'none' },
      dashboard: state.dashboard,
      businesses: state.businesses,
      job,
      onRetry: noop,
    })
    : null;
  return renderToStaticMarkup(createElement(EmployeePageView, {
    state,
    jobId,
    saveCommute: async () => { throw new Error('not saved in a static render'); },
    refetchNow: async () => {},
    markSeen: noop,
    onCloseJob: noop,
    search: async () => [],
    employeeHref: (id: string) => `/employee/${id}`,
    routePreview,
  }));
}

// ---------- reading the markup without a DOM ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (_m, e: string) => ENTITIES[e]);

/** Visible text of some markup, entities decoded, whitespace collapsed. */
export const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * The inner markup of the first element whose opening tag contains `marker` (an attribute or class), up to its
 * matching close tag. Enough for React's static markup, which has no unclosed tags except void ones.
 */
export function elementWith(html: string, marker: string): string | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const open = html.lastIndexOf('<', start);
  const tag = /^<([a-zA-Z0-9]+)/.exec(html.slice(open))?.[1];
  if (!tag) return null;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = open;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(html.indexOf('>', open) + 1, m.index);
  }
  return null;
}

/** Every `data-job-id` value in some markup, in order. */
export const jobIdsIn = (html: string) => [...html.matchAll(/data-job-id="([^"]+)"/g)].map((m) => decode(m[1]));

// ---------- what may never be on screen ----------

const STREET = /\b\d{1,5}(?:-\d{1,4})?\s+(?:[A-Z0-9][A-Za-z0-9.']*\s+){0,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Pl|Place|Broadway|Pkwy|Parkway|Dr|Drive|Ln|Lane|Ter|Terrace)\b/;

/**
 * The rendered page carries no `undefined`, `NaN`, `null` or `Invalid`, no "hub", no latitude or longitude, no
 * home ID, and no street address other than a network business's own address (homes are shown by neighborhood
 * only, SPEC MVP II rule 6). `where` names the employee and moment in the failure message.
 */
export function expectCleanPage(html: string, where: string, homes: Home[], businesses: NetworkBusiness[]): void {
  const text = textOf(html);
  for (const word of ['undefined', 'NaN', 'null', 'Invalid']) {
    if (text.includes(word)) throw new Error(`${where}: the page shows "${word}": ${text.slice(Math.max(0, text.indexOf(word) - 80), text.indexOf(word) + 40)}`);
  }
  expect(html, `${where}: undefined or NaN in the markup`).not.toMatch(/undefined|NaN/);
  // "hub" may stay in enum values (data-kind="hub_drop", DECISIONS pass 44); people never read it.
  const labels = [...html.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1]).join(' ');
  expect(`${text} ${labels}`, `${where}: "hub" on screen`).not.toMatch(/hub/i);
  expect(text, `${where}: a latitude or longitude on screen`).not.toMatch(/-?\b\d{2}\.\d{3,}/);
  expect(html, `${where}: a home ID in the markup`).not.toMatch(/\bhome-/);
  for (const h of homes) {
    for (const coord of [String(h.lat), String(h.lng), h.lat.toFixed(4), h.lng.toFixed(4)]) {
      if (text.includes(coord)) throw new Error(`${where}: the coordinate ${coord} of a home is on screen`);
    }
  }
  // Street addresses: business addresses and names are allowed; anything else that reads like one is not.
  let rest = text;
  for (const b of [...businesses].sort((x, y) => y.address.length - x.address.length)) rest = rest.split(b.address).join(' ');
  for (const b of [...businesses].sort((x, y) => y.name.length - x.name.length)) rest = rest.split(b.name).join(' ');
  const street = STREET.exec(rest);
  if (street) throw new Error(`${where}: something that reads like a street address is on screen: "${street[0]}"`);
}

// ---------- small readers of the API values ----------

export const STATUS_LABEL: Record<JobStatus, string> = { assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' };

export const businessName = (businesses: NetworkBusiness[], id: string): string => {
  const b = businesses.find((x) => x.id === id);
  if (!b) throw new Error(`${id} is not a network business of the directory`);
  return b.name;
};
