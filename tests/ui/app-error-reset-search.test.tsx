// @vitest-environment jsdom
// #705: the page error fallback of the app shell is cleared when the query string changes, not only the
// path. Every Watch link goes to /simulator?package=<id>&play=1, so a crash on one package's journey must
// not keep the fallback when another package is opened. A change of the hash alone does not reset.
// Real AppShell and header; the pages are stand-ins that throw for the IDs in `crashing`.
import { act } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../client/src/App';
import { fakeApi, V2_BUSINESSES, V2_EMPLOYEES } from './kit-dom-shell-helper';
import { flush, mount, textOf } from './kitDom';

const CRASH_TEXT = 'app-error-reset-search secret crash detail';

const { crashing, renders, page } = vi.hoisted(() => {
  /** Values of the page's query parameter (or page names) that throw on render. */
  const crashing = new Set<string>();
  /** How often each stand-in page started to render. */
  const renders = new Map<string, number>();
  /** A stand-in page: "<name> at <path><search><hash>"; throws while its name or its `param` value is in `crashing`. */
  const page = (name: string, param?: string) => async () => {
    const { useLocation } = await import('react-router-dom');
    return {
      default: function StubPage() {
        const { pathname, search, hash } = useLocation();
        renders.set(name, (renders.get(name) ?? 0) + 1);
        const value = param ? new URLSearchParams(search).get(param) : null;
        if (crashing.has(name) || (value !== null && crashing.has(value))) {
          throw new Error(`app-error-reset-search secret crash detail in ${name}`);
        }
        return <p data-page={name}>{`${name} at ${pathname}${search}${hash}`}</p>;
      },
    };
  };
  return { crashing, renders, page };
});
vi.mock('../../client/src/pages/Landing', page('Landing'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2', 'package'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2', 'job'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2', 'shipment'));

const T = 10_000;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakeApi();
  localStorage.clear();
  // React logs every caught render error; keep the run quiet (the tests check what the page shows).
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  crashing.clear();
  renders.clear();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

function Nav({ out }: { out: { go?: (to: string) => void } }) {
  const navigate = useNavigate();
  out.go = (to) => navigate(to);
  return null;
}

/** The real shell at `path`, with the header lists given (no list requests), and a `go(to)` like a link click. */
async function shellAt(path: string) {
  const nav: { go?: (to: string) => void } = {};
  const m = mount(
    <MemoryRouter initialEntries={[path]}>
      <AppShell
        initialV2={{ status: 'ready', employees: V2_EMPLOYEES }}
        initialV2Businesses={{ status: 'ready', businesses: V2_BUSINESSES }}
      />
      <Nav out={nav} />
    </MemoryRouter>,
  );
  await flush();
  const main = () => m.container.querySelector('main#main-content') as HTMLElement;
  const fallback = () => main().querySelector('[role="alert"].error-fallback');
  const go = (to: string) => act(() => { nav.go!(to); });
  return { ...m, main, fallback, go };
}

describe('the page error fallback resets on a query string change (#705)', () => {
  it('a crash on /simulator?package=a clears when ?package=b is opened', async () => {
    crashing.add('a');
    const s = await shellAt('/simulator?package=a');
    expect(s.fallback()).not.toBeNull();
    expect(s.container.innerHTML).not.toContain(CRASH_TEXT);

    s.go('/simulator?package=b');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('SimulatorV2 at /simulator?package=b');
  }, T);

  it('a Watch link to another package (&play=1) clears it, and going back to the crashing one shows it again', async () => {
    crashing.add('a');
    const s = await shellAt('/simulator?package=a&play=1');
    expect(s.fallback()).not.toBeNull();

    s.go('/simulator?package=b&play=1');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('SimulatorV2 at /simulator?package=b&play=1');

    s.go('/simulator?package=a&play=1');
    expect(s.fallback()).not.toBeNull();
    expect(s.container.innerHTML).not.toContain(CRASH_TEXT);
  }, T);

  it('a crash on /business/:id?shipment= clears when another shipment detail is opened', async () => {
    crashing.add('shp-1');
    const s = await shellAt('/business/biz-01?shipment=shp-1');
    expect(s.fallback()).not.toBeNull();

    s.go('/business/biz-01?shipment=shp-2');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('BusinessV2 at /business/biz-01?shipment=shp-2');
  }, T);

  it('dropping the query string clears it too (the package list without a journey)', async () => {
    crashing.add('a');
    const s = await shellAt('/simulator?package=a');
    expect(s.fallback()).not.toBeNull();

    s.go('/simulator');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('SimulatorV2 at /simulator');
  }, T);
});

describe('a path change still resets (unchanged)', () => {
  it('a crash on /simulator?package=a clears on /', async () => {
    crashing.add('a');
    const s = await shellAt('/simulator?package=a');
    expect(s.fallback()).not.toBeNull();

    s.go('/');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('Landing at /');
  }, T);

  it('a crash on one account page clears on another account page, without a query string', async () => {
    crashing.add('EmployeeV2');
    const s = await shellAt('/employee/emp-01');
    expect(s.fallback()).not.toBeNull();

    crashing.clear();
    s.go('/employee/emp-02');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('EmployeeV2 at /employee/emp-02');
  }, T);
});

describe('what does not reset', () => {
  it('a change of the hash alone keeps the fallback, though the page would render now', async () => {
    crashing.add('a');
    const s = await shellAt('/simulator?package=a');
    expect(s.fallback()).not.toBeNull();

    // The page would no longer throw, so a reset would show it.
    crashing.clear();
    const before = renders.get('SimulatorV2');
    s.go('/simulator?package=a#timeline');
    expect(s.fallback()).not.toBeNull();
    expect(renders.get('SimulatorV2')).toBe(before);
    s.go('/simulator?package=a#map');
    expect(s.fallback()).not.toBeNull();
    expect(renders.get('SimulatorV2')).toBe(before);

    // Control: the same page with another query string does reset.
    s.go('/simulator?package=a&play=1#map');
    expect(s.fallback()).toBeNull();
    expect(textOf(s.main())).toBe('SimulatorV2 at /simulator?package=a&play=1#map');
  }, T);

  it('a header re-render at the same path and query string keeps the fallback', async () => {
    crashing.add('a');
    const s = await shellAt('/simulator?package=a');
    crashing.clear();
    const before = renders.get('SimulatorV2');
    // The same URL again (a second click on the same Watch link).
    s.go('/simulator?package=a');
    expect(s.fallback()).not.toBeNull();
    expect(renders.get('SimulatorV2')).toBe(before);
  }, T);

  it('a page that does not throw is not remounted by a query string change', async () => {
    const s = await shellAt('/simulator?package=a');
    expect(s.fallback()).toBeNull();
    const node = s.main().querySelector('[data-page="SimulatorV2"]');
    s.go('/simulator?package=b');
    expect(s.fallback()).toBeNull();
    expect(s.main().querySelector('[data-page="SimulatorV2"]')).toBe(node);
    expect(textOf(s.main())).toBe('SimulatorV2 at /simulator?package=b');
  }, T);
});
