// @vitest-environment jsdom
// #529, #548: the header in a real DOM. Since the cutover the account selectors on /business/:id and
// /employee/:id take their lists from a fake /api/v2 and store the choice as the demo identity; a stored ID
// that is not in the NYC lists falls back to the first account. Keyboard order and aria-current (pass 55).
// The pages are stand-ins.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEY, readIdentity } from '../../client/src/demoIdentity';
import { ENV_LABELS, staleNote } from '../../client/src/ui/shellModel';
import { fakeApi, renderShell } from './kit-dom-shell-helper';
import { click, flush, link, select, tabOrder, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', page('Landing'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

const T = 10_000;
let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const optionTexts = (el: HTMLSelectElement) => [...el.options].map((o) => o.text);
const status = (header: HTMLElement) => header.querySelector('.demo-account-status[role="status"]');
const MVP1_ROUTE = /^\/api\/(businesses|employees|simulator|map)(\/|\?|$)/;

describe('account selector on /employee/<id>', () => {
  it('lists the /api/v2 employees, moves to the chosen one and stores it', async () => {
    const s = await renderShell('/employee/emp-01?job=job-1');
    expect(api.calls).toContain('/api/v2/employees');
    const sel = s.selector()!;
    expect(optionTexts(sel)).toEqual(['Maya Chen', 'Luis Ortega']);
    expect(sel.value).toBe('emp-01');
    select(sel, 'Luis Ortega');
    expect(s.where).toEqual({ path: '/employee/emp-02', search: '' });
    expect(s.selector()!.value).toBe('emp-02');
    expect(textOf(s.main())).toBe('EmployeeV2 at /employee/emp-02');
    expect(readIdentity()).toEqual({ employeeId: 'emp-02' });
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-02');
  }, T);

  it('an unknown ID shows the stale-ID note; Switch stores the first employee', async () => {
    const s = await renderShell('/employee/emp-99');
    expect(s.selector()!.value).toBe('emp-01');
    const note = status(s.header())!;
    expect(textOf(note)).toContain(staleNote('employee', 'Maya Chen'));
    click(link(note, 'Switch'));
    expect(s.where.path).toBe('/employee/emp-01');
    expect(status(s.header())).toBeNull();
    expect(readIdentity().employeeId).toBe('emp-01');
  }, T);
});

describe('account selector on /business/<id>', () => {
  it('moves to the chosen business, drops ?shipment= and stores it next to the employee', async () => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ employeeId: 'emp-02' }));
    const s = await renderShell('/business/biz-01?shipment=shp-7');
    expect(api.calls).toContain('/api/v2/businesses');
    const sel = s.selector()!;
    expect(optionTexts(sel)).toEqual(['Brooklyn Roasters', 'Hudson Print Co']);
    select(sel, 'Hudson Print Co');
    expect(s.where).toEqual({ path: '/business/biz-02', search: '' });
    expect(textOf(s.main())).toBe('BusinessV2 at /business/biz-02');
    expect(readIdentity()).toEqual({ employeeId: 'emp-02', businessId: 'biz-02' });
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/business/biz-02');
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-02');
  }, T);

  it('Switch on a stale ID stores it and adds one history entry, so Back returns to the stale URL', async () => {
    const s = await renderShell('/business/biz-gone?shipment=shp-7', ['/']);
    const note = status(s.header())!;
    expect(textOf(note)).toContain(staleNote('business', 'Brooklyn Roasters'));
    click(link(note, 'Switch'));
    expect(s.where).toEqual({ path: '/business/biz-01', search: '' });
    expect(readIdentity().businessId).toBe('biz-01');
    s.back();
    expect(s.where.path).toBe('/business/biz-gone');
  }, T);
});

describe('workspace links use the stored identity', () => {
  it('a stored ID in the NYC lists is used on every path', async () => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ businessId: 'biz-02', employeeId: 'emp-02' }));
    const s = await renderShell('/simulator');
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/business/biz-02');
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-02');
    expect(link(s.header(), 'Simulator').getAttribute('href')).toBe('/simulator');
  }, T);

  it('a stored ID that is not in the NYC lists (an MVP 1 ID) falls back to the first account', async () => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ businessId: 'biz-sunrise', employeeId: 'emp-001' }));
    const s = await renderShell('/');
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/business/biz-01');
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-01');
    click(link(s.header(), 'Employee'));
    expect(s.where.path).toBe('/employee/emp-01');
    expect(s.selector()!.value).toBe('emp-01');
  }, T);

  it('the header never calls an MVP 1 route', async () => {
    for (const p of ['/', '/simulator', '/business/biz-01', '/employee/emp-01', '/nowhere']) {
      const s = await renderShell(p);
      // The environment line is on every page but the homepage (#833).
      expect(textOf(s.header()).includes(ENV_LABELS.nyc), p).toBe(p !== '/');
      s.unmount();
    }
    expect(api.calls.filter((u) => MVP1_ROUTE.test(u))).toEqual([]);
    expect(api.calls).toContain('/api/v2/simulator'); // the runId poll that reloads the lists
  }, T);
});

describe('keyboard order and current page', () => {
  /** Header part of the Tab order: label for each stop. */
  const headerStops = (header: HTMLElement) =>
    tabOrder(header).map((el) => (el instanceof HTMLSelectElement ? 'select' : textOf(el)));

  it('on /employee/<id>: skip link, brand, three destinations, selector, then the page', async () => {
    const s = await renderShell('/employee/emp-01');
    const all = tabOrder(document.body);
    expect(all[0].className).toBe('skip-link');
    expect(all[1]).toBe(link(s.header(), 'Relay'));
    expect(headerStops(s.header())).toEqual(['Relay', 'Business', 'Employee', 'Simulator', 'select']);
    // Each stop really takes focus (nothing is hidden from the keyboard).
    for (const el of tabOrder(s.header())) {
      el.focus();
      expect(document.activeElement).toBe(el);
    }
    const current = [...s.header().querySelectorAll('[aria-current="page"]')].map((el) => textOf(el));
    expect(current).toEqual(['Employee']);
    expect(link(s.header(), 'Relay').getAttribute('href')).toBe('/');
  }, T);

  it('a stale note adds its Switch link after the selector', async () => {
    const s = await renderShell('/business/biz-gone');
    expect(headerStops(s.header())).toEqual(['Relay', 'Business', 'Employee', 'Simulator', 'select', 'Switch']);
    const current = [...s.header().querySelectorAll('[aria-current="page"]')].map((el) => textOf(el));
    expect(current).toEqual(['Business']);
  }, T);

  it('brand goes to / by click; the header has no Help link (#623)', async () => {
    const s = await renderShell('/simulator');
    expect(headerStops(s.header())).toEqual(['Relay', 'Business', 'Employee', 'Simulator']);
    expect(s.header().querySelector('a[href="/help"], .shell-help')).toBeNull();
    expect(s.header().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    click(link(s.header(), 'Relay'));
    expect(s.where.path).toBe('/');
    expect(s.header().querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(textOf(s.main())).toBe('Landing at /');
  }, T);

  it('the skip link moves focus to the main region', async () => {
    const s = await renderShell('/simulator');
    const skip = document.querySelector('a.skip-link') as HTMLAnchorElement;
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(s.main().tabIndex).toBe(-1);
    s.main().focus();
    expect(document.activeElement).toBe(s.main());
    await flush();
  }, T);
});
