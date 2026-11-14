import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell, BADGE_TEXT } from '../../client/src/App';
import {
  activeDestination, DESTINATIONS, ENV_INDICATOR_TEXT, ENV_LABELS,
} from '../../client/src/ui/shellModel';
import type { V2BusinessDirectory, V2Directory } from '../../client/src/ui/shell';

const businesses = [{ id: 'biz-01', name: 'Brooklyn Roasters' }, { id: 'biz-02', name: 'Hudson Print Co' }];
const employees = [{ id: 'emp-01', name: 'Maya Chen' }];
const bid = businesses[0].id;
const eid = employees[0].id;
type Lists = { businesses: typeof businesses; employees: typeof employees };
const render = (path: string, initial: Lists = { businesses, employees }) => {
  const e: V2Directory = { status: 'ready', employees: initial.employees };
  const b: V2BusinessDirectory = { status: 'ready', businesses: initial.businesses };
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}><AppShell initialV2={e} initialV2Businesses={b} /></MemoryRouter>,
  );
};
const header = (html: string) => /<header class="shell-header">([\s\S]*?)<\/header>/.exec(html)![1];
const nav = (html: string) => /<nav aria-label="Workspaces" class="shell-nav">([\s\S]*?)<\/nav>/.exec(header(html))![1];
const navLabels = (html: string) => [...nav(html).matchAll(/class="shell-nav-link[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
const current = (html: string) => [...nav(html).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);
const css = readFileSync('client/src/ui/shell.css', 'utf8');
const app = readFileSync('client/src/App.tsx', 'utf8');

describe('environment indicator', () => {
  it('is one constant, NYC since the cutover (#548)', () => {
    expect(ENV_INDICATOR_TEXT).toBe('Real NYC locations · simulated deliveries');
    expect(BADGE_TEXT).toBe(ENV_INDICATOR_TEXT);
    expect(ENV_LABELS.nyc).toBe('Real NYC locations · simulated deliveries');
  });
});

describe('activeDestination', () => {
  it('maps any id to its section', () => {
    expect(activeDestination('/business/x')).toBe('business');
    expect(activeDestination('/employee/y/')).toBe('employee');
    expect(activeDestination('/simulator')).toBe('simulator');
    expect(activeDestination('/')).toBeNull();
    expect(activeDestination('/help')).toBeNull();
    expect(activeDestination('/businessy')).toBeNull();
  });
  it('lists the three destinations in order', () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual(['Business', 'Employee', 'Simulator']);
  });
});

describe('compact header', () => {
  const routes: [string, string | null][] = [
    ['/', null], [`/business/${bid}`, 'Business'], [`/employee/${eid}`, 'Employee'],
    ['/simulator', 'Simulator'], ['/help', null],
  ];
  it.each(routes)('%s: three nav links in order, correct active one, indicator once', (path, active) => {
    const html = render(path);
    expect(navLabels(html)).toEqual(['Business', 'Employee', 'Simulator']);
    expect(nav(html).match(/<a /g)).toHaveLength(3);
    expect(current(html)).toEqual(active ? [active] : []);
    // The header says it once; the NYC homepage and Guided demo repeat it in their own copy.
    expect(header(html).split(ENV_INDICATOR_TEXT)).toHaveLength(2);
    expect(header(html)).toMatch(/<a [^>]*class="shell-wordmark"[^>]*>Relay<|<a [^>]*href="\/"[^>]*class="shell-wordmark"/);
    expect(header(html)).toContain('href="/help"');
    expect(header(html)).toContain(`class="shell-env">${ENV_INDICATOR_TEXT}<`);
  });
  it('nav links point to the current identity portals', () => {
    const h = nav(render('/'));
    expect(h).toContain(`href="/business/${bid}"`);
    expect(h).toContain(`href="/employee/${eid}"`);
    expect(h).toContain('href="/simulator"');
  });
  it('marks the section active even for a different account id', () => {
    expect(current(render(`/business/${businesses[1].id}`))).toEqual(['Business']);
  });
  it('Help link is marked current on /help', () => {
    expect(header(render('/help'))).toMatch(/<a [^>]*aria-current="page"[^>]*>Help</);
  });
  it('without an identity, portal items render as disabled text', () => {
    const html = render('/', { businesses: [], employees: [] });
    expect(navLabels(html)).toEqual(['Business', 'Employee', 'Simulator']);
    expect(nav(html).match(/<a /g)).toHaveLength(1);
    expect(nav(html)).toContain('aria-disabled="true"');
  });
  it('keeps the account selector, skip link and 404', () => {
    expect(header(render(`/business/${bid}`))).toContain('Demo account');
    expect(render('/').indexOf('<a')).toBe(render('/').indexOf('<a class="skip-link"'));
    expect(render('/definitely-not-a-page')).toContain('Page not found');
  });
});

describe('shell CSS', () => {
  it('is flat: 1px bottom border, no shadow, gradient or radius over 6px', () => {
    expect(css).toMatch(/\.shell-header \{[^}]*border-bottom: 1px solid/);
    expect(css).not.toContain('box-shadow');
    expect(css).not.toMatch(/gradient/);
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)(px|rem|%)/g)) {
        const v = px[2] === 'rem' ? Number(px[1]) * 16 : Number(px[1]);
        expect(px[2] === '%' ? 0 : v).toBeLessThanOrEqual(6);
      }
    }
  });
  it('uses tokens with fallbacks and a mono xs indicator', () => {
    expect(css).toMatch(/\.shell-env \{[^}]*var\(--font-mono, [^}]*var\(--text-xs, 12px\)/);
    expect(css).toContain('var(--border, #E3E3DE)');
    expect(css).toContain('var(--accent, #1D5075)');
    expect(css).toContain("var(--font-sans, 'Inter', 'Geist', system-ui");
    // No MVP II value is left as a fallback (#651).
    expect(css).not.toMatch(/#151B26|#F7F8FA|#D7DDE5|#28618A|#1F4E70|IBM Plex Sans|var\(--radius, 2px\)/i);
  });
  it('every nav item, the Help link and the selector have a focus-visible style', () => {
    const focus = /([^{}]*)\{[^}]*outline: 2px solid/.exec(css.slice(css.indexOf('.shell-wordmark:focus-visible')))![1];
    for (const sel of ['.shell-wordmark:focus-visible', '.shell-nav-link:focus-visible', '.shell-help:focus-visible', '.demo-account select:focus-visible']) {
      expect(focus).toContain(sel);
    }
  });
  it('at 390 px the nav wraps and the selector goes full width', () => {
    const narrow = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(narrow).toMatch(/\.shell-tools \{ flex: 1 1 100%/);
    expect(narrow).toMatch(/\.demo-account select \{[^}]*width: 100%/);
    const mid = /@media \(max-width: 600px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(mid).toMatch(/\.shell-nav \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.shell-header \{[^}]*flex-wrap: wrap/);
  });
});

describe('App.tsx contract', () => {
  it('mounts the NYC homepage', () => {
    expect(app).toContain("import Landing from './pages/Landing';");
    expect(app).toContain('<Landing dataset="nyc"');
  });
});
