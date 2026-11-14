// #462, #475: MVP II preview routes (/nyc/simulator, /nyc/employee/:id, /nyc/business/:id) and the header on them.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { ApiRequestError, isTravelUnavailable } from '../../client/src/api/v2';
import {
  startV2BusinessDirectory, startV2Directory, switchPreviewBusinessPath, switchPreviewEmployeePath,
  type V2BusinessDirectory, type V2Directory,
} from '../../client/src/ui/shell';
import {
  ENV_LABELS, envIndicatorFor, isFullWidthPath, isPreviewPath, previewDestination, previewHrefs,
} from '../../client/src/ui/shellModel';
import { loadDefaultScenario } from '../../server/api/initialRun';

const { businesses, employees } = loadDefaultScenario();
const bid = businesses[0].id;
const eid = employees[0].id;
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

// No business list by default = the loading state (effects do not run in renderToStaticMarkup).
const render = (path: string, initialV2: V2Directory = v2Ready, initialV2Businesses?: V2BusinessDirectory) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initial={{ businesses, employees }} initialV2={initialV2} initialV2Businesses={initialV2Businesses} />
    </MemoryRouter>,
  );
const header = (html: string) => /<header class="shell-header">([\s\S]*?)<\/header>/.exec(html)![1];
const nav = (html: string) => /<nav aria-label="Workspaces" class="shell-nav">([\s\S]*?)<\/nav>/.exec(header(html))![1];
const main = (html: string) => /<main class="([^"]*)" id="main-content"[^>]*>([\s\S]*)<\/main>/.exec(html)!;
const current = (html: string) => [...nav(html).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);
const optionValues = (html: string) => [...header(html).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);

describe('route table', () => {
  const table: [string, RegExp][] = [
    ['/nyc/simulator', /class="spc-state/], // SimulatorV2 (loading state)
    ['/nyc/employee/emp-01', /<main class="ep">/], // EmployeeV2
    ['/nyc/business/biz-01', /<main class="bp">/], // BusinessV2 (loading state)
    ['/', /class="landing"/],
    [`/business/${bid}`, /class="bp-main"/],
    [`/employee/${eid}`, /class="emp-portal"/],
    ['/simulator', /class="sp"/],
    ['/help', /<h1[^>]*>[^<]*<\/h1>/],
  ];
  it.each(table)('%s renders its page', (path, marker) => {
    const body = main(render(path))[2];
    expect(body).toMatch(marker);
    expect(body).not.toContain('Page not found');
  });
  it.each(['/nyc/business', '/nyc/unknown', '/nyc/employee'])('%s is a 404', (path) => {
    expect(main(render(path))[2]).toContain('Page not found');
  });
  it('MVP 1 pages and v2 pages stay separate', () => {
    expect(main(render('/simulator'))[2]).not.toContain('spc-state');
    expect(main(render(`/employee/${eid}`))[2]).not.toContain('<main class="ep">');
    expect(main(render(`/business/${bid}`))[2]).not.toContain('<main class="bp">');
    expect(main(render('/nyc/business/biz-01'))[2]).not.toContain('bp-main');
  });
});

describe('header on /nyc/simulator', () => {
  it('shows the NYC indicator, preview links and a pending Business item', () => {
    const html = render('/nyc/simulator');
    expect(header(html)).toContain(`class="shell-env">${ENV_LABELS.nyc}<`);
    expect(html).not.toContain(ENV_LABELS.synthetic);
    const n = nav(html);
    expect(n).toContain('href="/nyc/simulator"');
    expect(n).toContain('href="/nyc/employee/emp-01"');
    expect(n).not.toContain('href="/business/');
    expect(n).not.toContain('href="/employee/');
    expect(n).not.toContain('href="/simulator"');
    expect(n).toMatch(/<span class="shell-nav-link nav-pending" aria-disabled="true">Business<\/span>/);
    expect(current(html)).toEqual(['Simulator']);
    expect(header(html)).not.toContain('Demo account');
  });
  it('is full width; other pages keep the 960 px column', () => {
    expect(main(render('/nyc/simulator'))[1]).toBe('app-main app-main--full');
    for (const p of ['/', '/simulator', '/nyc/employee/emp-01', `/employee/${eid}`, '/help']) {
      expect(main(render(p))[1]).toBe('app-main');
    }
    const css = readFileSync('client/src/styles/global.css', 'utf8');
    expect(css).toMatch(/\.app-main \{[^}]*max-width: 960px/);
    expect(css).toMatch(/\.app-main\.app-main--full \{[^}]*max-width: none/);
  });
  it('with a 503 the header renders, Employee is pending, no selector', () => {
    const html = render('/nyc/simulator', v2Down);
    expect(header(html)).toContain(ENV_LABELS.nyc);
    expect(nav(html)).toContain('href="/nyc/simulator"');
    expect(nav(html)).toMatch(/nav-pending" aria-disabled="true">Employee</);
    expect(header(html)).not.toContain('<select');
  });
});

describe('header on /nyc/employee/:id', () => {
  it('lists the v2 employees and selects the URL one', () => {
    const html = render('/nyc/employee/emp-02');
    expect(header(html)).toContain(ENV_LABELS.nyc);
    expect(header(html)).toContain('Demo account');
    expect(optionValues(html)).toEqual(['emp-01', 'emp-02']);
    expect(header(html)).toContain('Luis Ortega');
    expect(header(html)).not.toContain(employees[0].name);
    expect(current(html)).toEqual(['Employee']);
    expect(header(html)).not.toContain('role="status"');
  });
  it('an unknown id falls back to the first v2 employee inside the preview', () => {
    const html = render('/nyc/employee/emp-gone');
    expect(optionValues(html)).toEqual(['emp-01', 'emp-02']);
    expect(header(html)).toContain("isn&#x27;t in the current city");
    expect(header(html)).toMatch(/<a href="\/nyc\/employee\/emp-01"[^>]*>Switch</);
  });
  it('with a 503 there is no selector and the page shows its own state', () => {
    const html = render('/nyc/employee/emp-01', v2Down);
    expect(header(html)).not.toContain('Demo account');
    expect(header(html)).not.toContain('role="alert"');
    expect(header(html)).toContain(ENV_LABELS.nyc);
    expect(main(html)[2]).toContain('<main class="ep">');
  });
  it('a non-503 failure shows the accounts error, not a crash', () => {
    const html = render('/nyc/employee/emp-01', { status: 'error', message: 'boom' });
    expect(header(html)).toContain('Accounts unavailable');
  });
  it('while loading, the Employee link waits', () => {
    const html = render('/nyc/employee/emp-01', { status: 'loading' });
    expect(header(html)).toContain('Loading accounts');
    expect(nav(html)).toMatch(/nav-pending" aria-disabled="true">Employee</);
  });
});

describe('header on MVP 1 paths is unchanged', () => {
  it('/employee/:id keeps the synthetic label, MVP 1 links and the MVP 1 selector', () => {
    const html = render(`/employee/${eid}`);
    expect(header(html)).toContain(`class="shell-env">${ENV_LABELS.synthetic}<`);
    expect(html).not.toContain(ENV_LABELS.nyc);
    const n = nav(html);
    expect(n).toContain(`href="/business/${bid}"`);
    expect(n).toContain(`href="/employee/${eid}"`);
    expect(n).toContain('href="/simulator"');
    expect(n).not.toContain('/nyc/');
    expect(optionValues(html)).toEqual(employees.map((e) => e.id));
    expect(current(html)).toEqual(['Employee']);
  });
  it.each(['/', '/simulator', '/help', `/business/${bid}`])('%s keeps the synthetic label', (p) => {
    expect(header(render(p))).toContain(ENV_LABELS.synthetic);
  });
});

describe('preview helpers', () => {
  it('detect preview paths', () => {
    expect(isPreviewPath('/nyc')).toBe(true);
    expect(isPreviewPath('/nyc/simulator')).toBe(true);
    expect(isPreviewPath('/nycx')).toBe(false);
    expect(isPreviewPath('/simulator')).toBe(false);
    expect(envIndicatorFor('/nyc/employee/x')).toBe(ENV_LABELS.nyc);
    expect(envIndicatorFor('/employee/x')).toBe(ENV_LABELS.synthetic);
    expect(previewDestination('/nyc/simulator')).toBe('simulator');
    expect(previewDestination('/nyc/employee/a')).toBe('employee');
    expect(previewDestination('/simulator')).toBeNull();
    expect(isFullWidthPath('/nyc/simulator')).toBe(true);
    expect(isFullWidthPath('/simulator')).toBe(false);
  });
  it('preview hrefs never point at MVP 1 pages', () => {
    expect(previewHrefs('emp 1')).toEqual({ business: null, employee: '/nyc/employee/emp%201', simulator: '/nyc/simulator' });
    expect(previewHrefs(undefined).employee).toBeNull();
    expect(previewHrefs('e', 'biz 1')).toEqual({ business: '/nyc/business/biz%201', employee: '/nyc/employee/e', simulator: '/nyc/simulator' });
    expect(previewDestination('/nyc/business/biz-01')).toBe('business');
    expect(previewDestination('/business/biz-01')).toBeNull();
  });
  it('switching stays inside /nyc/employee/', () => {
    expect(switchPreviewEmployeePath('/nyc/employee/emp-01', 'emp-02')).toBe('/nyc/employee/emp-02');
    expect(switchPreviewEmployeePath('/employee/emp-01', 'emp-02')).toBeNull();
    expect(switchPreviewEmployeePath('/nyc/simulator', 'emp-02')).toBeNull();
    expect(switchPreviewEmployeePath('/nyc/employee/emp-01', '')).toBeNull();
  });
  it('switching stays inside /nyc/business/', () => {
    expect(switchPreviewBusinessPath('/nyc/business/biz-01', 'biz-02')).toBe('/nyc/business/biz-02');
    expect(switchPreviewBusinessPath('/nyc/business/biz-01/', 'b 2')).toBe('/nyc/business/b%202');
    expect(switchPreviewBusinessPath('/business/biz-01', 'biz-02')).toBeNull();
    expect(switchPreviewBusinessPath('/nyc/employee/emp-01', 'biz-02')).toBeNull();
    expect(switchPreviewBusinessPath('/nyc/business/biz-01', '')).toBeNull();
  });
});

describe('v2 directory loader', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it('ready: keeps id and name', async () => {
    const states: V2Directory[] = [];
    startV2Directory(async () => ({ employees: v2Employees.map((e) => ({ ...e, businessId: 'biz-x' })) }), isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'ready', employees: v2Employees }]);
  });
  it('503 TravelUnavailable becomes "unavailable"', async () => {
    const states: V2Directory[] = [];
    const err = new ApiRequestError(503, 'NYC travel data is not loaded', undefined, 'http', 'travel_data_missing');
    expect(isTravelUnavailable(err)).toBe(true);
    startV2Directory(async () => { throw err; }, isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'unavailable' }]);
  });
  it('other failures become an error', async () => {
    const states: V2Directory[] = [];
    startV2Directory(async () => { throw new Error('down'); }, isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'error', message: 'down' }]);
  });
  it('cancel aborts the request and drops a late result', async () => {
    const states: V2Directory[] = [];
    let signal: AbortSignal | undefined;
    let resolve!: (v: { employees: typeof v2Employees }) => void;
    const cancel = startV2Directory(
      (opts) => { signal = opts.signal; return new Promise((r) => { resolve = r; }); },
      isTravelUnavailable, (d) => states.push(d),
    );
    expect(signal!.aborted).toBe(false);
    cancel();
    expect(signal!.aborted).toBe(true);
    resolve({ employees: v2Employees });
    await flush();
    expect(states).toEqual([]);
  });
  it('App only loads the v2 directory on preview paths', () => {
    const app = readFileSync('client/src/App.tsx', 'utf8');
    expect(app).toMatch(/if \(initial \|\| !preview\) return;/);
    expect(app).toMatch(/return startV2Directory\(/);
  });
  it('the preview selector never writes the stored identity', () => {
    const app = readFileSync('client/src/App.tsx', 'utf8');
    const body = app.slice(app.indexOf('function PreviewAccountSelector'), app.indexOf('function DemoAccountSelector'));
    expect(body).not.toContain('writeIdentity');
  });
});

// #475: the Business preview page and the finished preview header.
const hrefOf = (html: string, label: string) =>
  new RegExp(`<a [^>]*href="([^"]*)"[^>]*>${label}<`).exec(nav(html))?.[1] ?? null;

describe('three header links on each preview page', () => {
  it.each([
    ['/nyc/simulator', 'Simulator'],
    ['/nyc/employee/emp-02', 'Employee'],
    ['/nyc/business/biz-02', 'Business'],
  ])('%s links to all three preview pages and marks %s', (path, active) => {
    const html = render(path, v2Ready, v2BizReady);
    expect(hrefOf(html, 'Business')).toBe('/nyc/business/biz-01');
    expect(hrefOf(html, 'Employee')).toBe('/nyc/employee/emp-01');
    expect(hrefOf(html, 'Simulator')).toBe('/nyc/simulator');
    expect(nav(html)).not.toContain('nav-pending');
    expect(current(html)).toEqual([active]);
    expect(header(html)).toContain(`class="shell-env">${ENV_LABELS.nyc}<`);
    expect(html).not.toContain(ENV_LABELS.synthetic);
  });
  it.each([
    ['loading', { status: 'loading' } as V2BusinessDirectory],
    ['503', { status: 'unavailable' } as V2BusinessDirectory],
    ['error', { status: 'error', message: 'boom' } as V2BusinessDirectory],
  ])('while the business list is %s, Business stays not available', (_, biz) => {
    for (const p of ['/nyc/simulator', '/nyc/employee/emp-01']) {
      const n = nav(render(p, v2Ready, biz));
      expect(n).toMatch(/<span class="shell-nav-link nav-pending" aria-disabled="true">Business<\/span>/);
      expect(n).toContain('href="/nyc/employee/emp-01"');
    }
  });
  it('an empty business list keeps Business not available', () => {
    expect(nav(render('/nyc/simulator', v2Ready, { status: 'ready', businesses: [] }))).toMatch(/nav-pending" aria-disabled="true">Business</);
  });
});

describe('header on /nyc/business/:id', () => {
  it('renders BusinessV2 inside the shell with the 960 px column', () => {
    const html = render('/nyc/business/biz-01', v2Ready, v2BizReady);
    expect(main(html)[1]).toBe('app-main');
    expect(main(html)[2]).toMatch(/<main class="bp">/);
    expect(main(html)[2]).not.toContain('Page not found');
  });
  it('lists the v2 businesses by name and selects the URL one', () => {
    const html = render('/nyc/business/biz-02?shipment=shp-1', v2Ready, v2BizReady);
    expect(header(html)).toContain('Demo account');
    expect(optionValues(html)).toEqual(['biz-01', 'biz-02']);
    expect(header(html)).toContain('>Brooklyn Roasters</option>');
    expect(header(html)).toMatch(/<option value="biz-02" selected="">Hudson Print Co<\/option>/);
    expect(header(html)).not.toContain(businesses[0].name);
    expect(header(html)).not.toContain('Maya Chen');
    expect(header(html)).not.toContain('role="status"');
  });
  it('an unknown id shows the stale note with a Switch link inside the preview', () => {
    const html = render('/nyc/business/biz-gone', v2Ready, v2BizReady);
    expect(optionValues(html)).toEqual(['biz-01', 'biz-02']);
    expect(header(html)).toContain('That business isn&#x27;t in the current city. Showing Brooklyn Roasters instead.');
    expect(header(html)).toMatch(/<a href="\/nyc\/business\/biz-01"[^>]*>Switch</);
  });
  it('an MVP 1 business id is stale on the preview (never mixed with v2 ids)', () => {
    const html = render(`/nyc/business/${bid}`, v2Ready, v2BizReady);
    expect(header(html)).toContain('role="status"');
    expect(optionValues(html)).toEqual(['biz-01', 'biz-02']);
  });
  it('with a 503 there is no selector, Business is not available and the page shows its own state', () => {
    const html = render('/nyc/business/biz-01', v2Ready, { status: 'unavailable' });
    expect(header(html)).not.toContain('Demo account');
    expect(header(html)).not.toContain('role="alert"');
    expect(nav(html)).toMatch(/nav-pending" aria-disabled="true">Business</);
    expect(header(html)).toContain(ENV_LABELS.nyc);
    expect(main(html)[2]).toContain('<main class="bp">');
  });
  it('while loading, the selector says so', () => {
    const html = render('/nyc/business/biz-01', v2Ready, { status: 'loading' });
    expect(header(html)).toContain('Loading accounts');
    expect(header(html)).not.toContain('<select');
  });
  it('a non-503 failure shows the accounts error', () => {
    expect(header(render('/nyc/business/biz-01', v2Ready, { status: 'error', message: 'boom' }))).toContain('Accounts unavailable');
  });
  it('the employee list does not leak into the business selector (and vice versa)', () => {
    const emp = render('/nyc/employee/emp-01', v2Ready, v2BizReady);
    expect(optionValues(emp)).toEqual(['emp-01', 'emp-02']);
    const biz = render('/nyc/business/biz-01', v2Down, v2BizReady);
    expect(optionValues(biz)).toEqual(['biz-01', 'biz-02']);
  });
});

describe('v2 business loader', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it('ready: keeps id and name', async () => {
    const states: V2BusinessDirectory[] = [];
    startV2BusinessDirectory(async () => ({ businesses: v2Businesses.map((b) => ({ ...b, hq: 'x' })) }), isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'ready', businesses: v2Businesses }]);
  });
  it('503 TravelUnavailable becomes "unavailable"; other failures an error', async () => {
    const states: V2BusinessDirectory[] = [];
    const err = new ApiRequestError(503, 'NYC travel data is not loaded', undefined, 'http', 'travel_data_missing');
    startV2BusinessDirectory(async () => { throw err; }, isTravelUnavailable, (d) => states.push(d));
    startV2BusinessDirectory(async () => { throw new Error('down'); }, isTravelUnavailable, (d) => states.push(d));
    await flush();
    expect(states).toEqual([{ status: 'unavailable' }, { status: 'error', message: 'down' }]);
  });
  it('cancel aborts the request and drops a late result', async () => {
    const states: V2BusinessDirectory[] = [];
    let signal: AbortSignal | undefined;
    let resolve!: (v: { businesses: typeof v2Businesses }) => void;
    const cancel = startV2BusinessDirectory(
      (opts) => { signal = opts.signal; return new Promise((r) => { resolve = r; }); },
      isTravelUnavailable, (d) => states.push(d),
    );
    cancel();
    expect(signal!.aborted).toBe(true);
    resolve({ businesses: v2Businesses });
    await flush();
    expect(states).toEqual([]);
  });
});

describe('no MVP 1 path requests /api/v2', () => {
  const app = readFileSync('client/src/App.tsx', 'utf8');
  it('both v2 lists load only on /nyc/… and are cancelled when the header leaves', () => {
    expect(app.match(/if \(initial \|\| !preview\) return;/g)).toHaveLength(2);
    expect(app).toMatch(/return startV2BusinessDirectory\(getV2Businesses,/);
    expect(app).toMatch(/return startV2Directory\(getV2Employees,/);
    expect(app).toMatch(/const preview = isPreviewPath\(pathname\);/);
    // The v2 helpers are not called anywhere else in App.tsx.
    expect(app.match(/getV2Businesses|getV2Employees/g)).toHaveLength(4); // 2 imports + 2 calls
  });
  it.each(['/', '/help', '/simulator', `/business/${bid}`, `/employee/${eid}`, '/nycx', '/unknown'])(
    '%s is not a preview path', (p) => { expect(isPreviewPath(p)).toBe(false); },
  );
  it('MVP 1 pages render with no v2 data and show no v2 names', () => {
    for (const p of ['/', '/simulator', `/business/${bid}`, `/employee/${eid}`, '/help']) {
      const html = render(p, v2Ready, v2BizReady);
      expect(header(html)).not.toContain('Brooklyn Roasters');
      expect(header(html)).not.toContain('Maya Chen');
      expect(nav(html)).not.toContain('/nyc/');
    }
  });
  it('the preview selector never writes the stored identity', () => {
    const body = app.slice(app.indexOf('function PreviewAccountSelector'), app.indexOf('function DemoAccountSelector'));
    expect(body).toContain("matchPath('/nyc/business/:id'");
    expect(body).not.toContain('writeIdentity');
  });
});
