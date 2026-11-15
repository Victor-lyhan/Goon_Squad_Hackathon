import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import * as appModule from '../../client/src/App';
import { AppShell } from '../../client/src/App';
import * as shellModel from '../../client/src/ui/shellModel';
import { activeDestination, DESTINATIONS } from '../../client/src/ui/shellModel';
import type { V2BusinessDirectory, V2Directory } from '../../client/src/ui/shell';
import { parseCss } from './employee-v2-qa-helpers';

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
const shellRules = parseCss(css);
/** What shell.css gives `prop` for `selector`: outside any media query, or inside the `max-width: <px>` one. */
function value(selector: string, prop: string, maxWidthPx?: number): string | undefined {
  const hits = shellRules.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)
    && (maxWidthPx === undefined ? r.media.length === 0 : r.media.some((m) => new RegExp(`max-width:\\s*${maxWidthPx}px`).test(m))));
  return hits.flatMap((r) => r.decls).filter((d) => d.prop === prop).pop()?.value;
}

/** The line the header's top right held until #854 (the homepage lost it in #833). */
const OLD_ENV_TEXT = 'Real NYC locations · simulated deliveries';

describe('environment indicator (#854)', () => {
  it('is gone from the shell: no constant, no element, no CSS rule', () => {
    for (const name of ['ENV_INDICATOR_TEXT', 'ENV_LABELS', 'ENV_DATASET']) expect(shellModel).not.toHaveProperty(name);
    expect(appModule).not.toHaveProperty('BADGE_TEXT');
    expect(app).not.toMatch(/shell-env|simulated deliveries/);
    expect(css).not.toContain('shell-env');
  });
  it('the empty tools box takes no row of its own in a narrow header', () => {
    // Headless Chrome at 390 px: without this rule the header of /simulator was 89 px (a blank 8 px row
    // under the nav); with it 81 px. Since #868 the empty box would be a 17 px row with a hairline
    // under the 64 px bar.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).toMatch(/\.shell-tools:has\(> \.demo-account-slot:empty\) \{ display: none; \}/);
  });
  it.each([
    '/', `/business/${bid}`, `/employee/${eid}`, '/simulator', '/business', '/employee', '/nope', '/nyc/simulator',
  ])('%s: the header has no text at its top right', (path) => {
    const html = render(path);
    expect(html).not.toContain(OLD_ENV_TEXT);
    expect(html).not.toMatch(/simulated deliveries|Real NYC locations/i);
    expect(header(html)).not.toContain('shell-env');
    // After the nav the header holds the tools only, and the tools hold the Demo account slot only.
    const tools = header(html).slice(header(html).indexOf('</nav>') + '</nav>'.length);
    expect(tools).toMatch(/^<div class="shell-tools"><div class="demo-account-slot" data-slot="demo-account-selector">/);
    const slot = /^<div class="shell-tools"><div class="demo-account-slot" data-slot="demo-account-selector">([\s\S]*)<\/div><\/div>$/.exec(tools)![1];
    // An account page: the selector (a real control, kept). Every other page: nothing at all.
    const account = /^\/(business|employee)\/[^/]+$/.test(path);
    if (account) expect(slot).toMatch(/^<label class="demo-account"><span>Demo account<\/span><select>[\s\S]*<\/select><\/label>$/);
    else expect(slot).toBe('');
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
    ['/simulator', 'Simulator'],
  ];
  it.each(routes)('%s: three nav links in order, correct active one, no indicator', (path, active) => {
    const html = render(path);
    expect(navLabels(html)).toEqual(['Business', 'Employee', 'Simulator']);
    expect(nav(html).match(/<a /g)).toHaveLength(3);
    expect(current(html)).toEqual(active ? [active] : []);
    // No page's header says the environment line (#833 the homepage, #854 every page).
    expect(header(html)).not.toContain(OLD_ENV_TEXT);
    // The brand link (#784): to "/", the logo first (decorative, so the link's name is the word), then "Relay".
    const brand = /<a ([^>]*)>(.*?)<\/a>/.exec(header(html))!;
    expect(brand[1]).toContain('class="shell-wordmark"');
    expect(brand[1]).toContain('href="/"');
    expect(brand[2]).toBe('<img class="shell-logo" src="/brand/relay-logo.png" alt="" width="28" height="28"/>Relay');
    expect(header(html).match(/<img /g)).toHaveLength(1);
    expect(header(html)).not.toContain('href="/help"'); // the Help page is deleted (#623)
    expect(header(html)).not.toContain('shell-env');
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
  it('/help is not a page: no Help link, nothing marked current, the 404 below (#623)', () => {
    const html = render('/help');
    expect(header(html)).not.toMatch(/>Help</);
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain('Page not found');
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
  it('uses tokens with fallbacks', () => {
    expect(css).toContain('var(--border, #E3E3DE)');
    expect(css).toContain('var(--accent, #1D5075)');
    expect(css).toContain("var(--font-sans, 'Inter', 'Geist', system-ui");
    // No MVP II value is left as a fallback (#651).
    expect(css).not.toMatch(/#151B26|#F7F8FA|#D7DDE5|#28618A|#1F4E70|IBM Plex Sans|var\(--radius, 2px\)/i);
  });
  it('the logo is 28 px beside the word, centered in the bar by its link (#784, #868)', () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).toMatch(/\.shell-logo \{[^}]*width: 28px; height: 28px/);
    expect(noComments).toMatch(/\.shell-logo \{[^}]*flex: none/); // never squeezed at 390 px
    const wordmark = /\.shell-wordmark \{([^}]*)\}/.exec(noComments)![1];
    expect(wordmark).toMatch(/display: inline-flex; align-items: center; gap: var\(--space-2, 8px\)/);
    expect(wordmark).toMatch(/padding: 0;/);
    // The logo stays at the left end of the bar; the link is a 44 px target, lower than the 64 px bar.
    expect(value('.shell-wordmark', 'justify-self')).toBe('start');
    expect(value('.shell-wordmark', 'min-height')).toBe('44px');
    expect(value('.shell-header', 'align-items')).toBe('center');
  });
  it('every nav item and the selector have a focus-visible style', () => {
    const focus = /([^{}]*)\{[^}]*outline: 2px solid/.exec(css.slice(css.indexOf('.shell-wordmark:focus-visible')))![1];
    for (const sel of ['.shell-wordmark:focus-visible', '.shell-nav-link:focus-visible', '.demo-account select:focus-visible']) {
      expect(focus).toContain(sel);
    }
  });
  it('at 390 px the links wrap inside the nav, and the selector has a full-width row under the bar', () => {
    const narrow = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(narrow).toMatch(/\.demo-account select \{[^}]*width: 100%/);
    expect(value('.shell-nav', 'flex-wrap', 600)).toBe('wrap');
    // Two columns: the logo, then the nav in a column that may shrink to nothing, so the links wrap
    // before anything runs past the window's edge. Every header child may shrink.
    expect(value('.shell-header', 'grid-template-columns', 600)).toBe('auto minmax(0, 1fr)');
    expect(value('.shell-header > *', 'min-width')).toBe('0');
    // The selector's row spans the header from 900 px down (so at 390 px too) and takes its whole width.
    expect(value('.shell-tools', 'grid-column', 900)).toBe('1 / -1');
    expect(value('.shell-tools', 'justify-self', 900)).toBe('stretch');
    for (const px of [600, 480]) expect(value('.shell-tools', 'grid-column', px)).toBeUndefined();
  });
});

describe('taller header with centered, stronger links (#868)', () => {
  const px = (v: string | undefined) => Number(/^(\d+(?:\.\d+)?)px$/.exec(v ?? '')![1]);

  it('the bar is 64 to 72 px high, and the simulator below it reads the same number', () => {
    const h = px(value(':root', '--app-header-h'));
    expect(h).toBeGreaterThanOrEqual(64);
    expect(h).toBeLessThanOrEqual(72);
    // The first grid row is the bar: its height less the 1 px hairline under it. No vertical padding adds to it.
    expect(value('.shell-header', 'grid-template-rows')).toBe('minmax(calc(var(--app-header-h, 64px) - 1px), auto)');
    expect(value('.shell-header', 'padding')).toBe('0 var(--shell-pad)');
    expect(value('.shell-header', 'border-bottom')).toMatch(/^1px solid /);
    expect(value('.shell-header', 'min-height')).toBeUndefined();
    // The simulator workspace and its loading state are fixed at that height from the top.
    for (const file of ['client/src/components/sim/v2/SimWorkspace.css', 'client/src/components/sim/v2/compose/compose.css']) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/position: fixed;\s*top: var\(--app-header-h, \d+px\);/);
    }
    // One definition, and no narrow rule changes it: the simulator is only shown from 900 px up, where
    // the header is one row on every page without a selector.
    expect(css.match(/--app-header-h:/g)).toHaveLength(1);
  });

  it('the link group is in the middle of the bar: two equal side columns around it, the logo left, the tools right', () => {
    expect(value('.shell-header', 'display')).toBe('grid');
    expect(value('.shell-header', 'grid-template-columns')).toBe('minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(value('.shell-wordmark', 'justify-self')).toBe('start');
    expect(value('.shell-tools', 'justify-self')).toBe('end');
    // The tools never grow out of their column over the links.
    expect(value('.shell-tools', 'max-width')).toBe('100%');
    // DOM order is logo, nav, tools, which is the column order.
    expect(app.indexOf('className="shell-wordmark"')).toBeLessThan(app.indexOf('className="shell-nav"'));
    expect(app.indexOf('className="shell-nav"')).toBeLessThan(app.indexOf('className="shell-tools"'));
  });

  it('link text is 15 to 16 px at weight 500 to 600, a weight Inter is loaded at, with room between the links', () => {
    const size = px(value('.shell-nav-link', 'font-size'));
    expect(size).toBeGreaterThanOrEqual(15);
    expect(size).toBeLessThanOrEqual(16);
    const weight = Number(value('.shell-nav-link', 'font-weight'));
    expect(weight).toBeGreaterThanOrEqual(500);
    expect(weight).toBeLessThanOrEqual(600);
    expect(readFileSync('client/src/styles/fonts.css', 'utf8')).toContain(`@fontsource/inter/latin-${weight}.css`);
    expect(value('.shell-header', 'font-family')).toMatch(/^var\(--font-sans, 'Inter'/);
    // 16 px on each side of a word and 8 px between two links: 40 px from word to word.
    expect(value('.shell-nav-link', 'padding')).toBe('0 var(--space-4, 16px)');
    expect(value('.shell-nav', 'gap')).toBe('var(--space-2, 8px)');
    expect(value('.shell-nav-link', 'white-space')).toBe('nowrap');
  });

  it('a link is as high as the bar and never lower than 44 px; the word is in its middle', () => {
    expect(value('.shell-nav', 'align-self')).toBe('stretch');
    expect(value('.shell-nav-link', 'min-height')).toBe('44px');
    expect(value('.shell-nav-link', 'display')).toBe('inline-flex');
    expect(value('.shell-nav-link', 'align-items')).toBe('center');
    // The same border above and below, so the bar under the active link does not push the word up.
    expect(value('.shell-nav-link', 'border-width')).toBe('2px 0');
    // On a phone the three links share the row, so each is wider than its word.
    expect(value('.shell-nav-link', 'flex', 600)).toBe('1 1 auto');
    // The selector is 44 px high where it has its own row (a touch width).
    expect(value('.shell-header .demo-account select', 'min-height', 900)).toBe('44px');
  });

  it('the active link is shown by colour and a bar, not by a heavier weight that would move the links', () => {
    const active = ".shell-nav a.shell-nav-link[aria-current='page']";
    expect(value(active, 'color')).toBe('var(--accent-dark, #173E5B)');
    expect(value(active, 'border-bottom-color')).toBe('var(--accent, #1D5075)');
    expect(value(active, 'font-weight')).toBeUndefined();
    expect(value('.shell-nav-link', 'color')).toBe('var(--muted, #5B6472)');
    expect(value('.shell-nav a.shell-nav-link:hover', 'color')).toBe('var(--text, #171C24)');
  });

  it('an unavailable link has the box of a link, so the group does not move when the lists arrive', () => {
    const pending = '.shell-header .nav-pending';
    for (const prop of ['padding', 'border-width']) expect(value(pending, prop), prop).toBe(value('.shell-nav-link', prop));
    // Not only faded: a dashed bar where the active link has a solid one.
    expect(value(pending, 'border-bottom-style')).toBe('dashed');
    expect(value(pending, 'cursor')).toBe('not-allowed');
    // The narrow rule changes both paddings together.
    const both = shellRules.find((r) => r.media.some((m) => m.includes('600px')) && r.decls.some((d) => d.prop === 'padding'))!;
    expect(both.selector.split(',').map((s) => s.trim()).sort()).toEqual(['.shell-header .nav-pending', '.shell-nav-link']);
  });

  it("a link's focus ring is drawn inside it, where the top of the window cannot cut it", () => {
    expect(value('.shell-nav-link:focus-visible', 'outline-offset')).toBe('-2px');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it('the row of the selector starts with a hairline as wide as the header', () => {
    expect(value('.shell-tools', 'border-top', 900)).toBe('1px solid var(--border, #E3E3DE)');
    expect(value('.shell-tools', 'margin', 900)).toBe('0 calc(-1 * var(--shell-pad))');
    expect(value('.shell-tools', 'padding', 900)).toBe('var(--space-2, 8px) var(--shell-pad)');
    expect(value('.shell-tools', 'max-width', 900)).toBe('none');
    // The room at the two ends: 24 px, 12 px on a phone.
    expect(value('.shell-header', '--shell-pad')).toBe('var(--space-6, 24px)');
    expect(value('.shell-header', '--shell-pad', 600)).toBe('var(--space-3, 12px)');
  });

  it('every page renders the same header markup: logo link, the nav, the tools', () => {
    for (const path of ['/', `/business/${bid}`, `/employee/${eid}`, '/simulator', '/nope']) {
      const h = header(render(path));
      expect(h, path).toMatch(/^<a class="shell-wordmark" href="\/"[^>]*>.*?<\/a><nav aria-label="Workspaces" class="shell-nav">.*?<\/nav><div class="shell-tools">/);
    }
  });
});

describe('App.tsx contract', () => {
  it('mounts the NYC homepage', () => {
    expect(app).toContain("import Landing from './pages/Landing';");
    expect(app).toContain('<Landing dataset="nyc"');
  });
});
