// @vitest-environment jsdom
// #568: the header's Demo account selector shows each employee's employer: "Jordan Lee · Titan Foods".
// The label is two names from the /api/v2 lists (employee.businessId), in the API's order (DECISIONS pass 59);
// the name alone while the business list is loading or has no such business. The pure function first, then the
// real header in a real DOM against a fake /api/v2 (the pages are stand-ins), then the CSS that truncates it.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readIdentity } from '../../client/src/demoIdentity';
import { isTravelUnavailable } from '../../client/src/api/v2';
import { startV2Directory, startV2DirectoryWithEmployers, type V2Directory } from '../../client/src/ui/shell';
import { EMPLOYER_SEPARATOR, employeeOptions } from '../../client/src/ui/shellModel';
import { fakeApi, renderShell } from './kit-dom-shell-helper';
import { deferred, flush, link, select, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', page('Landing'));
vi.mock('../../client/src/pages/Help', page('Help'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

const T = 10_000;

// The API's order is not alphabetical and not grouped by employer: the story's employees come first.
const BUSINESSES = [
  { id: 'biz-1', name: 'Titan Foods', neighborhood: 'Astoria' },
  { id: 'biz-2', name: 'Brooklyn Roasters', neighborhood: 'Red Hook' },
  { id: 'biz-3', name: 'Hudson Print Co', neighborhood: 'Chelsea' },
];
const EMPLOYEES = [
  { id: 'emp-1', name: 'Jordan Lee', businessId: 'biz-1', homeId: 'home-1' },
  { id: 'emp-2', name: 'Zoe Abara', businessId: 'biz-3', homeId: 'home-2' },
  { id: 'emp-3', name: 'Ana Ruiz', businessId: 'biz-1', homeId: 'home-3' },
  { id: 'emp-4', name: 'Ben Okafor', businessId: 'biz-2', homeId: 'home-4' },
];
const LABELS = ['Jordan Lee · Titan Foods', 'Zoe Abara · Hudson Print Co', 'Ana Ruiz · Titan Foods', 'Ben Okafor · Brooklyn Roasters'];
const NAMES = EMPLOYEES.map((e) => e.name);
const IDS = EMPLOYEES.map((e) => e.id);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const optionTexts = (el: HTMLSelectElement) => [...el.options].map((o) => o.text);
const optionValues = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);
/** No label may show a missing value, an ID or a separator with nothing after (or before) it. */
function expectClean(labels: string[]) {
  for (const label of labels) {
    expect(label).not.toMatch(/undefined|null|\bbiz-|\bemp-/);
    expect(label.trim()).toBe(label);
    expect(label.startsWith('·') || label.endsWith('·')).toBe(false);
  }
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('employeeOptions (pure)', () => {
  it('reads "<employee name> · <employer name>", in the API\'s order, with the employee ID as the value', () => {
    const options = employeeOptions(EMPLOYEES, BUSINESSES);
    expect(options.map((o) => o.label)).toEqual(LABELS);
    expect(options.map((o) => o.id)).toEqual(IDS);
    expect(EMPLOYER_SEPARATOR).toBe(' · ');
  });

  it('does not sort or group: a reversed list gives reversed options', () => {
    const reversed = [...EMPLOYEES].reverse();
    expect(employeeOptions(reversed, BUSINESSES).map((o) => o.label)).toEqual([...LABELS].reverse());
  });

  it('shows the name alone while the business list is not loaded', () => {
    const options = employeeOptions(EMPLOYEES, undefined);
    expect(options.map((o) => o.label)).toEqual(NAMES);
    expect(options.map((o) => o.id)).toEqual(IDS);
  });

  it('shows the name alone for an employer that is not in the list, has no name, or is not given', () => {
    const employees = [
      { id: 'emp-1', name: 'Jordan Lee', businessId: 'biz-gone' },
      { id: 'emp-2', name: 'Zoe Abara', businessId: 'biz-blank' },
      { id: 'emp-3', name: 'Ana Ruiz' },
      { id: 'emp-4', name: 'Ben Okafor', businessId: '' },
      { id: 'emp-5', name: 'Cy Park', businessId: 'biz-1' },
    ];
    const businesses = [...BUSINESSES, { id: 'biz-blank', name: '   ' }];
    const labels = employeeOptions(employees, businesses).map((o) => o.label);
    expect(labels).toEqual(['Jordan Lee', 'Zoe Abara', 'Ana Ruiz', 'Ben Okafor', 'Cy Park · Titan Foods']);
    expectClean(labels);
    expect(employeeOptions(employees, []).map((o) => o.label)).toEqual(employees.map((e) => e.name));
    expect(employeeOptions([], BUSINESSES)).toEqual([]);
  });

  it('does not change its inputs', () => {
    const employees = EMPLOYEES.map((e) => Object.freeze({ ...e }));
    const businesses = BUSINESSES.map((b) => Object.freeze({ ...b }));
    expect(employeeOptions(Object.freeze(employees), Object.freeze(businesses))).toHaveLength(EMPLOYEES.length);
  });
});

describe('startV2DirectoryWithEmployers (the header\'s employee list)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('keeps id, name and the employer id, and nothing else; the shared loader still keeps id and name', async () => {
    const withEmployers: V2Directory[] = [];
    const plain: V2Directory[] = [];
    const noEmployer: V2Directory[] = [];
    startV2DirectoryWithEmployers(async () => ({ employees: EMPLOYEES }), isTravelUnavailable, (d) => withEmployers.push(d));
    startV2Directory(async () => ({ employees: EMPLOYEES }), isTravelUnavailable, (d) => plain.push(d));
    startV2DirectoryWithEmployers(async () => ({ employees: [{ id: 'emp-9', name: 'Di Wu' }] }), isTravelUnavailable, (d) => noEmployer.push(d));
    await settle();
    expect(withEmployers).toStrictEqual([
      { status: 'ready', employees: EMPLOYEES.map(({ id, name, businessId }) => ({ id, name, businessId })) },
    ]);
    expect(plain).toStrictEqual([{ status: 'ready', employees: EMPLOYEES.map(({ id, name }) => ({ id, name })) }]);
    expect(noEmployer).toStrictEqual([{ status: 'ready', employees: [{ id: 'emp-9', name: 'Di Wu' }] }]);
  });

  it('a 503 is "unavailable", another failure an error, and cancel drops a late answer', async () => {
    const states: V2Directory[] = [];
    const err503 = Object.assign(new Error('x'), { marker: 503 });
    const is503 = (e: unknown) => (e as { marker?: number }).marker === 503;
    startV2DirectoryWithEmployers(async () => { throw err503; }, is503, (d) => states.push(d));
    startV2DirectoryWithEmployers(async () => { throw new Error('down'); }, is503, (d) => states.push(d));
    let signal: AbortSignal | undefined;
    const late = deferred<{ employees: typeof EMPLOYEES }>();
    const cancel = startV2DirectoryWithEmployers((opts) => { signal = opts.signal; return late.promise; }, is503, (d) => states.push(d));
    cancel();
    late.resolve({ employees: EMPLOYEES });
    await settle();
    expect(signal!.aborted).toBe(true);
    expect(states).toEqual([{ status: 'unavailable' }, { status: 'error', message: 'down' }]);
  });
});

describe('the selector on /employee/<id> (real DOM)', () => {
  it('lists every employee with the employer, in the API\'s order; the values are the employee IDs', async () => {
    const api = fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES });
    const s = await renderShell('/employee/emp-3');
    expect(api.calls).toContain('/api/v2/employees');
    expect(api.calls).toContain('/api/v2/businesses');
    const sel = s.selector()!;
    expect(optionTexts(sel)).toEqual(LABELS);
    expect(optionValues(sel)).toEqual(IDS);
    expect(sel.value).toBe('emp-3');
    expect(sel.selectedOptions[0].text).toBe('Ana Ruiz · Titan Foods');
  }, T);

  it('keeps its accessible name and stays plain text (no pill or badge inside the label)', async () => {
    fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES });
    const s = await renderShell('/employee/emp-1');
    const sel = s.selector()!;
    expect(sel.labels).toHaveLength(1);
    expect(textOf(sel.labels[0].querySelector('span')!)).toBe('Demo account');
    expect(sel.getAttribute('aria-label')).toBeNull();
    for (const o of sel.options) expect(o.children).toHaveLength(0);
    expect(s.header().querySelector('.demo-account-status')).toBeNull();
  }, T);

  it('choosing an employee by the new label goes to /employee/<id> and stores the identity', async () => {
    fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES });
    const s = await renderShell('/employee/emp-1?job=job-1');
    select(s.selector()!, 'Ben Okafor · Brooklyn Roasters');
    expect(s.where).toEqual({ path: '/employee/emp-4', search: '' });
    expect(s.selector()!.value).toBe('emp-4');
    expect(s.selector()!.selectedOptions[0].text).toBe('Ben Okafor · Brooklyn Roasters');
    expect(textOf(s.main())).toBe('EmployeeV2 at /employee/emp-4');
    expect(readIdentity()).toEqual({ employeeId: 'emp-4' });
    expect(link(s.header(), 'Employee').getAttribute('href')).toBe('/employee/emp-4');
  }, T);

  it('while the business list is loading the options show the names alone, then the employers', async () => {
    const pending = deferred<Response>();
    fakeApi({ employees: EMPLOYEES, businesses: () => pending.promise });
    const s = await renderShell('/employee/emp-2');
    // The employee list is ready, so the selector is usable before the employers arrive.
    expect(optionTexts(s.selector()!)).toEqual(NAMES);
    expect(optionValues(s.selector()!)).toEqual(IDS);
    expect(s.selector()!.value).toBe('emp-2');
    expectClean(optionTexts(s.selector()!));
    select(s.selector()!, 'Ana Ruiz');
    expect(s.where.path).toBe('/employee/emp-3');
    expect(readIdentity()).toEqual({ employeeId: 'emp-3' });

    pending.resolve(json(200, { businesses: BUSINESSES }));
    await flush();
    await flush();
    expect(optionTexts(s.selector()!)).toEqual(LABELS);
    expect(s.selector()!.value).toBe('emp-3');
  }, T);

  it('while the employee list is loading it says "Loading accounts…", with no selector', async () => {
    const pending = deferred<Response>();
    fakeApi({ employees: () => pending.promise, businesses: BUSINESSES });
    const s = await renderShell('/employee/emp-1');
    expect(s.selector()).toBeNull();
    expect(textOf(s.header().querySelector('.demo-account-status')!)).toBe('Loading accounts…');
    pending.resolve(json(200, { employees: EMPLOYEES }));
    await flush();
    await flush();
    expect(optionTexts(s.selector()!)).toEqual(LABELS);
  }, T);

  it('a business list that fails or answers 503 leaves the names alone', async () => {
    const answers = [
      () => json(500, { error: 'boom' }),
      () => json(503, { error: 'NYC travel data is not loaded', code: 'travel_data_missing' }),
    ];
    for (const businesses of answers) {
      fakeApi({ employees: EMPLOYEES, businesses });
      const s = await renderShell('/employee/emp-1');
      expect(optionTexts(s.selector()!)).toEqual(NAMES);
      expectClean(optionTexts(s.selector()!));
      s.unmount();
    }
  }, T);

  it('an employee whose employer is not in the business list shows the name alone', async () => {
    fakeApi({
      employees: [...EMPLOYEES, { id: 'emp-5', name: 'Cy Park', businessId: 'biz-gone' }, { id: 'emp-6', name: 'Di Wu' }],
      businesses: BUSINESSES,
    });
    const s = await renderShell('/employee/emp-5');
    expect(optionTexts(s.selector()!)).toEqual([...LABELS, 'Cy Park', 'Di Wu']);
    expectClean(optionTexts(s.selector()!));
    expect(s.selector()!.selectedOptions[0].text).toBe('Cy Park');
  }, T);

  it('the stale-ID note still names the employee alone', async () => {
    fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES });
    const s = await renderShell('/employee/emp-99');
    expect(s.selector()!.selectedOptions[0].text).toBe('Jordan Lee · Titan Foods');
    const note = textOf(s.header().querySelector('.demo-account-status[role="status"]')!);
    expect(note).toContain('Showing Jordan Lee instead.');
    expect(note).not.toContain('Titan Foods');
  }, T);
});

describe('the selector on /business/<id> is unchanged', () => {
  it('lists the business names alone, in the API\'s order', async () => {
    fakeApi({ employees: EMPLOYEES, businesses: BUSINESSES });
    const s = await renderShell('/business/biz-2');
    const sel = s.selector()!;
    expect(optionTexts(sel)).toEqual(BUSINESSES.map((b) => b.name));
    expect(optionValues(sel)).toEqual(BUSINESSES.map((b) => b.id));
    expect(sel.value).toBe('biz-2');
    select(sel, 'Hudson Print Co');
    expect(s.where.path).toBe('/business/biz-3');
    expect(readIdentity()).toEqual({ businessId: 'biz-3' });
  }, T);
});

describe('useV2Lists with one list passed in', () => {
  it('still loads the other list and starts the runId poll; the passed list is never loaded', async () => {
    const api = fakeApi({ employees: [], businesses: BUSINESSES });
    const s = await renderShell('/employee/emp-1', [], { initialV2: { status: 'ready', employees: EMPLOYEES } });
    expect(api.calls).toContain('/api/v2/businesses');
    expect(api.calls).toContain('/api/v2/simulator');
    expect(api.calls).not.toContain('/api/v2/employees');
    expect(optionTexts(s.selector()!)).toEqual(LABELS);
  }, T);

  it('with both lists passed in nothing is loaded and no poll starts', async () => {
    const api = fakeApi();
    const s = await renderShell('/employee/emp-1', [], {
      initialV2: { status: 'ready', employees: EMPLOYEES },
      initialV2Businesses: { status: 'ready', businesses: BUSINESSES },
    });
    expect(api.calls.filter((u) => u.startsWith('/api/v2/'))).toEqual([]);
    expect(optionTexts(s.selector()!)).toEqual(LABELS);
  }, T);

  it('the doc comment of useV2Lists says so', () => {
    const app = readFileSync('client/src/App.tsx', 'utf8');
    const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*function useV2Lists\(/.exec(app)![1].replace(/\s*\*\s*/g, ' ');
    expect(doc).toMatch(/only one list passed/i);
    expect(doc).toMatch(/loads the other list/);
    expect(doc).toMatch(/starts the runId poll/);
  });
});

describe('shell.css: a long label does not widen the header', () => {
  const css = readFileSync('client/src/ui/shell.css', 'utf8');
  const rule = (selector: string, from = css) => {
    const at = from.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return from.slice(at, from.indexOf('}', at));
  };

  it('the select has a capped width, may shrink, and cuts its text with an ellipsis', () => {
    const select = rule('.shell-header .demo-account select');
    expect(select).toMatch(/max-width: 20rem/);
    expect(select).toMatch(/min-width: 0/);
    expect(select).toMatch(/overflow: hidden/);
    expect(select).toMatch(/text-overflow: ellipsis/);
    expect(select).toMatch(/white-space: nowrap/);
  });

  it('its label and slot never exceed the header, and every header child may shrink', () => {
    expect(rule('.shell-header .demo-account')).toMatch(/min-width: 0; max-width: 100%/);
    expect(rule('.shell-header .demo-account-slot')).toMatch(/max-width: 100%/);
    expect(rule('.shell-header > *')).toMatch(/min-width: 0/);
    expect(rule('.shell-header')).toMatch(/flex-wrap: wrap/);
  });

  it('at 390 px the selector takes the row\'s width and no more', () => {
    const narrow = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(narrow).toMatch(/\.shell-header \.demo-account-slot, \.shell-header \.demo-account \{ width: 100%/);
    const select = rule('.shell-header .demo-account select', narrow);
    expect(select).toMatch(/width: 100%/);
    expect(select).toMatch(/max-width: 100%/);
    // Nothing in the narrow rules takes the truncation back.
    expect(narrow).not.toMatch(/min-width: (?!0)|white-space: nowrap|overflow: visible/);
  });
});
