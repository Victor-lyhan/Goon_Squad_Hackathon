// @vitest-environment jsdom
// #724: `/business` and `/employee` without an ID replace-redirect to the account the header's link of that
// kind points to (the remembered one, else the first); while the list is loading or failed they say so and
// are never the 404 page. The homepage says "Real NYC locations · simulated deliveries" once, in the header.
// And the keyboard order of `/` and the header, as found in headless Chrome at 1440 px and 390 px.
// The real AppShell, header and homepage in a real DOM against a fake /api/v2; the three workspace pages are
// stand-ins.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEY, readIdentity } from '../../client/src/demoIdentity';
import { NYC_UNAVAILABLE_TEXT, type NycSummary } from '../../client/src/pages/landingModel';
import { DIRECTORY_RETRY_MS } from '../../client/src/ui/shell';
import {
  ACCOUNTS_ERROR_TEXT, ACCOUNTS_LOADING_TEXT, bareWorkspace, ENV_LABELS,
} from '../../client/src/ui/shellModel';
import { fakeApi, renderShell, type FakeList } from './kit-dom-shell-helper';
import { click, deferred, flush, link, tabOrder, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

const T = 10_000;
const BUSINESSES = [
  { id: 'biz-01', name: 'Brooklyn Roasters' },
  { id: 'biz-02', name: 'Hudson Print Co' },
  { id: 'biz-03', name: 'Titan Foods' },
];
const EMPLOYEES = [
  { id: 'emp-01', name: 'Maya Chen' },
  { id: 'emp-02', name: 'Luis Ortega' },
  { id: 'emp-03', name: 'Ana Ruiz' },
];
const SUMMARY: NycSummary = {
  status: 'ready', businesses: 3, commuters: 3, matched: 24, requested: 24,
  businessIds: BUSINESSES.map((b) => b.id), employeeIds: EMPLOYEES.map((e) => e.id), watchPackageId: 'shp-4',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const api = (lists: { employees?: FakeList; businesses?: FakeList } = {}) =>
  fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES, ...lists });
const store = (identity: object) => localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
const hrefOf = (root: ParentNode, label: string) => link(root, label).getAttribute('href');
/** The page a stand-in route rendered ("BusinessV2 at /business/biz-01"), or null. */
const pageOf = (main: HTMLElement) => main.querySelector('[data-page]')?.textContent ?? null;
const count = (text: string, part: string) => text.split(part).length - 1;

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('/business and /employee without an ID go to the header\'s account', () => {
  it.each([
    ['/business', '/business/biz-01', 'BusinessV2'],
    ['/business/', '/business/biz-01', 'BusinessV2'],
    ['/employee', '/employee/emp-01', 'EmployeeV2'],
    ['/employee/', '/employee/emp-01', 'EmployeeV2'],
  ])('%s opens %s (the first account) and replaces the history entry', async (bare, target, name) => {
    api();
    const s = await renderShell(bare, ['/simulator']);
    expect(s.where.path).toBe(target);
    expect(s.where.search).toBe('');
    expect(pageOf(s.main())).toBe(`${name} at ${target}`);
    expect(textOf(s.main())).not.toContain('Page not found');
    // It is the page the header's link of that kind points to, and that link is the current one.
    const label = name === 'BusinessV2' ? 'Business' : 'Employee';
    expect(hrefOf(s.header(), label)).toBe(target);
    expect(link(s.header(), label).getAttribute('aria-current')).toBe('page');
    // Replaced, not pushed: Back leaves to the page before, not to the bare path (which would bounce forward).
    s.back();
    await flush();
    expect(s.where.path).toBe('/simulator');
  }, T);

  it('the remembered account wins, as in the header links', async () => {
    api();
    store({ businessId: 'biz-02', employeeId: 'emp-03' });
    const home = await renderShell('/', [], { initialNycSummary: SUMMARY });
    const links = { business: hrefOf(home.header(), 'Business'), employee: hrefOf(home.header(), 'Employee') };
    expect(links).toEqual({ business: '/business/biz-02', employee: '/employee/emp-03' });
    home.unmount();

    const b = await renderShell('/business');
    expect(b.where.path).toBe(links.business);
    b.unmount();
    const e = await renderShell('/employee/');
    expect(e.where.path).toBe(links.employee);
    expect(readIdentity()).toEqual({ businessId: 'biz-02', employeeId: 'emp-03' });
  }, T);

  it('a remembered account that is not in the list falls back to the first one', async () => {
    api();
    store({ businessId: 'biz-gone', employeeId: 'emp-gone' });
    const b = await renderShell('/business');
    expect(b.where.path).toBe('/business/biz-01');
    b.unmount();
    const e = await renderShell('/employee');
    expect(e.where.path).toBe('/employee/emp-01');
  }, T);

  it('drops the query string: a ?shipment= belongs to one account', async () => {
    api();
    const s = await renderShell('/business?shipment=shp-10');
    expect(s.where).toEqual({ path: '/business/biz-01', search: '' });
  }, T);

  it('while the list is loading it says so, not "Page not found", then redirects', async () => {
    const pendingB = deferred<Response>();
    api({ businesses: () => pendingB.promise });
    const s = await renderShell('/business', ['/']);
    expect(s.where.path).toBe('/business');
    const state = s.main().querySelector('.shell-page-state')!;
    expect(textOf(state)).toBe(ACCOUNTS_LOADING_TEXT);
    expect(state.getAttribute('role')).toBe('status');
    expect(textOf(s.main())).toBe('Loading accounts…');
    expect(s.main().querySelector('.not-found')).toBeNull();

    pendingB.resolve(json(200, { businesses: BUSINESSES }));
    await flush();
    await flush();
    expect(s.where.path).toBe('/business/biz-01');
    expect(pageOf(s.main())).toBe('BusinessV2 at /business/biz-01');
    s.back();
    await flush();
    expect(s.where.path).toBe('/');
    s.unmount();

    // /employee waits for its own list only.
    const pendingE = deferred<Response>();
    api({ employees: () => pendingE.promise });
    const e = await renderShell('/employee');
    expect(hrefOf(e.header(), 'Business')).toBe('/business/biz-01'); // the other list is ready
    expect(textOf(e.main())).toBe(ACCOUNTS_LOADING_TEXT);
    pendingE.resolve(json(200, { employees: EMPLOYEES }));
    await flush();
    await flush();
    expect(e.where.path).toBe('/employee/emp-01');
  }, T);

  it.each<[string, () => Response, string, string]>([
    ['unreachable', () => { throw new TypeError('Failed to fetch'); }, ACCOUNTS_ERROR_TEXT, 'alert'],
    ['503', () => json(503, { error: 'NYC travel data is not loaded', code: 'travel_data_missing' }), NYC_UNAVAILABLE_TEXT, 'status'],
  ])('while the API is %s it says so, and redirects when the list arrives 3 s later', async (_, down, text, role) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const state = { up: false };
    api({
      employees: () => (state.up ? json(200, { employees: EMPLOYEES }) : down()),
      businesses: () => (state.up ? json(200, { businesses: BUSINESSES }) : down()),
    });
    const s = await renderShell('/employee');
    expect(s.where.path).toBe('/employee');
    const line = s.main().querySelector('.shell-page-state')!;
    expect(textOf(line)).toBe(text);
    expect(line.getAttribute('role')).toBe(role);
    expect(textOf(s.main())).not.toContain('Page not found');

    state.up = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(DIRECTORY_RETRY_MS); });
    await flush();
    expect(s.where.path).toBe('/employee/emp-01');
  }, T);

  it('an empty list has no account to open: the 404 page', async () => {
    api({ businesses: [] });
    const s = await renderShell('/business');
    expect(s.where.path).toBe('/business');
    expect(textOf(s.main().querySelector('h1')!)).toBe('Page not found');
  }, T);

  it('unknown paths are still the 404 page, and /nyc/business still loses only its prefix', async () => {
    api();
    for (const p of ['/businesses', '/employee/emp-01/x', '/business/biz-01/x', '/nowhere']) {
      const s = await renderShell(p);
      expect(s.where.path, p).toBe(p);
      expect(textOf(s.main().querySelector('h1')!), p).toBe('Page not found');
      s.unmount();
    }
    const s = await renderShell('/nyc/business');
    expect(s.where.path).toBe('/business/biz-01'); // /nyc/business → /business (pass 57) → the account
  }, T);
});

describe('bareWorkspace', () => {
  const ids = ['a', 'b c'];
  it('is the header link of that kind: the stored ID if listed, else the first', () => {
    expect(bareWorkspace('business', { status: 'ready', ids }, 'b c')).toEqual({ kind: 'redirect', to: '/business/b%20c' });
    expect(bareWorkspace('business', { status: 'ready', ids }, 'zz')).toEqual({ kind: 'redirect', to: '/business/a' });
    expect(bareWorkspace('employee', { status: 'ready', ids }, undefined)).toEqual({ kind: 'redirect', to: '/employee/a' });
  });
  it('is the state of a list that is not ready, and "none" for an empty one', () => {
    for (const status of ['loading', 'unavailable', 'error'] as const) {
      expect(bareWorkspace('employee', { status }, 'a')).toEqual({ kind: status });
    }
    expect(bareWorkspace('business', { status: 'ready', ids: [] }, 'a')).toEqual({ kind: 'none' });
  });
});

describe('the homepage says the environment once', () => {
  it('in the header\'s .shell-env, not in the page: no footer', async () => {
    api();
    const s = await renderShell('/', [], { initialNycSummary: SUMMARY });
    expect(count(textOf(s.container), ENV_LABELS.nyc)).toBe(1);
    expect(textOf(s.header().querySelector('.shell-env')!)).toBe('Real NYC locations · simulated deliveries');
    expect(textOf(s.main())).not.toContain(ENV_LABELS.nyc);
    expect(s.container.querySelector('footer, .landing-footer')).toBeNull();
    // The page still ends with its stats line.
    expect(s.main().querySelector('.landing')!.lastElementChild!.className).toBe('op-summary');
  }, T);

  it('landing.css has no footer rule left, Landing.tsx no footer', () => {
    expect(readFileSync('client/src/styles/landing.css', 'utf8')).not.toContain('landing-footer');
    const src = readFileSync('client/src/pages/Landing.tsx', 'utf8');
    expect(src).not.toMatch(/<footer|NYC_ENV_TEXT|ENV_LABELS|ENV_INDICATOR_TEXT/);
  });
});

describe('keyboard order of / and the header (headless Chrome pass, 1440 px and 390 px)', () => {
  /** A Tab stop as "<its class> <where it goes>"; the selector as "select". */
  const stop = (el: HTMLElement) => (el instanceof HTMLSelectElement ? 'select' : `${el.classList[0]} ${el.getAttribute('href')}`);

  it('/: Skip, Relay, Business, Employee, Simulator, Watch a package, the two entries, then The numbers (#796)', async () => {
    api();
    const s = await renderShell('/', [], { initialNycSummary: SUMMARY });
    const stops = tabOrder(s.container);
    expect(stops.map(stop)).toEqual([
      'skip-link #main-content', 'shell-wordmark /',
      'shell-nav-link /business/biz-01', 'shell-nav-link /employee/emp-01', 'shell-nav-link /simulator',
      'watch-button /simulator?package=shp-4&play=1', 'workspace-entry /business/biz-01', 'workspace-entry /employee/emp-01',
      'landing-more-link /study.html',
    ]);
    expect(stops.map((el) => textOf(el).slice(0, 8))).toEqual(['Skip to ', 'Relay', 'Business', 'Employee', 'Simulato', 'Watch a ', 'Business', 'Employee', 'The numb']);
    expect(stops.every((el) => el.tabIndex === 0)).toBe(true); // document order, no positive tabindex
    // The skip link's target takes focus but is not a Tab stop.
    const main = s.main();
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(main.classList.contains('app-main')).toBe(true);

    // Enter on a focused link is its click: the simulator on the story package, playing.
    click(link(main, 'Watch a package'));
    expect(s.where).toEqual({ path: '/simulator', search: '?package=shp-4&play=1' });
  }, T);

  it('an account page: the Demo account selector comes right after the three links', async () => {
    api();
    const s = await renderShell('/business');
    expect(tabOrder(s.header()).map(stop)).toEqual([
      'shell-wordmark /', 'shell-nav-link /business/biz-01', 'shell-nav-link /employee/emp-01', 'shell-nav-link /simulator', 'select',
    ]);
    expect(s.selector()!.value).toBe('biz-01');
  }, T);

  describe('shell.css', () => {
    const css = readFileSync('client/src/ui/shell.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const block = (px: number) => new RegExp(`@media \\(max-width: ${px}px\\) \\{([\\s\\S]*?)\\n\\}`).exec(css)![1];

    it('draws the ring of the skip link\'s target inside <main>, where the window edge cannot cut it', () => {
      expect(css).toMatch(/\.app-main:focus-visible \{ outline-offset: -2px; \}/);
      expect(css).not.toMatch(/outline:\s*(none|0)\b/);
    });

    it('never draws the header in another order than Tab visits it: nav before tools at every width', () => {
      // DOM order is wordmark, nav, tools. Where the nav is moved to its own row, the tools follow it.
      const orders = (rules: string) => Object.fromEntries(
        [...rules.matchAll(/(\.shell-[a-z-]+) \{[^}]*\border: (\d+)/g)].map((m) => [m[1], Number(m[2])]),
      );
      const wide = orders(css.replace(/@media[\s\S]*?\n\}/g, ''));
      expect(wide).toEqual({});
      const mid = orders(block(600));
      expect(mid['.shell-nav']).toBe(3);
      expect(mid['.shell-tools']).toBeGreaterThan(mid['.shell-nav']);
      // The 480 px block does not take the order back.
      expect(orders(block(480))).toEqual({});
    });

    it('the line of a bare path uses tokens only', () => {
      const rules = [...css.matchAll(/\.shell-page-state[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
      expect(rules).toHaveLength(2);
      for (const r of rules) expect(r).not.toMatch(/#[0-9a-f]{3,8}\b|box-shadow|gradient|border-radius/i);
      expect(rules.join(' ')).toMatch(/color: var\(--muted\)/);
      expect(rules.join(' ')).toMatch(/color: var\(--danger\)/);
    });
  });
});
