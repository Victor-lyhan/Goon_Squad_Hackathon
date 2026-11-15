// @vitest-environment jsdom
// #623: opening /business/<id> or /employee/<id> counts as choosing that account (DECISIONS pass 62). The header
// link of that kind points to it and the header stores it as the demo identity, so the links still point to it
// on /simulator and /. A stale ID is never stored. The Help page is deleted: /help is the 404 page.
// The real AppShell and header in a real DOM, against a fake /api/v2; the pages are stand-ins.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../client/src/App';
import { IDENTITY_KEY, readIdentity } from '../../client/src/demoIdentity';
import { openAccount, staleNote, withOpenAccount } from '../../client/src/ui/shellModel';
import { fakeApi, renderShell, type FakeList } from './kit-dom-shell-helper';
import { click, deferred, flush, link, mount, select, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', page('Landing'));
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
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const api = (lists: { employees?: FakeList; businesses?: FakeList } = {}) =>
  fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES, ...lists });

const hrefOf = (header: HTMLElement, label: string) => link(header, label).getAttribute('href');
/** The header link of a list that is not loaded is plain text, not a link. */
const pending = (header: HTMLElement, label: string) =>
  [...header.querySelectorAll('span.nav-pending')].some((el) => textOf(el) === label);
const store = (identity: object) => localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

let writes: ReturnType<typeof vi.spyOn>;
/** Every write of the demo identity since the test started. */
const identityWrites = () => (writes.mock.calls as unknown[][])
  .filter(([key]) => key === IDENTITY_KEY).map(([, value]) => JSON.parse(value as string) as unknown);

beforeEach(() => {
  localStorage.clear();
  writes = vi.spyOn(Storage.prototype, 'setItem');
});
afterEach(() => {
  writes.mockRestore();
  vi.unstubAllGlobals();
});

describe('opening an account page stores it and the header follows it', () => {
  it('/business/biz-02 with empty storage: the Business link and the stored business are biz-02, also on /simulator and /', async () => {
    api();
    const s = await renderShell('/business/biz-02');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-02');
    expect(link(s.header(), 'Business').getAttribute('aria-current')).toBe('page');
    expect(readIdentity().businessId).toBe('biz-02');
    // The identity only: one key, and no employee was chosen.
    expect(readIdentity()).toEqual({ businessId: 'biz-02' });
    expect(Object.keys(localStorage)).toEqual([IDENTITY_KEY]);
    expect(hrefOf(s.header(), 'Employee')).toBe('/employee/emp-01');

    click(link(s.header(), 'Simulator'));
    expect(s.where.path).toBe('/simulator');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-02');
    click(link(s.header(), 'Relay'));
    expect(s.where.path).toBe('/');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-02');
    expect(readIdentity()).toEqual({ businessId: 'biz-02' });
    // And the link opens that business.
    click(link(s.header(), 'Business'));
    expect(textOf(s.main())).toBe('BusinessV2 at /business/biz-02');
    expect(s.selector()!.value).toBe('biz-02');
  }, T);

  it('/employee/emp-03 keeps the stored business; /business/biz-03 then keeps that employee', async () => {
    api();
    store({ businessId: 'biz-02', employeeId: 'emp-02' });
    const s = await renderShell('/employee/emp-03?job=job-1');
    expect(hrefOf(s.header(), 'Employee')).toBe('/employee/emp-03');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-02');
    expect(readIdentity()).toEqual({ businessId: 'biz-02', employeeId: 'emp-03' });
    expect(s.where).toEqual({ path: '/employee/emp-03', search: '?job=job-1' }); // storing never navigates

    click(link(s.header(), 'Business'));
    select(s.selector()!, 'Titan Foods');
    expect(s.where.path).toBe('/business/biz-03');
    expect(readIdentity()).toEqual({ businessId: 'biz-03', employeeId: 'emp-03' });
    click(link(s.header(), 'Simulator'));
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-03');
    expect(hrefOf(s.header(), 'Employee')).toBe('/employee/emp-03');
  }, T);

  it('a link inside the app (a carrier name) counts too: demo step 4 opens the carrier, not the first employee', async () => {
    api();
    const m = mount(
      <MemoryRouter initialEntries={['/business/biz-01?shipment=shp-1']}>
        <AppShell />
        <Link to="/employee/emp-02">carrier</Link>
      </MemoryRouter>,
    );
    await flush();
    await flush();
    const header = () => m.container.querySelector('header.shell-header') as HTMLElement;
    expect(readIdentity()).toEqual({ businessId: 'biz-01' });
    click(link(m.container, 'carrier'));
    expect(textOf(m.container.querySelector('main')!)).toBe('EmployeeV2 at /employee/emp-02');
    expect(hrefOf(header(), 'Employee')).toBe('/employee/emp-02');
    expect(readIdentity()).toEqual({ businessId: 'biz-01', employeeId: 'emp-02' });
    click(link(header(), 'Simulator'));
    expect(hrefOf(header(), 'Employee')).toBe('/employee/emp-02');
    expect(hrefOf(header(), 'Business')).toBe('/business/biz-01');
  }, T);

  it('a trailing slash and an encoded ID are the same account', async () => {
    api({ businesses: [...BUSINESSES, { id: 'biz x', name: 'Spaced Out' }] });
    const s = await renderShell('/business/biz%20x/');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz%20x');
    expect(readIdentity()).toEqual({ businessId: 'biz x' });
  }, T);
});

describe('what is never stored', () => {
  it('/business/biz-gone stores nothing; the stale note and Switch work as before', async () => {
    api();
    const s = await renderShell('/business/biz-gone');
    expect(readIdentity()).toEqual({});
    expect(localStorage.getItem(IDENTITY_KEY)).toBeNull();
    expect(identityWrites()).toEqual([]);
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-01');
    const note = s.header().querySelector('.demo-account-status[role="status"]')!;
    expect(textOf(note)).toContain(staleNote('business', 'Brooklyn Roasters'));
    expect(s.where.path).toBe('/business/biz-gone'); // no silent redirect (pass 9)
    click(link(note, 'Switch'));
    expect(s.where.path).toBe('/business/biz-01');
    expect(readIdentity()).toEqual({ businessId: 'biz-01' });
    expect(identityWrites()).toEqual([{ businessId: 'biz-01' }]);
  }, T);

  it('a stale link leaves a stored account alone, and the header link keeps pointing to it', async () => {
    api();
    store({ businessId: 'biz-03', employeeId: 'emp-02' });
    writes.mockClear();
    const s = await renderShell('/employee/emp-gone');
    expect(readIdentity()).toEqual({ businessId: 'biz-03', employeeId: 'emp-02' });
    expect(identityWrites()).toEqual([]);
    expect(hrefOf(s.header(), 'Employee')).toBe('/employee/emp-02');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-03');
  }, T);

  it('nothing is stored while the list is loading; it is stored when the list arrives', async () => {
    const wait = deferred<Response>();
    api({ businesses: () => wait.promise });
    const s = await renderShell('/business/biz-02');
    expect(pending(s.header(), 'Business')).toBe(true);
    expect(readIdentity()).toEqual({});
    expect(identityWrites()).toEqual([]);
    wait.resolve(json(200, { businesses: BUSINESSES }));
    await flush();
    await flush();
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-02');
    expect(readIdentity()).toEqual({ businessId: 'biz-02' });
  }, T);

  it('nothing is stored when the list failed or answered 503', async () => {
    const answers = [
      () => json(500, { error: 'boom' }),
      () => json(503, { error: 'NYC travel data is not loaded', code: 'travel_data_missing' }),
    ];
    for (const employees of answers) {
      api({ employees });
      const s = await renderShell('/employee/emp-02');
      expect(pending(s.header(), 'Employee')).toBe(true);
      expect(readIdentity()).toEqual({});
      expect(identityWrites()).toEqual([]);
      // The other list is ready, but /employee/<id> is not a business page.
      expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-01');
      s.unmount();
    }
  }, T);

  it('pages that are not an account page store nothing', async () => {
    api();
    // Not the bare /business: it redirects to the account page (#724, kit-dom-shell-bare-paths.test.tsx).
    for (const p of ['/', '/simulator', '/business/biz-02/extra', '/nowhere']) {
      const s = await renderShell(p);
      expect(hrefOf(s.header(), 'Business'), p).toBe('/business/biz-01');
      s.unmount();
    }
    expect(identityWrites()).toEqual([]);
  }, T);
});

describe('stored in an effect, and only when it changes', () => {
  it('one write for one opened account, none for later pages', async () => {
    api();
    const s = await renderShell('/business/biz-02');
    expect(identityWrites()).toEqual([{ businessId: 'biz-02' }]);
    click(link(s.header(), 'Simulator'));
    click(link(s.header(), 'Relay'));
    click(link(s.header(), 'Business'));
    expect(s.where.path).toBe('/business/biz-02');
    await flush();
    expect(identityWrites()).toEqual([{ businessId: 'biz-02' }]);
  }, T);

  it('an account that is already the stored one is not written again', async () => {
    api();
    store({ businessId: 'biz-02', employeeId: 'emp-03' });
    writes.mockClear();
    const s = await renderShell('/business/biz-02');
    expect(hrefOf(s.header(), 'Business')).toBe('/business/biz-02');
    click(link(s.header(), 'Employee'));
    expect(s.where.path).toBe('/employee/emp-03');
    await flush();
    expect(identityWrites()).toEqual([]);
  }, T);

  it('the selector still writes once, not once more from the effect', async () => {
    api();
    const s = await renderShell('/business/biz-01');
    writes.mockClear();
    select(s.selector()!, 'Hudson Print Co');
    await flush();
    expect(s.where.path).toBe('/business/biz-02');
    expect(identityWrites()).toEqual([{ businessId: 'biz-02' }]);
  }, T);

  it('rendering alone writes nothing: the link is right in server markup, the storage is untouched', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/business/biz-02']}>
        <AppShell initialV2={{ status: 'ready', employees: EMPLOYEES }} initialV2Businesses={{ status: 'ready', businesses: BUSINESSES }} />
      </MemoryRouter>,
    );
    const nav = /<nav aria-label="Workspaces"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1];
    expect(nav).toMatch(/<a [^>]*href="\/business\/biz-02"[^>]*>Business</);
    expect(writes).not.toHaveBeenCalled();
    expect(readIdentity()).toEqual({});
    expect(readFileSync('client/src/App.tsx', 'utf8').match(/writeIdentity\(/g)).toHaveLength(2); // choose() and the effect
  });
});

describe('openAccount and withOpenAccount', () => {
  const b = ['biz-01', 'biz-02'];
  const e = ['emp-01', 'emp 2'];

  it('finds the account of an account path that is in its list', () => {
    expect(openAccount('/business/biz-02', b, e)).toEqual({ key: 'businessId', id: 'biz-02' });
    expect(openAccount('/employee/emp-01/', b, e)).toEqual({ key: 'employeeId', id: 'emp-01' });
    expect(openAccount('/employee/emp%202', b, e)).toEqual({ key: 'employeeId', id: 'emp 2' });
    expect(openAccount('/Business/biz-01', b, e)).toEqual({ key: 'businessId', id: 'biz-01' }); // as the router matches
  });
  it('is null for a stale ID, a list that is not loaded, and any other path', () => {
    expect(openAccount('/business/biz-gone', b, e)).toBeNull();
    expect(openAccount('/business/emp-01', b, e)).toBeNull(); // an employee ID is not a business
    expect(openAccount('/business/biz-02', undefined, e)).toBeNull();
    expect(openAccount('/employee/emp-01', b, undefined)).toBeNull();
    expect(openAccount('/business/biz-02', [], e)).toBeNull();
    expect(openAccount('/business/%E0%A4%A', b, e)).toBeNull(); // a malformed escape does not throw
    for (const p of ['/', '/simulator', '/business', '/business/', '/business/biz-02/x', '/nyc/business/biz-02', '/help']) {
      expect(openAccount(p, b, e), p).toBeNull();
    }
  });
  it('withOpenAccount sets one field and returns the same object when nothing changes', () => {
    const stored = { businessId: 'biz-01', employeeId: 'emp-01' };
    expect(withOpenAccount(stored, { key: 'businessId', id: 'biz-02' })).toEqual({ businessId: 'biz-02', employeeId: 'emp-01' });
    expect(withOpenAccount({}, { key: 'employeeId', id: 'emp-01' })).toEqual({ employeeId: 'emp-01' });
    expect(withOpenAccount(stored, { key: 'businessId', id: 'biz-01' })).toBe(stored);
    expect(withOpenAccount(stored, null)).toBe(stored);
    expect(stored).toEqual({ businessId: 'biz-01', employeeId: 'emp-01' }); // not mutated
  });
});

describe('the Help page is deleted', () => {
  it('/help renders the Not found page, and the header has no Help link', async () => {
    api();
    for (const p of ['/help', '/help/']) {
      const s = await renderShell(p);
      expect(textOf(s.main().querySelector('h1')!), p).toBe('Page not found');
      expect(s.main().querySelector('.not-found'), p).not.toBeNull();
      expect(s.container.querySelector('a[href="/help"]'), p).toBeNull();
      expect(textOf(s.container), p).not.toMatch(/Guided demo|\bHelp\b/);
      expect(s.header().querySelectorAll('[aria-current="page"]'), p).toHaveLength(0);
      // Since #886 the 404 page has one action, to the homepage; the header has the other places.
      expect([...s.main().querySelectorAll('a, button')].map((a) => a.getAttribute('href')), p).toEqual(['/']);
      expect(['Business', 'Employee', 'Simulator'].map((name) => link(s.header(), name).getAttribute('href')), p)
        .toEqual(['/business/biz-01', '/employee/emp-01', '/simulator']);
      s.unmount();
    }
  }, T);

  it('its files are gone and nothing in the client or the tests imports them', () => {
    expect(existsSync('client/src/pages/Help.tsx')).toBe(false);
    expect(existsSync('client/src/styles/help.css')).toBe(false);
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const path = join(dir, f);
      return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(f) ? [path] : [];
    });
    const imports = /(?:from|import|mock)\(?\s*['"][^'"]*(?:pages\/Help|\/Help|styles\/help\.css|help\.css)['"]/;
    for (const f of [...files('client/src'), ...files('tests')]) {
      expect(imports.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
    const guided = files('client/src').filter((f) => readFileSync(f, 'utf8').includes('Guided demo'));
    // The homepage's link is removed by the homepage issue (docs/mvp3.md P4).
    expect(guided.filter((f) => f !== join('client/src/pages', 'Landing.tsx'))).toEqual([]);
    const model = readFileSync('client/src/ui/shellModel.ts', 'utf8');
    expect(model).not.toMatch(/HELP_PAGE_PATH|isHelpPath/);
    expect(readFileSync('client/src/App.tsx', 'utf8')).not.toMatch(/path="\/help"|>Help</);
  });
});
