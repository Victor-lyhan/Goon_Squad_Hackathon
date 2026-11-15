// @vitest-environment jsdom
// #918: the app header by keyboard and screen reader, and what the headless Chrome pass at 390, 900 and
// 1440 px found. The landmarks, aria-current on each route, the Tab order and the selector's name are
// read from the real AppShell in a DOM; the layout fixes are pinned in shell.css, because jsdom draws
// nothing. The pages are stand-ins.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readIdentity } from '../../client/src/demoIdentity';
import { switchIdentityPath } from '../../client/src/ui/shell';
import { activeDestination, DESTINATIONS } from '../../client/src/ui/shellModel';
import { LOGO_SRC } from '../../client/src/ui/brand';
import { parseCss } from './employee-v2-qa-helpers';
import { fakeApi, renderShell } from './kit-dom-shell-helper';
import { click, deferred, flush, link, select, tabOrder, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', page('Landing'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

const T = 10_000;

beforeEach(() => {
  fakeApi();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The text of the links marked as the current page. */
const currentLinks = (header: HTMLElement) =>
  [...header.querySelectorAll('[aria-current]')].map((el) => `${el.tagName} ${textOf(el)} ${el.getAttribute('aria-current')}`);

/**
 * The name a screen reader says for a control with a <label>: the label's text without the control's own
 * text (a <select> inside its label would add every option).
 */
function labelName(control: HTMLSelectElement): string {
  expect(control.labels).toHaveLength(1);
  const copy = control.labels[0].cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll('select, input, textarea')) el.remove();
  return textOf(copy);
}

describe('landmarks', () => {
  it.each(['/', '/business/biz-01', '/employee/emp-01', '/simulator', '/nowhere'])('%s: one <header>, in it one labelled <nav>, then <main>', async (path) => {
    const s = await renderShell(path);
    const headers = s.container.querySelectorAll('header');
    expect(headers).toHaveLength(1);
    const header = headers[0];
    // A <header> is the page's banner only outside <main> and the sectioning elements.
    expect(header.closest('main, article, aside, nav, section')).toBeNull();
    expect(header.getAttribute('role')).toBeNull();

    const navs = s.container.querySelectorAll('nav');
    expect(navs).toHaveLength(1);
    expect(header.contains(navs[0])).toBe(true);
    const label = navs[0].getAttribute('aria-label')!;
    // Short, and without the word a screen reader adds itself ("Workspaces, navigation").
    expect(label).toBe('Workspaces');
    expect(label).not.toMatch(/nav/i);

    const mains = s.container.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(header.compareDocumentPosition(mains[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mains[0].contains(header)).toBe(false);

    // The three destinations are links inside the nav, in the order of DESTINATIONS; the logo is outside it.
    expect([...navs[0].querySelectorAll('a')].map((a) => textOf(a))).toEqual(DESTINATIONS.map((d) => d.label));
    expect(navs[0].contains(link(header, 'Relay'))).toBe(false);
  }, T);

  it('the logo is decorative: the word "Relay" names the link to the homepage', async () => {
    const s = await renderShell('/simulator');
    const home = link(s.header(), 'Relay');
    expect(home.getAttribute('href')).toBe('/');
    expect(home.getAttribute('aria-label')).toBeNull();
    const img = home.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(LOGO_SRC);
    expect(img.getAttribute('alt')).toBe('');
  }, T);
});

describe('aria-current="page" on each route', () => {
  it.each([
    ['/', []],
    ['/business/biz-01', ['A Business page']],
    ['/business/biz-02/', ['A Business page']],
    ['/employee/emp-01', ['A Employee page']],
    ['/employee/emp-02?job=job-1', ['A Employee page']],
    ['/simulator', ['A Simulator page']],
    ['/simulator?package=shp-4&play=1', ['A Simulator page']],
    // A stale link still shows the Business page (its "not in the current city" state).
    ['/business/biz-gone', ['A Business page']],
    ['/nowhere', []],
    ['/businessy', []],
  ] as const)('%s', async (path, expected) => {
    const s = await renderShell(path);
    expect(currentLinks(s.header())).toEqual(expected);
    // The class the bar under the link hangs on goes with it.
    expect([...s.header().querySelectorAll('.shell-nav-link.active')].map((el) => el.getAttribute('aria-current'))).toEqual(expected.map(() => 'page'));
  }, T);

  // The router reads a path in any case, so /Business/<id> shows the Business page and its selector.
  // Before #918 no link was the current one there, and choosing an account did nothing.
  it('a path in another case: the link is current and the selector works', async () => {
    expect(activeDestination('/Business/biz-01')).toBe('business');
    expect(activeDestination('/EMPLOYEE/emp-01/')).toBe('employee');
    expect(activeDestination('/Simulator')).toBe('simulator');
    expect(activeDestination('/Businessy')).toBeNull();
    expect(switchIdentityPath('/Business/biz-01', 'biz-02')).toEqual({ kind: 'business', path: '/business/biz-02' });
    expect(switchIdentityPath('/EMPLOYEE/emp-01/', 'emp-02')).toEqual({ kind: 'employee', path: '/employee/emp-02' });
    expect(switchIdentityPath('/Simulator', 'x')).toBeNull();

    const s = await renderShell('/Business/biz-01');
    expect(textOf(s.main())).toBe('BusinessV2 at /Business/biz-01');
    expect(currentLinks(s.header())).toEqual(['A Business page']);
    select(s.selector()!, 'Hudson Print Co');
    expect(s.where.path).toBe('/business/biz-02');
    expect(readIdentity().businessId).toBe('biz-02');
    expect(currentLinks(s.header())).toEqual(['A Business page']);
  }, T);

  it('follows a click from one page to the next', async () => {
    const s = await renderShell('/business/biz-01');
    for (const [name, mark] of [['Employee', 'A Employee page'], ['Simulator', 'A Simulator page'], ['Business', 'A Business page']] as const) {
      click(link(s.header(), name));
      await flush();
      expect(currentLinks(s.header()), name).toEqual([mark]);
    }
  }, T);
});

describe('Tab order', () => {
  const stops = (root: HTMLElement) => tabOrder(root).map((el) => (el instanceof HTMLSelectElement ? 'select' : textOf(el)));

  it.each([
    ['/', ['Relay', 'Business', 'Employee', 'Simulator']],
    ['/simulator', ['Relay', 'Business', 'Employee', 'Simulator']],
    ['/business/biz-01', ['Relay', 'Business', 'Employee', 'Simulator', 'select']],
    ['/employee/emp-01', ['Relay', 'Business', 'Employee', 'Simulator', 'select']],
    ['/employee/emp-gone', ['Relay', 'Business', 'Employee', 'Simulator', 'select', 'Switch']],
  ] as const)('%s: logo, links, Demo account, in the order they are drawn', async (path, expected) => {
    const s = await renderShell(path);
    const header = s.header();
    expect(stops(header)).toEqual(expected);
    // Document order and nothing else: no positive tabindex, and the three parts of the header are
    // its children in the order the grid draws them (shell.css has no `order` or reverse rule).
    expect(tabOrder(header).every((el) => el.tabIndex === 0)).toBe(true);
    expect([...header.children].map((el) => el.classList[0])).toEqual(['shell-wordmark', 'shell-nav', 'shell-tools']);
    // The header comes right after the skip link and before anything in the page.
    const all = tabOrder(document.body);
    expect(all[0].className).toBe('skip-link');
    expect(all.slice(1, 1 + expected.length)).toEqual(tabOrder(header));
    // Every stop takes the focus.
    for (const el of tabOrder(header)) {
      el.focus();
      expect(document.activeElement).toBe(el);
    }
  }, T);

  it('while the account lists load, Business and Employee are unavailable links that Tab skips', async () => {
    vi.unstubAllGlobals();
    const hold = deferred<Response>();
    fakeApi({ employees: () => hold.promise, businesses: () => hold.promise });
    const s = await renderShell('/simulator');
    const pending = [...s.header().querySelectorAll('.nav-pending')];
    expect(pending.map((el) => textOf(el))).toEqual(['Business', 'Employee']);
    for (const el of pending) {
      // "Business, link, unavailable": without the role a screen reader read plain text in the nav.
      expect(el.getAttribute('role')).toBe('link');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.hasAttribute('tabindex')).toBe(false);
      expect(el.hasAttribute('href')).toBe(false);
      expect(el.closest('nav')).not.toBeNull();
    }
    expect(stops(s.header())).toEqual(['Relay', 'Simulator']);
    expect(currentLinks(s.header())).toEqual(['A Simulator page']);
    hold.resolve(new Response('{}', { status: 500 }));
  }, T);
});

describe('the Demo account selector\'s accessible name', () => {
  it.each(['/business/biz-01', '/employee/emp-01', '/business/biz-gone'])('%s: "Demo account", from its <label>', async (path) => {
    const s = await renderShell(path);
    const sel = s.selector()!;
    expect(labelName(sel)).toBe('Demo account');
    // Nothing overrides or adds to the label.
    for (const attr of ['aria-label', 'aria-labelledby', 'aria-describedby', 'title']) expect(sel.getAttribute(attr), attr).toBeNull();
    expect(sel.labels[0].classList.contains('demo-account')).toBe(true);
    // One selector in the header, in the tools at its right.
    expect(s.header().querySelectorAll('select')).toHaveLength(1);
    expect(sel.closest('.shell-tools')).not.toBeNull();
    expect(sel.disabled).toBe(false);
  }, T);

  it('the pages without an account have no selector', async () => {
    for (const path of ['/', '/simulator', '/nowhere']) {
      const s = await renderShell(path);
      expect(s.selector(), path).toBeNull();
      expect(textOf(s.header().querySelector('.demo-account-slot')!), path).toBe('');
      s.unmount();
    }
  }, T);

  it('a stale link: the note is a status with a "Switch" link after the selector', async () => {
    const s = await renderShell('/business/biz-gone');
    const note = s.header().querySelector('.demo-account-status[role="status"]')!;
    expect(textOf(note)).toBe("That business isn't in the current city. Showing Brooklyn Roasters instead. Switch");
    expect(link(note, 'Switch').getAttribute('href')).toBe('/business/biz-01');
    expect(note.previousElementSibling).toBe(s.selector()!.labels[0]);
    // shell.css gives the tools their own row when they hold this note (see below).
    expect(s.header().querySelector(".shell-tools:has(.demo-account-status[role='status'])")).not.toBeNull();
  }, T);

  it('a list that failed says so as an alert, in the tools', async () => {
    vi.unstubAllGlobals();
    fakeApi({ businesses: () => new Response('{}', { status: 500 }) });
    const s = await renderShell('/business/biz-01');
    const alert = s.header().querySelector('.shell-tools [role="alert"]')!;
    expect(textOf(alert)).toBe('Accounts unavailable');
    expect(alert.className).toBe('demo-account-status demo-account-error');
    expect(s.selector()).toBeNull();
  }, T);
});

// What the browser pass measured (production build, headless Chrome, true 390 / 900 / 1440 px viewports).
describe('shell.css: the layout faults of #918', () => {
  const css = readFileSync('client/src/ui/shell.css', 'utf8');
  const rules = parseCss(css);
  const decls = (selector: string, maxWidthPx?: number) => Object.fromEntries(rules
    .filter((r) => r.selector.split(',').map((x) => x.trim()).includes(selector)
      && (maxWidthPx === undefined ? r.media.length === 0 : r.media.some((m) => new RegExp(`max-width:\\s*${maxWidthPx}px`).test(m))))
    .flatMap((r) => r.decls).map((d) => [d.prop, d.value]));

  it('the bar is 72 px (#955; 64 px before), and every tap target in it is at least 44 px high', () => {
    expect(css).toMatch(/:root \{ --app-header-h: 72px; \}/);
    expect(decls('.shell-wordmark')['min-height']).toBe('44px');
    expect(decls('.shell-nav-link')['min-height']).toBe('44px');
    expect(decls('.shell-header .demo-account select', 900)['min-height']).toBe('44px');
    // Was 15 px: the "Switch" link of a stale link's note.
    expect(decls('.shell-header .demo-account-status a', 900)['min-height']).toBe('44px');
    expect(decls('.shell-header .demo-account-status a', 900).display).toBe('inline-flex');
  });

  it('"Loading accounts…" is as high as the selector that replaces it (the page moved 27 px at 390 and 900 px)', () => {
    const status = decls('.shell-header .demo-account-status', 900);
    expect(status['min-height']).toBe(decls('.shell-header .demo-account select', 900)['min-height']);
    expect(status.display).toBe('flex');
    expect(status['align-items']).toBe('center');
  });

  it('a stale link\'s note gives the tools the row under the bar at every width, as up to 900 px', () => {
    // Above 900 px the note stood under the selector inside the bar: the bar was 87 px high at 901 px and
    // 71 px at 1024 px, and the selector's focus ring was cut by the top of the window.
    const stale = decls(".shell-tools:has(.demo-account-status[role='status'])");
    const narrow = decls('.shell-tools', 900);
    expect(Object.keys(narrow).length).toBeGreaterThan(0);
    expect(stale).toEqual(narrow);
    expect(stale['grid-column']).toBe('1 / -1');
    // The selector and a note under it both end at the right edge.
    expect(decls('.shell-header .demo-account-slot')['justify-content']).toBe('flex-end');
  });

  it('"Accounts unavailable" is drawn in the error colour (the header\'s own grey rule had won)', () => {
    // #955: the bar is ink, where the page's red (#A4322A, 2:1 on ink) cannot be read, so it has a lighter red.
    expect(decls('.shell-header .demo-account-error').color).toBe('var(--danger-on-ink, #FF9B8E)');
    expect(readFileSync('client/src/styles/tokens.css', 'utf8')).toMatch(/--danger-on-ink: #FF9B8E;/);
    expect(decls('.shell-header .demo-account-status').color).toBe('var(--on-ink-muted, #A3A9B5)');
    // It comes after the grey rule of the same weight.
    expect(css.indexOf('.shell-header .demo-account-error {')).toBeGreaterThan(css.indexOf('.shell-header .demo-account-status {'));
  });

  it('every Tab stop of the header has a focus ring, and none is taken away', () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const ring = rules.find((r) => r.media.length === 0 && r.selector.includes('.shell-wordmark:focus-visible'))!;
    const selectors = ring.selector.split(',').map((x) => x.trim());
    for (const sel of [
      '.shell-wordmark:focus-visible', '.shell-nav-link:focus-visible',
      '.shell-header .demo-account select:focus-visible', '.shell-header .demo-account-status a:focus-visible',
    ]) expect(selectors, sel).toContain(sel);
    // On the ink bar the ring is the light one (#955): the primary colour is only 2:1 there (tokens.css).
    expect(ring.decls.find((d) => d.prop === 'outline')!.value).toBe('2px solid var(--focus-ring-on-dark, #FFFFFF)');
    expect(noComments).not.toMatch(/outline:\s*(none|0)\b/);
    expect(noComments).not.toMatch(/(^|[;{\s])order:|-reverse|tabindex/);
  });
});
