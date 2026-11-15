// #548 (was #462, #475, #504 on /nyc/...): since the cutover the main paths mount the MVP II pages and the
// header takes its lists from /api/v2 everywhere. Server-rendered, so the lists are passed in.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { ApiRequestError, isTravelUnavailable } from '../../client/src/api/v2';
import {
  startV2BusinessDirectory, startV2Directory, switchIdentityPath, type V2BusinessDirectory, type V2Directory,
} from '../../client/src/ui/shell';
import {
  activeDestination, cutoverPath, isFullWidthPath, isLegacyPreviewPath, pickAccount, workspaceHrefs,
} from '../../client/src/ui/shellModel';
import { loadWorkspacePages } from './lazy-pages-helper';

// The workspace pages are lazy routes (#885): load them first, so a render shows the page, not the loading line.
await loadWorkspacePages();

const v2Employees = [
  { id: 'emp-01', name: 'Maya Chen' },
  { id: 'emp-02', name: 'Luis Ortega' },
];
const v2Ready: V2Directory = { status: 'ready', employees: v2Employees };
const v2Down: V2Directory = { status: 'unavailable' };
const v2Businesses = [
  { id: 'biz-01', name: 'Brooklyn Roasters' },
  { id: 'biz-02', name: 'Hudson Print Co' },
];
const v2BizReady: V2BusinessDirectory = { status: 'ready', businesses: v2Businesses };

const render = (path: string, initialV2: V2Directory = v2Ready, initialV2Businesses: V2BusinessDirectory = v2BizReady) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initialV2={initialV2} initialV2Businesses={initialV2Businesses} />
    </MemoryRouter>,
  );
const header = (html: string) => /<header class="shell-header">([\s\S]*?)<\/header>/.exec(html)![1];
const nav = (html: string) => /<nav aria-label="Workspaces" class="shell-nav">([\s\S]*?)<\/nav>/.exec(header(html))![1];
const main = (html: string) => /<main class="([^"]*)" id="main-content"[^>]*>([\s\S]*)<\/main>/.exec(html)!;
const current = (html: string) => [...nav(html).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);
const optionValues = (html: string) => [...header(html).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
const hrefOf = (html: string, label: string) =>
  new RegExp(`<a [^>]*href="([^"]*)"[^>]*>${label}<`).exec(nav(html))?.[1] ?? null;

describe('route table', () => {
  const table: [string, RegExp][] = [
    ['/simulator', /class="spc-state/], // SimulatorV2 (loading state)
    ['/employee/emp-01', /<div class="ep">/], // EmployeeV2 (no <main> of its own, #584)
    ['/business/biz-01', /<div class="bp">/], // BusinessV2 (loading state; no <main> of its own, #581)
    ['/', /class="landing landing-nyc"/],
  ];
  it.each(table)('%s renders its MVP II page', (path, marker) => {
    const body = main(render(path))[2];
    expect(body).toMatch(marker);
    expect(body).not.toContain('Page not found');
  });
  it.each(['/unknown', '/business/biz-01/x', '/employees', '/help', '/help/'])('%s is a 404', (path) => {
    expect(main(render(path))[2]).toContain('Page not found');
  });
  // #724: the bare paths redirect to the header's account (tests/ui/kit-dom-shell-bare-paths.test.tsx).
  it.each(['/business', '/business/', '/employee', '/employee/'])('%s is not a 404', (path) => {
    expect(main(render(path))[2]).not.toContain('Page not found');
    expect(main(render(path, { status: 'loading' }, { status: 'loading' }))[2]).not.toContain('Page not found');
  });
  it('no MVP 1 page markup on the main paths', () => {
    expect(main(render('/simulator'))[2]).not.toMatch(/class="sp"/);
    expect(main(render('/employee/emp-01'))[2]).not.toContain('emp-portal');
    expect(main(render('/business/biz-01'))[2]).not.toContain('bp-main');
  });
});

describe('header on /simulator', () => {
  it('shows the three main links and no environment line (#854)', () => {
    const html = render('/simulator');
    expect(header(html)).not.toContain('shell-env');
    expect(html).not.toMatch(/simulated deliveries|Real NYC locations|Synthetic city/i);
    expect(hrefOf(html, 'Business')).toBe('/business/biz-01');
    expect(hrefOf(html, 'Employee')).toBe('/employee/emp-01');
    expect(hrefOf(html, 'Simulator')).toBe('/simulator');
    expect(nav(html)).not.toContain('/nyc');
    expect(current(html)).toEqual(['Simulator']);
    expect(header(html)).not.toContain('Demo account');
  });
  it('is full width; other pages keep the 960 px column', () => {
    expect(main(render('/simulator'))[1]).toBe('app-main app-main--full');
    expect(main(render('/simulator/'))[1]).toBe('app-main app-main--full');
    for (const p of ['/', '/employee/emp-01', '/business/biz-01']) {
      expect(main(render(p))[1]).toBe('app-main');
    }
    const css = readFileSync('client/src/styles/global.css', 'utf8');
    expect(css).toMatch(/\.app-main \{[^}]*max-width: 960px/);
    expect(css).toMatch(/\.app-main\.app-main--full \{[^}]*max-width: none/);
  });
  it('with a 503 the header renders, Employee is pending, no selector', () => {
    const html = render('/simulator', v2Down);
    expect(header(html)).toContain('class="shell-wordmark"');
    expect(nav(html)).toContain('href="/simulator"');
    expect(nav(html)).toMatch(/nav-pending" aria-disabled="true">Employee</);
    expect(header(html)).not.toContain('<select');
  });
});

describe('header on /employee/:id', () => {
  it('lists the v2 employees and selects the URL one', () => {
    const html = render('/employee/emp-02');
    expect(header(html)).toContain('Demo account');
    expect(optionValues(html)).toEqual(['emp-01', 'emp-02']);
    expect(header(html)).toMatch(/<option value="emp-02" selected="">Luis Ortega<\/option>/);
    expect(current(html)).toEqual(['Employee']);
    expect(header(html)).not.toContain('role="status"');
  });
  it('an unknown id falls back to the first v2 employee', () => {
    const html = render('/employee/emp-gone');
    expect(optionValues(html)).toEqual(['emp-01', 'emp-02']);
    expect(header(html)).toContain("isn&#x27;t in the current city");
    expect(header(html)).toMatch(/<a href="\/employee\/emp-01"[^>]*>Switch</);
  });
  it('with a 503 there is no selector and the page shows its own state', () => {
    const html = render('/employee/emp-01', v2Down);
    expect(header(html)).not.toContain('Demo account');
    expect(header(html)).not.toContain('role="alert"');
    expect(main(html)[2]).toContain('<div class="ep">');
  });
  it('a non-503 failure shows the accounts error, not a crash', () => {
    expect(header(render('/employee/emp-01', { status: 'error', message: 'boom' }))).toContain('Accounts unavailable');
  });
  it('while loading, the Employee link waits', () => {
    const html = render('/employee/emp-01', { status: 'loading' });
    expect(header(html)).toContain('Loading accounts');
    expect(nav(html)).toMatch(/nav-pending" aria-disabled="true">Employee</);
  });
});

describe('header on /business/:id', () => {
  it('lists the v2 businesses by name and selects the URL one', () => {
    const html = render('/business/biz-02?shipment=shp-1');
    expect(optionValues(html)).toEqual(['biz-01', 'biz-02']);
    expect(header(html)).toMatch(/<option value="biz-02" selected="">Hudson Print Co<\/option>/);
    expect(header(html)).not.toContain('Maya Chen');
    expect(current(html)).toEqual(['Business']);
  });
  it('an unknown id shows the stale note with a Switch link', () => {
    const html = render('/business/biz-gone');
    expect(header(html)).toContain('That business isn&#x27;t in the current city. Showing Brooklyn Roasters instead.');
    expect(header(html)).toMatch(/<a href="\/business\/biz-01"[^>]*>Switch</);
  });
  it.each([
    ['loading', { status: 'loading' } as V2BusinessDirectory],
    ['503', { status: 'unavailable' } as V2BusinessDirectory],
    ['error', { status: 'error', message: 'boom' } as V2BusinessDirectory],
  ])('while the business list is %s, Business stays not available', (_, biz) => {
    const n = nav(render('/simulator', v2Ready, biz));
    expect(n).toMatch(/<span class="shell-nav-link nav-pending" aria-disabled="true">Business<\/span>/);
    expect(n).toContain('href="/employee/emp-01"');
  });
  it('an empty business list keeps Business not available', () => {
    expect(nav(render('/simulator', v2Ready, { status: 'ready', businesses: [] }))).toMatch(/nav-pending" aria-disabled="true">Business</);
  });
});

describe('helpers', () => {
  it('cutoverPath strips /nyc and nothing else', () => {
    expect(cutoverPath('/nyc')).toBe('/');
    expect(cutoverPath('/nyc/')).toBe('/');
    expect(cutoverPath('/nyc/simulator')).toBe('/simulator');
    expect(cutoverPath('/nyc/business/biz-01')).toBe('/business/biz-01');
    expect(cutoverPath('/nyc/employee/a%20b')).toBe('/employee/a%20b');
    expect(cutoverPath('/nycx')).toBeNull();
    expect(cutoverPath('/simulator')).toBeNull();
    expect(isLegacyPreviewPath('/nyc/simulator')).toBe(true);
    expect(isLegacyPreviewPath('/nycx')).toBe(false);
  });
  it('workspaceHrefs uses the main paths only', () => {
    expect(workspaceHrefs('biz 1', 'emp 1')).toEqual({ business: '/business/biz%201', employee: '/employee/emp%201', simulator: '/simulator' });
    expect(workspaceHrefs(undefined, undefined)).toEqual({ business: null, employee: null, simulator: '/simulator' });
  });
  it('pickAccount keeps a stored ID in the list, else the first', () => {
    expect(pickAccount('b', ['a', 'b'])).toBe('b');
    expect(pickAccount('zz', ['a', 'b'])).toBe('a');
    expect(pickAccount(undefined, ['a'])).toBe('a');
    expect(pickAccount('a', [])).toBeUndefined();
    expect(pickAccount('a', undefined)).toBeUndefined();
  });
  it('the selector path keeps the workspace type and drops nothing but the id', () => {
    expect(switchIdentityPath('/business/biz-01/', 'b 2')).toEqual({ kind: 'business', path: '/business/b%202' });
    expect(switchIdentityPath('/employee/emp-01', 'emp-02')).toEqual({ kind: 'employee', path: '/employee/emp-02' });
    expect(switchIdentityPath('/simulator', 'x')).toBeNull();
    expect(activeDestination('/business/biz-01')).toBe('business');
    expect(isFullWidthPath('/nyc/simulator')).toBe(false);
  });
});

describe('v2 directory loaders', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it('ready: keeps id and name', async () => {
    const states: (V2Directory | V2BusinessDirectory)[] = [];
    startV2Directory(async () => ({ employees: v2Employees.map((e) => ({ ...e, businessId: 'biz-x' })) }), isTravelUnavailable, (d) => states.push(d));
    startV2BusinessDirectory(async () => ({ businesses: v2Businesses.map((b) => ({ ...b, hq: 'x' })) }), isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'ready', employees: v2Employees }, { status: 'ready', businesses: v2Businesses }]);
  });
  it('503 TravelUnavailable becomes "unavailable"; other failures an error', async () => {
    const states: V2Directory[] = [];
    const err = new ApiRequestError(503, 'NYC travel data is not loaded', undefined, 'http', 'travel_data_missing');
    expect(isTravelUnavailable(err)).toBe(true);
    startV2Directory(async () => { throw err; }, isTravelUnavailable, (d) => states.push(d));
    startV2Directory(async () => { throw new Error('down'); }, isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'unavailable' }, { status: 'error', message: 'down' }]);
  });
  it('cancel aborts the request and drops a late result', async () => {
    const states: V2Directory[] = [];
    let signal: AbortSignal | undefined;
    let resolve!: (v: { employees: typeof v2Employees }) => void;
    const cancel = startV2Directory(
      (opts) => { signal = opts.signal; return new Promise((r) => { resolve = r; }); },
      isTravelUnavailable, (d) => states.push(d),
    );
    cancel();
    expect(signal!.aborted).toBe(true);
    resolve({ employees: v2Employees });
    await flush();
    expect(states).toEqual([]);
  });
});

describe('App.tsx mounts no MVP 1 page and calls no MVP 1 route', () => {
  const app = readFileSync('client/src/App.tsx', 'utf8');
  it('imports nothing from the MVP 1 pages or the MVP 1 API helpers', () => {
    expect(app).not.toMatch(/pages\/(BusinessPortal|EmployeePortal|Simulator)'/);
    expect(app).not.toMatch(/from '\.\/api'/);
  });
});
