// Issue #513: one commute save over HTTP, demo step 1, on a COPY of the committed fixtures/nyc in a temp folder.
// The whole server is started the way server/index.ts does (`startBootstrapApi` of tests/api/v2-bootstrap-helper.ts,
// which calls `createV2Runtime`), with no Google key. The browser side is the real client/src/api/v2.ts: its
// relative `/api/v2/...` URLs are sent to the test server, and any other URL fails the test.
// An employee moves to another workplace and to a home of another neighborhood that is already in the run (a
// home of the 120-home pool, whose pairs are cached, DECISIONS pass 54), so the save needs no Google call.
// Then the address search runs against the same server and gets the 503 of GET /api/v2/geocode.
// Rules only: the employee, workplace and home are picked from the data, never by ID or name (pass 54).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard } from '../../shared/v2/api';
import type { Employee, Home, NetworkBusiness } from '../../shared/v2/types';
import {
  ApiRequestError, geocode, getBusinesses, getEmployeeDashboard, getEmployees, getMap, putCommute,
} from '../../client/src/api/v2';
import { AddressSearchView, runSearch } from '../../client/src/components/employee/v2/AddressSearch';
import {
  UNAVAILABLE_TEXT, addressSearchReducer, initialSearchState, type AddressSearchAction, type AddressSearchState,
} from '../../client/src/components/employee/v2/addressSearchModel';
import { searchFromGeocode } from '../../client/src/components/employee/v2/page/employeePageModel';
import { formatClock } from '../../client/src/ui/format';
import { NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { KEY_MISSING_MESSAGE } from '../../server/api/geo';
import { startBootstrapApi, type BootstrapApi, type TempRepo } from '../api/v2-bootstrap-helper';
import { nycFilesState, repoDataState } from '../api/v2-e2e-nyc-helper';
import {
  T, elementWith, expectCleanPage, readyState, renderPage, textOf,
} from './employee-v2-real-helper';

// ---------- a copy of fixtures/nyc, the server, and the browser's fetch ----------

/** Every committed file of fixtures/nyc (the three inputs and the travel cache), copied to a temp repo layout. */
function copyOfNyc(): TempRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-v2-real-'));
  const fixturesDir = path.join(root, 'fixtures', 'nyc');
  fs.mkdirSync(fixturesDir, { recursive: true });
  for (const name of fs.readdirSync(NYC_FIXTURES_DIR)) {
    if (fs.statSync(path.join(NYC_FIXTURES_DIR, name)).isFile()) fs.copyFileSync(path.join(NYC_FIXTURES_DIR, name), path.join(fixturesDir, name));
  }
  return {
    root,
    fixturesDir,
    statePath: path.join(root, 'data', 'state-v2.json'),
    mvp1StatePath: path.join(root, 'data', 'state.json'),
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const realFetch = globalThis.fetch;
let repo: TempRepo;
let api: BootstrapApi;
/** What the server's Google clients tried to fetch. Must stay empty. */
const googleCalls: string[] = [];
/** What the browser side tried to fetch outside the test server. Must stay empty. */
const outgoing: string[] = [];
/** Every answer the browser side got from the test server: `PUT /api/v2/employees/emp-1/commute 200`. */
const answers: string[] = [];
let nycBefore: string[];
let dataBefore: string[] | null;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  nycBefore = nycFilesState();
  dataBefore = repoDataState();
  repo = copyOfNyc();
  api = await startBootstrapApi({
    cache: 'empty', // ignored: `repo` is used as it is
    repo,
    key: null,
    fetch: async (url) => {
      googleCalls.push(String(url).split('?')[0]);
      throw new Error('employee-v2-real: the server must not call Google');
    },
  });
  if (api.runtime.status !== 'ready') throw new Error(`/api/v2 did not load on the copy of fixtures/nyc: ${api.runtime.reason}`);
  // The browser's fetch: relative /api/... URLs go to the test server, everything else is refused.
  const base = await serverOrigin();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = raw.startsWith('/') ? base + raw : raw;
    if (!url.startsWith(base)) {
      outgoing.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      throw new TypeError('employee-v2-real: the browser side may only call the test server');
    }
    const res = await realFetch(url, init);
    answers.push(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${res.status}`);
    return res;
  });
}, T);

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await api?.close();
  repo?.remove();
  // Nothing was written to the repo's fixtures/nyc or data/.
  expect(nycFilesState()).toStrictEqual(nycBefore);
  expect(repoDataState()).toStrictEqual(dataBefore);
}, T);

/** The origin of the running test server, read from a request the helper makes. */
async function serverOrigin(): Promise<string> {
  let seen = '';
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    seen = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).origin;
    return realFetch(input, init);
  });
  try {
    await api.v2.get('/businesses');
  } finally {
    spy.mockRestore();
  }
  if (!seen) throw new Error('could not read the test server origin');
  return seen;
}

// ---------- picking the move from the data ----------

type Move = { employee: Employee; from: Home; to: Home; workplace: NetworkBusiness };

/**
 * The first employee (ID order) with a home of the run in another neighborhood and another workplace. A home of
 * the 120-home pool (`home-<digits>`) is preferred, and a workplace whose commute lines to and from that home are
 * cached, so the save needs nothing from Google (pass 54). Picked from the data, so a story retune moves it.
 */
function pickMove(employees: Employee[], homes: Home[], businesses: NetworkBusiness[]): Move {
  const polylines = JSON.parse(fs.readFileSync(path.join(repo.fixturesDir, 'polylines.json'), 'utf8')).polylines as Record<string, string | null>;
  const lined = (a: string, b: string) => Object.keys(polylines).some((k) => k.includes(a) && k.includes(b) && polylines[k]);
  const homeById = new Map(homes.map((h) => [h.id, h]));
  const pool = (h: Home) => /^home-\d+$/.test(h.id);
  const sortedHomes = [...homes].sort((a, b) => Number(pool(b)) - Number(pool(a)) || (a.id < b.id ? -1 : 1));
  const candidates: Move[] = [];
  for (const employee of [...employees].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const from = homeById.get(employee.homeId)!;
    for (const to of sortedHomes) {
      if (to.neighborhood === from.neighborhood) continue;
      for (const workplace of businesses) {
        if (workplace.id === employee.businessId) continue;
        candidates.push({ employee, from, to, workplace });
        if (pool(to) && lined(workplace.id, to.id)) return { employee, from, to, workplace };
      }
    }
  }
  if (candidates.length === 0) throw new Error('No employee can move to a home of another neighborhood in this run');
  return candidates[0];
}

const commuteSection = (html: string) => textOf(elementWith(html, 'aria-labelledby="ew-commute-heading"') ?? '');

// ---------- the tests ----------

describe('one commute save over HTTP on a copy of fixtures/nyc, no key', () => {
  let move: Move;
  let before: EmployeeDashboard;
  let saved: CommuteResponse;

  it('the workspace shows the commute the server has before the save', async () => {
    const [{ employees }, { businesses }, map] = await Promise.all([getEmployees(), getBusinesses(), getMap()]);
    move = pickMove(employees, map.homes, businesses);
    before = await getEmployeeDashboard(move.employee.id);
    expect(before.phase).toBe('planning'); // a fresh boot can be edited
    const html = renderPage(readyState(before, businesses, map.runId), null, map);
    const c = commuteSection(html);
    expect(c).toContain(move.from.neighborhood);
    expect(c).toContain(businesses.find((b) => b.id === move.employee.businessId)!.name);
  }, T);

  it('moves the employee to another workplace and neighborhood: a 200 with no Google call', async () => {
    const answered = answers.length;
    saved = await putCommute(move.employee.id, {
      businessId: move.workplace.id,
      home: { homeId: move.to.id },
      eveningDepartureMin: move.employee.eveningDepartureMin,
      morningDepartureMin: move.employee.morningDepartureMin,
      availableEvening: move.employee.availableEvening,
      availableMorning: move.employee.availableMorning,
      maxExtraMin: move.employee.maxExtraMin,
    });
    expect(answers.slice(answered)).toStrictEqual([`PUT /api/v2/employees/${encodeURIComponent(move.employee.id)}/commute 200`]);
    expect(googleCalls).toStrictEqual([]);
    expect(outgoing).toStrictEqual([]);

    expect(saved.employee.businessId).toBe(move.workplace.id);
    expect(saved.employee.homeId).toBe(move.to.id);
    expect(saved.home).toStrictEqual(move.to);
    expect(saved.trips.map((t) => t.direction).sort()).toStrictEqual(['evening', 'morning']);
    for (const trip of saved.trips) {
      expect([trip.originPlaceId, trip.destinationPlaceId].sort()).toStrictEqual([move.workplace.id, move.to.id].sort());
      expect(Number.isFinite(trip.baselineDurationMin) && trip.baselineDurationMin > 0).toBe(true);
    }
    expect(Array.isArray(saved.rematchedShipmentIds)).toBe(true);
  }, T);

  it('the workspace rendered from the next dashboard shows the new commute', async () => {
    const [after, { businesses }, map] = await Promise.all([getEmployeeDashboard(move.employee.id), getBusinesses(), getMap()]);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.employee.businessId).toBe(move.workplace.id);
    expect(after.home.id).toBe(move.to.id);
    // The map the page fetches again after a save knows the new commute.
    expect(map.homes.map((h) => h.id)).toContain(move.to.id);
    for (const trip of after.trips) {
      expect(map.polylines.some((p) => p.from === trip.originPlaceId && p.to === trip.destinationPlaceId)).toBe(true);
    }

    const html = renderPage(readyState(after, businesses, map.runId), null, map);
    const c = commuteSection(html);
    const newWork = businesses.find((b) => b.id === move.workplace.id)!.name;
    const oldWork = businesses.find((b) => b.id === move.employee.businessId)!.name;
    expect(c).toContain(newWork);
    expect(c).toContain(move.to.neighborhood);
    if (oldWork !== newWork) expect(c).not.toContain(oldWork);
    expect(c).not.toContain(move.from.neighborhood);
    for (const trip of after.trips) {
      const available = trip.direction === 'evening' ? after.employee.availableEvening : after.employee.availableMorning;
      if (available) expect(c).toContain(`Departs ${formatClock(trip.departureMin)}`);
    }
    expect(c).toContain(`Up to ${after.employee.maxExtraMin} min extra per trip`);
    expectCleanPage(html, `${move.employee.id} after the save`, map.homes, businesses);
    expect(googleCalls).toStrictEqual([]);
    expect(outgoing).toStrictEqual([]);
  }, T);

  it('the address search against the same server shows the 503 of GET /api/v2/geocode and does not throw', async () => {
    // The raw answer: a 503 with the key-missing message.
    const answered = answers.length;
    const err = await geocode('350 5th Ave, New York').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(503);
    expect((err as ApiRequestError).message).toBe(KEY_MISSING_MESSAGE);
    expect(answers.slice(answered)).toStrictEqual(['GET /api/v2/geocode 503']);

    // The page's search: the same call through `searchFromGeocode`, run the way AddressSearch runs it.
    const query = '350 5th Ave, New York';
    let state: AddressSearchState = addressSearchReducer(initialSearchState, { type: 'input', query });
    const dispatch = (a: AddressSearchAction) => { state = addressSearchReducer(state, a); };
    dispatch({ type: 'searchStart', query });
    await expect(runSearch(searchFromGeocode(geocode), query, new AbortController().signal, dispatch)).resolves.toBeUndefined();
    expect(state.status).toBe('unavailable');

    const html = renderToStaticMarkup(createElement(AddressSearchView, { id: 'addr', state, value: null, editing: false }));
    const status = textOf(elementWith(html, 'role="status"') ?? '');
    expect(status).toBe(UNAVAILABLE_TEXT);
    expect(html).not.toMatch(/undefined|NaN/);
    expect(googleCalls).toStrictEqual([]);
    expect(outgoing).toStrictEqual([]);
  }, T);
});
