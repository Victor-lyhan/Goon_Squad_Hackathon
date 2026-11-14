// Shared setup for tests/ui/kit-dom-shell-*.test.tsx (#529): the real AppShell in a MemoryRouter,
// a fake fetch that answers the two /api/v2 lists, and a probe for the current location.
// The test files mock the page modules with ./kit-dom-shell-pages before importing this.
import { act, type ComponentProps } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { vi } from 'vitest';
import { AppShell } from '../../client/src/App';
import { flush, mount } from './kitDom';

export const V2_EMPLOYEES = [
  { id: 'emp-01', name: 'Maya Chen' },
  { id: 'emp-02', name: 'Luis Ortega' },
];
export const V2_BUSINESSES = [
  { id: 'biz-01', name: 'Brooklyn Roasters' },
  { id: 'biz-02', name: 'Hudson Print Co' },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** What a list route of the fake API answers: the list, or a Response (or a pending one) of the test's own. */
export type FakeList = readonly unknown[] | (() => Response | Promise<Response>);
const answer = (key: string, list: FakeList) => (typeof list === 'function' ? list() : json(200, { [key]: list }));

/**
 * Fake fetch: the /api/v2 lists, a healthy /api/health, 404 for anything else (also the runId poll). Records
 * every URL. `lists` replaces a list or its whole answer (#568).
 */
export function fakeApi(lists: { employees?: FakeList; businesses?: FakeList } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    calls.push(url);
    if (url === '/api/v2/employees') return answer('employees', lists.employees ?? V2_EMPLOYEES);
    if (url === '/api/v2/businesses') return answer('businesses', lists.businesses ?? V2_BUSINESSES);
    if (url === '/api/health') return new Response(null, { status: 200 });
    return json(404, { error: 'Not found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export type Where = { path: string; search: string };

function Probe({ out, history }: { out: Where; history: { go?: (delta: number) => void } }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  history.go = (delta) => navigate(delta);
  out.path = pathname;
  out.search = search;
  return null;
}

/**
 * Mounts the shell at `path` (after `before` in the history), lets the /api/v2 lists load, and returns the
 * live location and a Back action. `props` are passed to AppShell (lists given by the test, #568).
 */
export async function renderShell(path: string, before: string[] = [], props: ComponentProps<typeof AppShell> = {}) {
  const where: Where = { path: '', search: '' };
  const history: { go?: (delta: number) => void } = {};
  const m = mount(
    <MemoryRouter initialEntries={[...before, path]} initialIndex={before.length}>
      <AppShell {...props} />
      <Probe out={where} history={history} />
    </MemoryRouter>,
  );
  await flush();
  await flush();
  const header = () => m.container.querySelector('header.shell-header') as HTMLElement;
  const main = () => m.container.querySelector('main#main-content') as HTMLElement;
  const selector = () => header().querySelector('.demo-account select') as HTMLSelectElement | null;
  const back = () => act(() => { history.go!(-1); });
  return { ...m, where, header, main, selector, back };
}
