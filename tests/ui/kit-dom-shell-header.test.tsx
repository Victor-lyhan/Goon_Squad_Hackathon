// @vitest-environment jsdom
// #529: the header in a real DOM. On /nyc/... the account selectors take their lists from a fake /api/v2,
// move inside the preview and never write the stored demo identity (DECISIONS pass 52); on MVP 1 paths
// the selector still writes it. Keyboard order and aria-current (pass 55). The pages are stand-ins.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEY, readIdentity } from '../../client/src/demoIdentity';
import { staleNote } from '../../client/src/ui/shellModel';
import { fakeApi, MVP1, renderShell } from './kit-dom-shell-helper';
import { click, flush, link, select, tabOrder, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', async () => ({ ...(await page('Landing')()), SIMULATOR_PATH: '/simulator' }));
vi.mock('../../client/src/pages/Help', page('Help'));
vi.mock('../../client/src/pages/BusinessPortal', page('BusinessPortal'));
vi.mock('../../client/src/pages/EmployeePortal', page('EmployeePortal'));
vi.mock('../../client/src/pages/Simulator', page('Simulator'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

const T = 10_000;
const STORED = JSON.stringify({ businessId: MVP1.businesses[0].id, employeeId: MVP1.employees[0].id });
let api: ReturnType<typeof fakeApi>;
let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  api = fakeApi();
  localStorage.clear();
  localStorage.setItem(IDENTITY_KEY, STORED);
  setItem = vi.spyOn(Storage.prototype, 'setItem');
});
afterEach(() => {
  setItem.mockRestore();
  vi.unstubAllGlobals();
});

const optionTexts = (el: HTMLSelectElement) => [...el.options].map((o) => o.text);
const status = (header: HTMLElement) => header.querySelector('.demo-account-status[role="status"]');

describe('account selector on /nyc/employee/<id>', () => {
  it('lists the /api/v2 employees and moves to the chosen one inside the preview', async () => {
    const s = await renderShell('/nyc/employee/emp-01');
    expect(api.calls).toContain('/api/v2/employees');
    const sel = s.selector()!;
    expect(optionTexts(sel)).toEqual(['Maya Chen', 'Luis Ortega']);
    expect(sel.value).toBe('emp-01');
    select(sel, 'Luis Ortega');
    expect(s.where).toEqual({ path: '/nyc/employee/emp-02', search: '' });
    expect(s.selector()!.value).toBe('emp-02');
    expect(textOf(s.main())).toBe('EmployeeV2 at /nyc/employee/emp-02');
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(IDENTITY_KEY)).toBe(STORED);
  }, T);

  it('an unknown ID shows the stale-ID note with a Switch link that stays in the preview', async () => {
    const s = await renderShell('/nyc/employee/emp-99');
    expect(s.selector()!.value).toBe('emp-01');
    const note = status(s.header())!;
    expect(textOf(note)).toContain(staleNote('employee', 'Maya Chen'));
    click(link(note, 'Switch'));
    expect(s.where.path).toBe('/nyc/employee/emp-01');
    expect(status(s.header())).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  }, T);
});

describe('account selector on /nyc/business/<id>', () => {
  it('moves to the chosen business, drops ?shipment= and never stores the identity', async () => {
    const s = await renderShell('/nyc/business/biz-01?shipment=shp-7');
    expect(api.calls).toContain('/api/v2/businesses');
    const sel = s.selector()!;
    expect(optionTexts(sel)).toEqual(['Brooklyn Roasters', 'Hudson Print Co']);
    select(sel, 'Hudson Print Co');
    expect(s.where).toEqual({ path: '/nyc/business/biz-02', search: '' });
    expect(textOf(s.main())).toBe('BusinessV2 at /nyc/business/biz-02');
    expect(setItem).not.toHaveBeenCalled();
    expect(readIdentity()).toEqual(JSON.parse(STORED));
  }, T);

  it('an unknown ID shows the stale-ID note; Switch drops the query', async () => {
    const s = await renderShell('/nyc/business/biz-gone?shipment=shp-7');
    const note = status(s.header())!;
    expect(textOf(note)).toContain(staleNote('business', 'Brooklyn Roasters'));
    click(link(note, 'Switch'));
    expect(s.where).toEqual({ path: '/nyc/business/biz-01', search: '' });
    expect(setItem).not.toHaveBeenCalled();
  }, T);

  it('the Business and Employee destinations point at the first /api/v2 accounts', async () => {
    const s = await renderShell('/nyc/business/biz-02');
    expect(link(s.header(), 'Business').getAttribute('href')).toBe('/nyc/business/biz-01');
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/nyc/employee/emp-01');
    click(link(s.header(), 'Employee'));
    expect(s.where.path).toBe('/nyc/employee/emp-01');
    expect(s.selector()!.value).toBe('emp-01');
    expect(setItem).not.toHaveBeenCalled();
  }, T);
});

describe('account selector on MVP 1 paths', () => {
  it('still writes the stored identity and moves to the chosen business', async () => {
    const [a, b] = MVP1.businesses;
    const s = await renderShell(`/business/${a.id}?shipment=x`);
    expect(api.calls.filter((u) => u.startsWith('/api/v2'))).toEqual([]);
    select(s.selector()!, b.name);
    expect(s.where).toEqual({ path: `/business/${b.id}`, search: '' });
    expect(readIdentity().businessId).toBe(b.id);
  }, T);

  it('still writes the stored identity for an employee', async () => {
    const [a, b] = MVP1.employees;
    const s = await renderShell(`/employee/${a.id}`);
    const sel = s.selector()!;
    const opt = [...sel.options].find((o) => o.value === b.id)!;
    select(sel, opt.text);
    expect(s.where.path).toBe(`/employee/${b.id}`);
    expect(readIdentity().employeeId).toBe(b.id);
  }, T);
});

describe('stale ID on an MVP 1 path', () => {
  it('Switch stores the identity and adds one history entry, so Back returns to the stale URL', async () => {
    const first = MVP1.businesses[0];
    const s = await renderShell('/business/biz-gone', ['/']);
    const note = status(s.header())!;
    expect(textOf(note)).toContain(staleNote('business', first.name));
    localStorage.clear();
    click(link(note, 'Switch'));
    expect(s.where.path).toBe(`/business/${first.id}`);
    expect(readIdentity().businessId).toBe(first.id);
    s.back();
    expect(s.where.path).toBe('/business/biz-gone');
  }, T);
});

describe('keyboard order and current page', () => {
  /** Header part of the Tab order: label for each stop. */
  const headerStops = (header: HTMLElement) =>
    tabOrder(header).map((el) => (el instanceof HTMLSelectElement ? 'select' : textOf(el)));

  it('on /nyc/employee/<id>: skip link, brand, three destinations, selector, Help, then the page', async () => {
    const s = await renderShell('/nyc/employee/emp-01');
    const all = tabOrder(document.body);
    expect(all[0].className).toBe('skip-link');
    expect(all[1]).toBe(link(s.header(), 'Relay'));
    expect(headerStops(s.header())).toEqual(['Relay', 'Business', 'Employee', 'Simulator', 'select', 'Help']);
    // Each stop really takes focus (nothing is hidden from the keyboard).
    for (const el of tabOrder(s.header())) {
      el.focus();
      expect(document.activeElement).toBe(el);
    }
    const current = [...s.header().querySelectorAll('[aria-current="page"]')].map((el) => textOf(el));
    expect(current).toEqual(['Employee']);
    expect(link(s.header(), 'Relay').getAttribute('href')).toBe('/nyc');
    expect(link(s.header(), 'Help').getAttribute('href')).toBe('/nyc/help');
  }, T);

  it('a stale note adds its Switch link between the selector and Help', async () => {
    const s = await renderShell('/nyc/business/biz-gone');
    expect(headerStops(s.header())).toEqual(['Relay', 'Business', 'Employee', 'Simulator', 'select', 'Switch', 'Help']);
    const current = [...s.header().querySelectorAll('[aria-current="page"]')].map((el) => textOf(el));
    expect(current).toEqual(['Business']);
  }, T);

  it('brand and Help stay inside /nyc on preview paths and move there by click', async () => {
    const s = await renderShell('/nyc/simulator');
    expect(headerStops(s.header())).toEqual(['Relay', 'Business', 'Employee', 'Simulator', 'Help']);
    click(link(s.header(), 'Help'));
    expect(s.where.path).toBe('/nyc/help');
    expect(link(s.header(), 'Help').getAttribute('aria-current')).toBe('page');
    expect(s.header().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    click(link(s.header(), 'Relay'));
    expect(s.where.path).toBe('/nyc');
    expect(s.header().querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(textOf(s.main())).toBe('Landing at /nyc');
  }, T);

  it.each(['/nyc/help/', '/help/'])('Help is the current page on %s (trailing slash)', async (path) => {
    const s = await renderShell(path);
    expect(textOf(s.main())).toBe(`Help at ${path}`);
    expect(link(s.header(), 'Help').getAttribute('aria-current')).toBe('page');
  }, T);

  it('on MVP 1 paths brand and Help leave the preview paths alone', async () => {
    const s = await renderShell('/simulator');
    expect(link(s.header(), 'Relay').getAttribute('href')).toBe('/');
    expect(link(s.header(), 'Help').getAttribute('href')).toBe('/help');
    const current = [...s.header().querySelectorAll('[aria-current="page"]')].map((el) => textOf(el));
    expect(current).toEqual(['Simulator']);
  }, T);

  it('the skip link moves focus to the main region', async () => {
    const s = await renderShell('/nyc/simulator');
    const skip = document.querySelector('a.skip-link') as HTMLAnchorElement;
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(s.main().tabIndex).toBe(-1);
    s.main().focus();
    expect(document.activeElement).toBe(s.main());
    await flush();
  }, T);
});
