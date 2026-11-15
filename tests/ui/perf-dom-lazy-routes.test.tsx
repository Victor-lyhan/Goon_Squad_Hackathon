// @vitest-environment jsdom
// #885: the Business, Employee and simulator pages are lazy routes of the app shell. This is what a visitor
// sees while a page's chunk is on its way, in a real DOM, with the real AppShell and header:
//   - a hard load of a workspace URL: the header is complete and <main> holds one polite loading line, then
//     the page; the header's markup is the same before and after;
//   - a click on a header link: the page on screen stays until the next page's chunk is there;
//   - a chunk that cannot be loaded: the shell's error fallback ("Reload page"), and the header still works.
// The pages are stand-ins whose modules arrive when the test opens their gate (the app's `import()` gets the
// `vi.mock` module). Each gate is used once: React keeps a lazy page after its first load, as a browser does.
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, PAGE_LOADING_TEXT } from '../../client/src/App';
import { ERROR_FALLBACK_TITLE } from '../../client/src/ui/ErrorBoundary';
import { button, click, flush, link, mount, textOf } from './kitDom';

const { gates, page } = vi.hoisted(() => {
  const gate = () => {
    let open!: () => void;
    let fail!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => { open = res; fail = rej; });
    return { promise, open, fail };
  };
  const gates = { SimulatorV2: gate(), BusinessV2: gate(), EmployeeV2: gate() };
  /** A page module that is "downloaded" when its gate opens, or fails to when the gate fails. */
  const page = (name: keyof typeof gates) => async () => {
    await gates[name].promise;
    return { default: () => <p data-page={name}>{`${name} page`}</p> };
  };
  return { gates, page };
});
vi.mock('../../client/src/pages/Landing', () => ({ default: () => <h1 data-page="Landing">Homepage</h1> }));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));

const T = 10_000;
const BUSINESSES = [{ id: 'biz-01', name: 'Brooklyn Roasters' }];
const EMPLOYEES = [{ id: 'emp-01', name: 'Maya Chen' }];

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  // Both header lists are given, so the only request is the health check.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
});

/** The real shell at `path` with the header's lists given, and the path on screen. */
function shellAt(path: string) {
  const where = { path: '' };
  function Probe() {
    where.path = useLocation().pathname;
    return null;
  }
  const m = mount(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initialV2={{ status: 'ready', employees: EMPLOYEES }} initialV2Businesses={{ status: 'ready', businesses: BUSINESSES }} />
      <Probe />
    </MemoryRouter>,
  );
  const header = () => m.container.querySelector('header.shell-header') as HTMLElement;
  const main = () => m.container.querySelector('main#main-content') as HTMLElement;
  const loadingLines = () => [...main().querySelectorAll('[role="status"]')].filter((el) => textOf(el) === PAGE_LOADING_TEXT);
  const shownPage = () => main().querySelector('[data-page]')?.getAttribute('data-page') ?? null;
  return { ...m, where, header, main, loadingLines, shownPage };
}

/** Lets the module behind an opened (or failed) gate arrive and React render it. */
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 100 && !ok(); i++) await flush();
  if (!ok()) throw new Error(`until(): ${what} did not happen`);
}

describe('a workspace page whose chunk is still loading (#885)', () => {
  it('a hard load of /business/:id shows the whole header and one loading line, then the page, and the header does not change', async () => {
    const s = shellAt('/business/biz-01');
    await flush();
    // The header is complete before the page's code is there: links, the current page, the account selector.
    expect(link(s.header(), 'Business').getAttribute('aria-current')).toBe('page');
    expect((s.header().querySelector('.demo-account select') as HTMLSelectElement).value).toBe('biz-01');
    const headerWhileLoading = s.header().outerHTML;
    // <main> holds the loading line and nothing else.
    expect(s.loadingLines()).toHaveLength(1);
    expect(s.loadingLines()[0].className).toBe('shell-page-state');
    expect(textOf(s.main())).toBe(PAGE_LOADING_TEXT);
    expect(s.shownPage()).toBeNull();

    await act(async () => { gates.BusinessV2.open(); });
    await until(() => s.shownPage() === 'BusinessV2', 'the Business page');
    expect(s.loadingLines()).toHaveLength(0);
    expect(textOf(s.main())).toBe('BusinessV2 page');
    expect(s.header().outerHTML).toBe(headerWhileLoading);
    expect(consoleError.mock.calls).toStrictEqual([]);
    expect(consoleWarn.mock.calls).toStrictEqual([]);
  }, T);

  it('a click on a header link keeps the page on screen until the next page has loaded: no loading line, no empty <main>', async () => {
    const s = shellAt('/');
    await flush();
    expect(s.shownPage()).toBe('Landing');

    click(link(s.header(), 'Simulator'));
    await flush();
    await flush();
    // The simulator's chunk is not there yet: the homepage is still shown, whole.
    expect(s.shownPage()).toBe('Landing');
    expect(s.loadingLines()).toHaveLength(0);
    expect(textOf(s.main())).toBe('Homepage');

    await act(async () => { gates.SimulatorV2.open(); });
    await until(() => s.shownPage() === 'SimulatorV2', 'the simulator page');
    expect(s.where.path).toBe('/simulator');
    expect(link(s.header(), 'Simulator').getAttribute('aria-current')).toBe('page');
    expect(s.main().className).toBe('app-main app-main--full');
    expect(s.loadingLines()).toHaveLength(0);

    // The second visit needs no chunk: the page is there with the click.
    click(link(s.header(), 'Relay'));
    expect(s.shownPage()).toBe('Landing');
    click(link(s.header(), 'Simulator'));
    expect(s.shownPage()).toBe('SimulatorV2');
    expect(consoleError.mock.calls).toStrictEqual([]);
    expect(consoleWarn.mock.calls).toStrictEqual([]);
  }, T);

  it('a chunk that cannot be loaded shows the error fallback with "Reload page", and the header still works', async () => {
    const s = shellAt('/employee/emp-01');
    await flush();
    expect(s.loadingLines()).toHaveLength(1);

    await act(async () => { gates.EmployeeV2.fail(new Error('perf-dom-lazy-routes: chunk not found')); });
    await until(() => s.main().querySelector('[role="alert"].error-fallback') !== null, 'the error fallback');
    const fallback = s.main().querySelector('[role="alert"].error-fallback')!;
    expect(textOf(fallback.querySelector('h1')!)).toBe(ERROR_FALLBACK_TITLE);
    expect(button(fallback, 'Reload page').type).toBe('button');
    expect(s.loadingLines()).toHaveLength(0);
    // The reason is not shown on the page.
    expect(s.container.innerHTML).not.toContain('chunk not found');

    click(link(s.header(), 'Relay'));
    await flush();
    expect(s.shownPage()).toBe('Landing');
    expect(s.main().querySelector('.error-fallback')).toBeNull();
  }, T);
});
