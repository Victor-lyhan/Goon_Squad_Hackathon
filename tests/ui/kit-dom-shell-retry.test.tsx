// @vitest-environment jsdom
// #636: the header and the 404 page in a real DOM when the API comes up after the page. "Accounts
// unavailable" and the greyed Business and Employee links recover 3 s later without a reload, through the
// retry of the loaders in client/src/ui/shell.ts (tests/ui/kit-v2-shell-retry.test.ts has the loader itself).
// The workspace pages are stand-ins. setTimeout is faked and follows the real clock, so the helpers' flush
// still works and the 3 s are jumped, not waited for. The paths name the first account of each list, so the
// links are the same whether or not opening an account page stores it as the demo account (#623).
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECTORY_RETRY_MS } from '../../client/src/ui/shell';
import { fakeApi, renderShell, V2_BUSINESSES, V2_EMPLOYEES } from './kit-dom-shell-helper';
import { flush, link, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', page('Landing'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

const T = 10_000;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The two list routes: `down()` is what they answer (or throw) until `api.up = true`. */
function lateApi(down: () => Response) {
  const state = { up: false };
  const route = (key: string, rows: unknown[]) => () => (state.up ? json(200, { [key]: rows }) : down());
  const { calls } = fakeApi({ employees: route('employees', V2_EMPLOYEES), businesses: route('businesses', V2_BUSINESSES) });
  const count = (url: string) => calls.filter((c) => c === url).length;
  return { state, count };
}
const unreachable = (): Response => { throw new TypeError('Failed to fetch'); };
const travelMissing = () => json(503, { error: 'NYC travel data is not loaded', code: 'travel_data_missing' });

/** Lets the retry timers of the next `ms` run, then the answers settle. */
async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await flush();
}

const greyed = (root: ParentNode) =>
  [...root.querySelectorAll('.nav-pending')].map((el) => textOf(el));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the header after a failed first load (#636)', () => {
  it('"Accounts unavailable" and the greyed links recover 3 s after the API is up, and the loading stops', async () => {
    const api = lateApi(unreachable);
    const s = await renderShell('/employee/emp-01');
    expect(textOf(s.header().querySelector('[role="alert"]')!)).toBe('Accounts unavailable');
    expect(greyed(s.header())).toEqual(['Business', 'Employee']);
    expect(s.selector()).toBeNull();
    expect(api.count('/api/v2/employees')).toBe(1);

    await wait(DIRECTORY_RETRY_MS); // still down: asked once more, the header says the same
    expect(api.count('/api/v2/employees')).toBe(2);
    expect(api.count('/api/v2/businesses')).toBe(2);
    expect(textOf(s.header().querySelector('[role="alert"]')!)).toBe('Accounts unavailable');

    api.state.up = true;
    await wait(DIRECTORY_RETRY_MS);
    expect(s.header().querySelector('[role="alert"]')).toBeNull();
    expect(greyed(s.header())).toEqual([]);
    expect(s.selector()!.value).toBe('emp-01');
    expect([...s.selector()!.options].map((o) => o.value)).toEqual(['emp-01', 'emp-02']);
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/business/biz-01');
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-01');
    expect(s.where.path).toBe('/employee/emp-01'); // no navigation, no reload

    await wait(DIRECTORY_RETRY_MS * 4);
    expect(api.count('/api/v2/employees')).toBe(3);
    expect(api.count('/api/v2/businesses')).toBe(3);
  }, T);

  it('a 503 (no travel data yet) and then the lists: the links and the selector appear', async () => {
    const api = lateApi(travelMissing);
    const s = await renderShell('/business/biz-01');
    expect(greyed(s.header())).toEqual(['Business', 'Employee']);
    expect(s.selector()).toBeNull();
    expect(s.header().querySelector('[role="alert"]')).toBeNull(); // the page below explains a 503

    api.state.up = true;
    await wait(DIRECTORY_RETRY_MS);
    expect(greyed(s.header())).toEqual([]);
    expect(s.selector()!.value).toBe('biz-01');
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/business/biz-01');
    expect(api.count('/api/v2/businesses')).toBe(2);
  }, T);

  it('leaving the page stops the retries', async () => {
    const api = lateApi(unreachable);
    const s = await renderShell('/simulator');
    expect(greyed(s.header())).toEqual(['Business', 'Employee']);
    s.unmount();
    api.state.up = true;
    await wait(DIRECTORY_RETRY_MS * 4);
    expect(api.count('/api/v2/employees')).toBe(1);
    expect(api.count('/api/v2/businesses')).toBe(1);
  }, T);
});

describe('the 404 page after a failed first load (#636)', () => {
  // Since #886 the 404 page has no workspace links of its own and loads no list: the header's links are the
  // ones that recover, and each list is asked for by the header alone.
  it('the header links recover 3 s after the API is up; the page itself asks for nothing', async () => {
    const api = lateApi(unreachable);
    const s = await renderShell('/no-such-page');
    expect(greyed(s.header())).toEqual(['Business', 'Employee']);
    expect(greyed(s.main())).toEqual([]);
    expect(textOf(s.main().querySelector('h1')!)).toBe('Page not found');

    api.state.up = true;
    await wait(DIRECTORY_RETRY_MS);
    expect(greyed(s.header())).toEqual([]);
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/business/biz-01');
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-01');
    expect([...s.main().querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/']);
    // Only the header's two loaders: each list asked twice.
    expect(api.count('/api/v2/employees')).toBe(2);
    expect(api.count('/api/v2/businesses')).toBe(2);
  }, T);
});
