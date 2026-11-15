// @vitest-environment jsdom
// #548: the MVP II cutover in a real DOM. The real AppShell and the real pages on the four main paths, against
// a real /api/v2 on a copy of the committed fixtures/nyc (no key, no network; startRealApi). Checks that each
// path shows its MVP II page, that no request goes to an MVP 1 route, that "Synthetic" and "hub" are never
// rendered, that the header has no environment line (#854), and that /nyc/... redirects (replace) to the
// main path with its query string and hash.
import { act } from 'react';
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { IDENTITY_KEY, readIdentity } from '../../client/src/demoIdentity';
import type { BusinessesResponse, EmployeesResponse } from '../../shared/v2/api';
import { startRealApi, type RealApi } from './business-v2-real-helper';
import { flush, link, mount, select, textOf } from './kitDom';
import { loadWorkspacePages } from './lazy-pages-helper';

// The workspace pages are lazy routes (#885): load them first, so a render shows the page, not the loading line.
await loadWorkspacePages();

const T = 60_000;
let api: RealApi;
let bizId: string;
let empId: string;
let bizIds: string[];

beforeAll(async () => {
  api = await startRealApi();
  const b = (await (await fetch('/api/v2/businesses')).json()) as BusinessesResponse;
  const e = (await (await fetch('/api/v2/employees')).json()) as EmployeesResponse;
  bizIds = b.businesses.map((x) => x.id);
  bizId = bizIds[0];
  empId = e.employees[0].id;
}, T);
afterAll(async () => { await api?.close(); }, T);
beforeEach(() => { localStorage.clear(); });

/** Any request to an MVP 1 route. */
const MVP1_ROUTE = /^[A-Z]+ \/api\/(businesses|employees|simulator|map|shipments|jobs|matches|scenario)(\/|\?|$)/;
/** Words the mounted app must never render (visible text and the accessible attributes). */
const FORBIDDEN = /synthetic|\bhubs?\b/i;

type Where = { path: string; search: string; hash: string; type: string; go?: (delta: number) => void };
function Probe({ out }: { out: Where }) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  out.type = useNavigationType();
  out.go = (delta) => navigate(delta);
  out.path = pathname;
  out.search = search;
  out.hash = hash;
  return null;
}

async function renderApp(path: string, before: string[] = []) {
  const where: Where = { path: '', search: '', hash: '', type: '' };
  const m = mount(
    <MemoryRouter initialEntries={[...before, path]} initialIndex={before.length}>
      <AppShell />
      <Probe out={where} />
    </MemoryRouter>,
  );
  const header = () => m.container.querySelector('header.shell-header') as HTMLElement;
  const main = () => m.container.querySelector('main#main-content') as HTMLElement;
  /** Flushes until `ok()` holds (the pages poll every second; the real server answers in a few ms). */
  const until = async (ok: () => boolean, what: string) => {
    for (let i = 0; i < 400 && !ok(); i++) await flush();
    if (!ok()) throw new Error(`timed out waiting for ${what}; main: ${textOf(main()).slice(0, 300)}`);
  };
  return { ...m, where, header, main, until };
}

/** Visible text plus the attributes a screen reader or tooltip shows. */
function shownText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('*')].flatMap((el) =>
    ['aria-label', 'title', 'alt', 'placeholder'].map((a) => el.getAttribute(a) ?? ''));
  return [root.textContent ?? '', ...attrs].join(' \n ');
}

const PAGES = () => [
  { path: '/', marker: '.landing.landing-nyc', ready: 'a.workspace-entry', full: false },
  { path: `/business/${bizId}`, marker: 'div.bp', ready: 'div.bp .bp-notices', full: false }, // no <main> of its own (#581)
  { path: `/employee/${empId}`, marker: 'div.ep', ready: 'div.ep h1', full: false }, // the shell has the only <main> (#584)
  { path: '/simulator', marker: '.sim-v2', ready: '.sim-v2 .sw-left', full: true },
];

describe('the four main paths show the MVP II pages on the real NYC run', () => {
  it('each page renders, the header has no environment line, nothing says Synthetic or hub, no MVP 1 request', async () => {
    for (const p of PAGES()) {
      const before = api.requests.length;
      const s = await renderApp(p.path);
      await s.until(() => !!s.main().querySelector(p.marker) && !!s.main().querySelector(p.ready), `${p.path} page`);
      // and the header's lists
      await s.until(() => !!s.header().querySelector('a.shell-nav-link[href^="/employee/"]'), `${p.path} header lists`);
      expect(s.main().querySelector('.not-found'), p.path).toBeNull();
      expect(s.main().querySelector('.error-fallback'), p.path).toBeNull();
      expect(textOf(s.main()), p.path).not.toMatch(/not found|unavailable|something went wrong/i);
      expect(s.main().className, p.path).toBe(p.full ? 'app-main app-main--full' : 'app-main');
      // No environment line at the header's top right, on any page (#833, #854).
      expect(s.header().querySelector('.shell-env'), p.path).toBeNull();
      expect(textOf(s.header()), p.path).not.toMatch(/simulated deliveries|Real NYC locations/i);
      expect(link(s.header(), 'Relay').getAttribute('href')).toBe('/');
      expect(s.header().querySelector('a[href="/help"]'), p.path).toBeNull();
      expect(link(s.header(), 'Business').getAttribute('href')).toBe(`/business/${bizId}`);
      expect(link(s.header(), 'Employee').getAttribute('href')).toBe(`/employee/${empId}`);
      expect(link(s.header(), 'Simulator').getAttribute('href')).toBe('/simulator');
      expect(shownText(s.container).match(FORBIDDEN), p.path).toBeNull();
      for (const a of s.container.querySelectorAll('a[href]')) {
        expect(a.getAttribute('href'), `${p.path}: ${textOf(a)}`).not.toMatch(/^\/nyc(\/|$|\?|#)/);
      }
      const sent = api.requests.slice(before);
      expect(sent.some((r) => r.includes(' /api/v2/')), p.path).toBe(true);
      expect(sent.filter((r) => MVP1_ROUTE.test(r)), p.path).toEqual([]);
      s.unmount();
      await flush();
    }
    expect(api.requests.filter((r) => MVP1_ROUTE.test(r))).toEqual([]);
    expect(api.googleCalls).toEqual([]);
  }, T);

  it('the homepage links only to main paths', async () => {
    const s = await renderApp('/');
    await s.until(() => s.main().querySelectorAll('a[href^="/business/"]').length > 0, '/ links');
    const hrefs = [...s.main().querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);
    // the homepage has four links: "Watch a package" (with ?package=<id>&play=1, #652), Business, Employee and
    // "The numbers" to the static study page (#796). The Guided demo link is gone with the page (#623, #652).
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    expect(hrefs.filter((h) => h === '/study.html')).toHaveLength(1);
    for (const h of hrefs) expect(h).toMatch(/^\/(simulator(\?package=[^/&]+&play=1)?|business\/[^/]+|employee\/[^/]+|study\.html)$/);
  }, T);

  it('the selector stores the chosen business; a stored ID not in the NYC lists falls back to the first', async () => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ businessId: 'biz-sunrise', employeeId: 'emp-001' }));
    const s = await renderApp(`/business/${bizId}`);
    await s.until(() => !!s.header().querySelector('.demo-account select'), 'selector');
    expect(link(s.header(), 'Business').getAttribute('href')).toBe(`/business/${bizId}`);
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe(`/employee/${empId}`);
    const sel = s.header().querySelector('.demo-account select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(bizIds);
    select(sel, bizIds[1]);
    expect(s.where.path).toBe(`/business/${bizIds[1]}`);
    expect(readIdentity()).toEqual({ businessId: bizIds[1], employeeId: 'emp-001' });
    expect(link(s.header(), 'Business').getAttribute('href')).toBe(`/business/${bizIds[1]}`);
    await s.until(() => !!s.main().querySelector('div.bp h1'), 'the chosen business page');
  }, T);

  it('the employee selector names each employer, in the API\'s order (#568)', async () => {
    const b = (await (await fetch('/api/v2/businesses')).json()) as BusinessesResponse;
    const e = (await (await fetch('/api/v2/employees')).json()) as EmployeesResponse;
    const employer = new Map(b.businesses.map((x) => [x.id, x.name]));
    const s = await renderApp(`/employee/${empId}`);
    const sel = () => s.header().querySelector('.demo-account select') as HTMLSelectElement | null;
    await s.until(() => !!sel() && sel()!.options[0].text.includes(' · '), 'selector with employers');
    expect([...sel()!.options].map((o) => o.value)).toEqual(e.employees.map((x) => x.id));
    // Every real employee has an employer in the business list, so no label is a name alone.
    expect([...sel()!.options].map((o) => o.text)).toEqual(e.employees.map((x) => `${x.name} · ${employer.get(x.businessId)}`));
    for (const o of sel()!.options) expect(o.text).not.toMatch(/undefined|\bbiz-|\bemp-/);
    expect(sel()!.value).toBe(empId);
    const second = e.employees[1];
    select(sel()!, `${second.name} · ${employer.get(second.businessId)}`);
    expect(s.where.path).toBe(`/employee/${second.id}`);
    expect(readIdentity()).toEqual({ employeeId: second.id });
  }, T);
});

describe('/nyc/... redirects to the main paths', () => {
  const cases = () => [
    ['/nyc', '/', '', ''],
    ['/nyc/simulator', '/simulator', '?package=shp-x', ''],
    [`/nyc/business/${bizId}`, `/business/${bizId}`, '?shipment=shp-x', '#top'],
    [`/nyc/employee/${empId}`, `/employee/${empId}`, '?job=job-x', ''],
  ] as const;

  it('replaces the entry (Back skips it) and keeps the query string and hash, for all four', async () => {
    for (const [from, to, search, hash] of cases()) {
      const s = await renderApp(`${from}${search}${hash}`, ['/nowhere']);
      expect({ path: s.where.path, search: s.where.search, hash: s.where.hash }, from).toEqual({ path: to, search, hash });
      expect(s.where.type, from).toBe('REPLACE');
      expect(s.main().querySelector('.not-found'), from).toBeNull();
      // Back goes to the entry before /nyc/..., not to the redirect again.
      act(() => { s.where.go!(-1); });
      expect(s.where.path, from).toBe('/nowhere');
      s.unmount();
    }
  }, T);

  it('/nyc/ with a trailing slash goes home; a deeper unknown /nyc path ends on the 404', async () => {
    const home = await renderApp('/nyc/');
    expect(home.where.path).toBe('/');
    home.unmount();
    const lost = await renderApp('/nyc/nothing-here');
    expect(lost.where.path).toBe('/nothing-here');
    expect(textOf(lost.main())).toContain('Page not found');
  }, T);
});
