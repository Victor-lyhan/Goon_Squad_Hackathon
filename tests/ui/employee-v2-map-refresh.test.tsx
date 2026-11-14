// @vitest-environment jsdom
// #596 (demo step 4): a new job's route shows on the Employee map without a reload. The real page
// (pages/v2/EmployeeV2.tsx) with its real poller and map loader, in a router, against a fake
// `client/src/api/v2`. The page asks for GET /api/v2/map again when the set of job IDs changes and,
// while the open job's leg has no route line, about every 5 s; an equal poll requests nothing.
//
// The poller reads the map's run ID with the same `getMap` when the dashboard version moves (#388).
// Those calls carry the poller's own abort signal (the one its dashboard requests carry), so the fake
// tells them apart: "the page's requests" below are the map loader's, the ones this issue is about.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import polyline from '@mapbox/polyline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../client/src/api/v2';
import { MAP_LOADING_TEXT } from '../../client/src/components/employee/v2/page/runMapModel';
import { MAP_LINE_RETRY_MS } from '../../client/src/components/employee/v2/route/mapRefreshModel';
import { ROUTE_NOT_LOADED } from '../../client/src/components/employee/v2/route/commuteRouteModel';
import EmployeeV2 from '../../client/src/pages/v2/EmployeeV2';
import type { EmployeeDashboard, EmployeeJobView, JobResponse, MapResponse } from '../../shared/v2/api';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, OTHER, PLAN, SENDER, TRIPS, WORK } from './employee-v2-route-sample';
import { button, click, deferred, link, mount, textOf } from './kitDom';

vi.mock('../../client/src/api/v2', async (original) => ({
  ...(await original<typeof import('../../client/src/api/v2')>()),
  getEmployeeDashboard: vi.fn(), getJob: vi.fn(), getBusinesses: vi.fn(), getEmployees: vi.fn(),
  getMap: vi.fn(), putCommute: vi.fn(), geocode: vi.fn(),
}));

const T = 10_000;
const ME = DASHBOARD.employee.id;

// A delivery sent after the page loaded: a direct job on the evening commute, work -> sender -> recipient -> home.
const newPickup = { placeId: SENDER.id, kind: 'pickup' as const, arrivalMin: 1062, serviceStartMin: 1062, serviceEndMin: 1064 };
const newDrop = { placeId: OTHER.id, kind: 'delivery' as const, arrivalMin: 1090, serviceStartMin: 1090, serviceEndMin: 1092 };
const NEW_JOB: EmployeeJobView = {
  status: 'assigned',
  shipment: { ...JOB.shipment, id: 'shp-2', clientRequestId: 'req-2', label: 'Gift box', createdSeq: 2 },
  plan: {
    ...PLAN, id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'direct', relayBusinessId: undefined, deliveryMin: 1092,
    legs: [{ ...PLAN.legs[0], placeIds: [WORK.id, SENDER.id, OTHER.id, HOME.id], stops: [newPickup, newDrop] }],
  },
  job: { ...JOB.job, id: 'job-plan-shp-2-0', planId: 'plan-shp-2', shipmentId: 'shp-2', pickup: newPickup, dropoff: newDrop },
};
const WITH_NEW_JOB: EmployeeDashboard = { ...DASHBOARD, version: DASHBOARD.version + 1, assigned: [JOB, NEW_JOB] };

/** MAP has the old job's lines only; this one also has the two pairs the new job adds. */
const MAP_WITH_LINES: MapResponse = {
  ...MAP,
  polylines: [
    ...MAP.polylines,
    { from: SENDER.id, to: OTHER.id, encoded: polyline.encode([[40.742, -74.001], [40.703, -73.989]]) },
    { from: OTHER.id, to: HOME.id, encoded: polyline.encode([[40.703, -73.989], [40.7644, -73.9235]]) },
  ],
};

/** What the fake server answers right now; a test changes it between polls. */
const server = {
  dashboard: DASHBOARD,
  map: MAP,
  /** When set, the page's next map request stays open until the test settles it. */
  hold: null as ReturnType<typeof deferred<MapResponse>> | null,
};
let pollerSignals: Set<AbortSignal | undefined>;
let dashboardCalls: number;
/** Map requests of the page's loader, in order. */
let pageMapCalls: { signal?: AbortSignal }[];

function fakeApi() {
  pollerSignals = new Set();
  dashboardCalls = 0;
  pageMapCalls = [];
  vi.mocked(api.getEmployeeDashboard).mockImplementation(async (_id, opts) => {
    pollerSignals.add(opts?.signal);
    dashboardCalls += 1;
    return server.dashboard;
  });
  vi.mocked(api.getBusinesses).mockImplementation(async () => ({ businesses: BUSINESSES }));
  vi.mocked(api.getEmployees).mockImplementation(async () => ({ employees: [DASHBOARD.employee] }) as never);
  vi.mocked(api.getJob).mockImplementation(async (id) => {
    const view = [...server.dashboard.assigned, ...server.dashboard.completed].find((v) => v.job.id === id);
    if (!view) throw new api.ApiRequestError(404, 'Not found');
    return { ...view, trip: TRIPS[0] } satisfies JobResponse;
  });
  vi.mocked(api.getMap).mockImplementation((opts) => {
    if (pollerSignals.has(opts?.signal)) return Promise.resolve(server.map); // the poller's run check
    pageMapCalls.push({ signal: opts?.signal });
    if (server.hold) { const h = server.hold; server.hold = null; return h.promise; }
    return Promise.resolve(server.map);
  });
}

/** Moves fake time (timers and Date) by `ms`, runs what settles, then flushes React. */
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function open(path: string) {
  const m = mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/employee/:id" element={<EmployeeV2 />} /></Routes>
    </MemoryRouter>,
  );
  await advance(0);
  await advance(0);
  const c = m.container;
  return {
    ...m, c,
    preview: () => c.querySelector<HTMLElement>('section.ecr'),
    /** The slot's "Couldn't load the map. Retry" note. */
    problem: () => c.querySelector<HTMLElement>('.ep-route-note.ep-problem'),
    row: (jobId: string) => c.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`),
    jobTitle: () => c.querySelector<HTMLElement>('#job-v2-title'),
    text: () => textOf(c),
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  server.dashboard = DASHBOARD;
  server.map = MAP;
  server.hold = null;
  fakeApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Employee page: the map follows the jobs within one run', () => {
  it('a poll with one more job and the same run asks for the map again; the new job then has its line', async () => {
    const p = await open(`/employee/${ME}`);
    expect(p.row(JOB.job.id)).not.toBeNull();
    expect(p.preview()).not.toBeNull();
    expect(pageMapCalls).toHaveLength(1);
    const previewNode = p.preview();

    // The business sends a delivery: the next poll has one more job, the run is the same.
    server.dashboard = WITH_NEW_JOB;
    server.hold = deferred<MapResponse>();
    const pending = server.hold;
    await advance(1000);
    expect(p.row(NEW_JOB.job.id)).not.toBeNull(); // no reload: the job is in the list
    expect(pageMapCalls).toHaveLength(2);

    // The request is still open: the old map stays, the preview is the same element, no loading text.
    expect(p.preview()).toBe(previewNode);
    expect(p.text()).not.toContain(MAP_LOADING_TEXT);
    expect(p.text()).not.toContain('Loading map');
    expect(p.problem()).toBeNull();

    // Opening the new job against the old map: numbered stops, no line yet.
    click(link(p.row(NEW_JOB.job.id)!, 'View job'));
    await advance(0);
    await advance(0);
    expect(p.jobTitle()).not.toBeNull();
    expect(p.text()).toContain('1 Pickup · Bakery Row');
    expect(p.text()).toContain(ROUTE_NOT_LOADED);
    // One request at a time: the slow timer does not add a request to the open one.
    await advance(MAP_LINE_RETRY_MS * 2);
    expect(pageMapCalls).toHaveLength(2);

    // The map with the new plan's lines arrives.
    await act(async () => { pending.resolve(MAP_WITH_LINES); });
    await advance(0);
    expect(p.jobTitle()).not.toBeNull();
    expect(p.text()).toContain('1 Pickup · Bakery Row');
    expect(p.text()).not.toContain(ROUTE_NOT_LOADED);

    // The line is there: no timer keeps asking.
    await advance(MAP_LINE_RETRY_MS * 4);
    expect(pageMapCalls).toHaveLength(2);
  }, T);

  it('ten equal polls call getMap once', async () => {
    const p = await open(`/employee/${ME}`);
    expect(p.preview()).not.toBeNull();
    const polls = dashboardCalls;
    const all = vi.mocked(api.getMap).mock.calls.length; // the page's one request and the poller's one run check
    expect(pageMapCalls).toHaveLength(1);

    await advance(10_000);
    expect(dashboardCalls - polls).toBeGreaterThanOrEqual(10);
    expect(pageMapCalls).toHaveLength(1);
    expect(vi.mocked(api.getMap).mock.calls.length).toBe(all);
  }, T);

  it('a new version with the same jobs requests nothing: a status, the earnings or the phase changed', async () => {
    const p = await open(`/employee/${ME}`);
    for (let v = 1; v <= 5; v += 1) {
      server.dashboard = {
        ...DASHBOARD, version: DASHBOARD.version + v, earnedCents: v * 100,
        assigned: v < 3 ? [{ ...JOB, status: 'in_progress' }] : [], completed: v < 3 ? [] : [{ ...JOB, status: 'completed' }],
      };
      await advance(1000);
    }
    expect(p.preview()).not.toBeNull();
    expect(pageMapCalls).toHaveLength(1);
  }, T);

  it('a job that leaves the list (a re-match) asks once more', async () => {
    server.dashboard = WITH_NEW_JOB;
    const p = await open(`/employee/${ME}`);
    expect(pageMapCalls).toHaveLength(1);
    server.dashboard = { ...DASHBOARD, version: WITH_NEW_JOB.version + 1 };
    await advance(1000);
    expect(p.row(NEW_JOB.job.id)).toBeNull();
    expect(pageMapCalls).toHaveLength(2);
    await advance(10_000);
    expect(pageMapCalls).toHaveLength(2);
  }, T);

  it('a new run with other jobs is one request (the loader\'s), not two', async () => {
    const p = await open(`/employee/${ME}`);
    expect(pageMapCalls).toHaveLength(1);
    server.map = { ...MAP_WITH_LINES, runId: 'run-2' };
    server.dashboard = { ...WITH_NEW_JOB, version: 1, assigned: [NEW_JOB] };
    await advance(1000);
    await advance(0);
    expect(p.row(NEW_JOB.job.id)).not.toBeNull();
    expect(pageMapCalls).toHaveLength(2);
    await advance(10_000);
    expect(pageMapCalls).toHaveLength(2);
  }, T);
});

describe('Employee page: the open job waits for its route line', () => {
  it('asks again about every 5 s while the leg has no line and stops when the line is there', async () => {
    server.dashboard = WITH_NEW_JOB;
    const p = await open(`/employee/${ME}?job=${NEW_JOB.job.id}`);
    expect(p.jobTitle()).not.toBeNull();
    expect(p.text()).toContain(ROUTE_NOT_LOADED);
    expect(pageMapCalls).toHaveLength(1);

    await advance(MAP_LINE_RETRY_MS - 1000);
    expect(pageMapCalls).toHaveLength(1); // slow: not with every 1 s poll
    await advance(1000);
    expect(pageMapCalls).toHaveLength(2);
    expect(p.text()).toContain(ROUTE_NOT_LOADED); // the server has no line yet
    expect(p.text()).not.toContain(MAP_LOADING_TEXT);
    await advance(MAP_LINE_RETRY_MS);
    expect(pageMapCalls).toHaveLength(3);

    server.map = MAP_WITH_LINES; // the background fetch on the server finished
    await advance(MAP_LINE_RETRY_MS);
    expect(pageMapCalls).toHaveLength(4);
    expect(p.text()).not.toContain(ROUTE_NOT_LOADED);
    expect(p.jobTitle()).not.toBeNull();

    await advance(MAP_LINE_RETRY_MS * 6);
    expect(pageMapCalls).toHaveLength(4);
  }, T);

  it('stops when the job is closed; reopening it later asks at once, because the map is old', async () => {
    server.dashboard = WITH_NEW_JOB;
    const p = await open(`/employee/${ME}?job=${NEW_JOB.job.id}`);
    expect(p.text()).toContain(ROUTE_NOT_LOADED);
    await advance(2000);
    click(button(p.c, 'Back to deliveries'));
    await advance(0);
    expect(p.jobTitle()).toBeNull();
    await advance(MAP_LINE_RETRY_MS * 4);
    expect(pageMapCalls).toHaveLength(1);

    // The lines came in meanwhile; the page still holds the map from before.
    server.map = MAP_WITH_LINES;
    click(link(p.row(NEW_JOB.job.id)!, 'View job'));
    await advance(0);
    await advance(0);
    await advance(0);
    expect(p.jobTitle()).not.toBeNull();
    expect(pageMapCalls).toHaveLength(2);
    expect(p.text()).not.toContain(ROUTE_NOT_LOADED);
  }, T);

  it('a job whose lines are all in the map never starts the timer', async () => {
    const p = await open(`/employee/${ME}?job=${JOB.job.id}`);
    expect(p.jobTitle()).not.toBeNull();
    expect(p.text()).not.toContain(ROUTE_NOT_LOADED);
    await advance(MAP_LINE_RETRY_MS * 4);
    expect(pageMapCalls).toHaveLength(1);
  }, T);

  it('a failed retry keeps the old map and is tried again 5 s later', async () => {
    server.dashboard = WITH_NEW_JOB;
    const p = await open(`/employee/${ME}?job=${NEW_JOB.job.id}`);
    const fail = deferred<MapResponse>();
    server.hold = fail;
    await advance(MAP_LINE_RETRY_MS);
    expect(pageMapCalls).toHaveLength(2);
    await act(async () => { fail.reject(new Error('boom')); });
    expect(p.problem()).not.toBeNull(); // "Couldn't load the map." with Retry, above the old map
    expect(p.preview()).not.toBeNull();
    expect(p.text()).toContain('Delivery route'); // the old map's legend

    server.map = MAP_WITH_LINES;
    await advance(MAP_LINE_RETRY_MS - 1000);
    expect(pageMapCalls).toHaveLength(2);
    await advance(1000);
    expect(pageMapCalls).toHaveLength(3);
    expect(p.text()).not.toContain(ROUTE_NOT_LOADED);
    expect(p.problem()).toBeNull();
  }, T);

  it('leaves no timer behind after the page unmounts', async () => {
    server.dashboard = WITH_NEW_JOB;
    const p = await open(`/employee/${ME}?job=${NEW_JOB.job.id}`);
    expect(pageMapCalls).toHaveLength(1);
    p.unmount();
    await advance(MAP_LINE_RETRY_MS * 4);
    expect(pageMapCalls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  }, T);
});
