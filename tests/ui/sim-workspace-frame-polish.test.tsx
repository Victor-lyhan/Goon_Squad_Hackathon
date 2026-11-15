// @vitest-environment jsdom
// #907: design audit of the simulator page frame (workspace grid, panel headings, focus selector) at
// 900, 1280 and 1440 px. Pinned here: the page has one h1 and the panels' headings sit one level below
// it; the focus selector has visible labels, plain names, is in the Tab order in visual order, changes
// with the keyboard and keeps keyboard focus after "Show everything"; below 1280 px the panels are
// narrower so the map keeps room; the panel bodies scroll on their own while the map stays put.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIM_PAGE_TITLE } from '../../client/src/components/sim/v2/SimWorkspace';
import { button, byLabel, click, select, textOf } from './kitDom';
import { FakeSimServer, T, leftBody, mountBody, packageRow, readyState, tabbable } from './sim-v2-dom-helpers';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

type Heading = { level: number; text: string; el: HTMLElement };
const headings = (root: ParentNode): Heading[] =>
  [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
    .map((el) => ({ level: Number(el.tagName[1]), text: textOf(el), el }));

const employeeSelect = (c: ParentNode) => byLabel(c, 'Focus on employee') as HTMLSelectElement;
const businessSelect = (c: ParentNode) => byLabel(c, 'Focus on business') as HTMLSelectElement;

/** What the frame looks like for one selection (network, a package's journey, a business, an employee). */
function mountView(view: 'network' | 'package' | 'business' | 'employee') {
  const server = new FakeSimServer(readyState(1000));
  const m = mountBody(server, view === 'network' ? null
    : view === 'package' ? { kind: 'package', id: 'shp-2' }
    : view === 'business' ? { kind: 'business', id: 'biz-roast' }
    : { kind: 'employee', id: 'emp-1' });
  return { ...m, server };
}

describe('#907 headings: one h1, the panels one level below it', () => {
  it.each(['network', 'package', 'business', 'employee'] as const)('%s view', (view) => {
    const { container: c } = mountView(view);
    const hs = headings(c);
    const h1s = hs.filter((h) => h.level === 1);
    expect(h1s.map((h) => h.text)).toEqual([SIM_PAGE_TITLE]);
    // Visually hidden (the header's "Simulator" link names the page on screen), first in the page, outside the panels.
    expect(h1s[0].el.className).toBe('sw-visually-hidden');
    expect(hs[0].level).toBe(1);
    expect(h1s[0].el.closest('.sw-panel, .sw-map')).toBeNull();
    // Every heading in a panel is an h2 or lower, and no level is skipped going down.
    for (const h of hs.slice(1)) expect(h.level, h.text).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hs.length; i++) {
      expect(hs[i].level - hs[i - 1].level, `${hs[i - 1].text} -> ${hs[i].text}`).toBeLessThanOrEqual(1);
    }
    // The left panel's sections are h2.
    const left = headings(c.querySelector('.sw-left')!);
    expect(left.filter((h) => ['Packages', 'Focus', 'Direct only vs relay points'].includes(h.text)).map((h) => h.level))
      .toEqual([2, 2, 2]);
    // The right panel opens with an h2 (Run summary, the package, the business or the employee).
    expect(headings(c.querySelector('.sw-right')!)[0].level).toBe(2);
  }, T);
});

describe('#907 the focus selector', () => {
  it('has a visible label for each select, inside a "Focus" section', () => {
    const { container: c } = mountView('network');
    for (const [label, sel] of [['Focus on employee', employeeSelect(c)], ['Focus on business', businessSelect(c)]] as const) {
      const lab = c.querySelector<HTMLLabelElement>(`label[for="${sel.id}"]`)!;
      expect(textOf(lab)).toBe(label);
      expect(lab.className).not.toMatch(/visually-hidden|sr-only/);
      expect(lab.hidden).toBe(false);
      expect(sel.tagName).toBe('SELECT'); // native: the screen reader reads the choice
      expect(sel.closest('section')?.getAttribute('aria-labelledby')).toBe('sw-section-focus');
    }
  }, T);

  it('lists plain names, never IDs', () => {
    const { container: c } = mountView('network');
    for (const sel of [employeeSelect(c), businessSelect(c)]) {
      const texts = [...sel.options].map((o) => textOf(o));
      expect(texts.length).toBeGreaterThan(1);
      for (const t of texts) expect(t).not.toMatch(/\b(emp|biz|shp|home|hub)-|\b[a-z]+-\d+\b/i);
    }
    expect(textOf(employeeSelect(c).options[0])).toBe('All employees');
    expect(textOf(businessSelect(c).options[0])).toBe('All businesses');
  }, T);

  it('is reached by Tab in visual order: after the package list, employee before business, before Compare', () => {
    const { container: c } = mountView('network');
    const order = tabbable(c);
    const at = (el: Element) => order.indexOf(el as HTMLElement);
    const lastRow = [...c.querySelectorAll('ul.sw-pkgs button.sw-pkg')].pop()!;
    expect(at(employeeSelect(c))).toBeGreaterThan(at(lastRow));
    expect(at(businessSelect(c))).toBe(at(employeeSelect(c)) + 1);
    expect(at(button(c, 'Compare'))).toBeGreaterThan(at(businessSelect(c)));
    // Nothing sets a tabindex to reorder it.
    for (const sel of [employeeSelect(c), businessSelect(c)]) expect(sel.hasAttribute('tabindex')).toBe(false);
  }, T);

  it('changes the focus with the keyboard alone; choosing a business clears the employee', () => {
    const { container: c } = mountView('network');
    expect(button(c, 'Show everything').disabled).toBe(true);
    const ana = [...employeeSelect(c).options].find((o) => textOf(o) === 'Ana Ruiz')!;
    select(employeeSelect(c), 'Ana Ruiz'); // focus, then a change event: what the arrow keys do on a native select
    expect(document.activeElement).toBe(employeeSelect(c));
    expect(employeeSelect(c).value).toBe(ana.value);
    expect(button(c, 'Show everything').disabled).toBe(false);

    const biz = businessSelect(c).options[1];
    select(businessSelect(c), textOf(biz));
    expect(businessSelect(c).value).toBe(biz.value);
    expect(employeeSelect(c).value).toBe('');
  }, T);

  it.each([['employee', employeeSelect], ['business', businessSelect]] as const)(
    '"Show everything" hands keyboard focus to the %s select it cleared, not to the page', (_kind, sel) => {
      const { container: c } = mountView('network');
      select(sel(c), textOf(sel(c).options[1]));
      const show = button(c, 'Show everything');
      click(show);
      expect(sel(c).value).toBe('');
      expect(show.disabled).toBe(true);
      expect(document.activeElement).toBe(sel(c));
    }, T);

  it('keeps its place in the left panel in a package journey', () => {
    const { container: c } = mountView('network');
    click(packageRow(c, 'Coffee samples'));
    expect(leftBody(c).contains(employeeSelect(c))).toBe(true);
    expect(tabbable(c)).toContain(employeeSelect(c));
  }, T);
});

describe('#907 the frame CSS', () => {
  const css = readFileSync('client/src/components/sim/v2/SimWorkspace.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (src: string, sel: string) => {
    const m = src.match(new RegExp(`(?:^|[}\\s])${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`no rule ${sel}`);
    return m[1];
  };

  it('fills the window under the header and never scrolls the page sideways', () => {
    expect(rule(css, '.sim-v2')).toMatch(/position:\s*fixed/);
    expect(rule(css, '.sim-v2')).toMatch(/left:\s*0/);
    expect(rule(css, '.sim-v2')).toMatch(/right:\s*0/);
    expect(rule(css, '.sw-frame')).toMatch(/overflow:\s*hidden/);
    expect(rule(css, '.sw-map')).toMatch(/min-width:\s*0/);
  });

  it('scrolls each panel body on its own; the map does not scroll', () => {
    const body = rule(css, '.sw-panel-body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(rule(css, '.sw-panel')).toMatch(/overflow:\s*hidden/);
    expect(rule(css, '.sw-map')).not.toMatch(/overflow/);
  });

  it('narrows the panels below 1280 px (map 300 px at 900 px) and keeps 320 + 360 px from 1280 px up', () => {
    expect(rule(css, '.sw-left')).toMatch(/width:\s*320px/);
    expect(rule(css, '.sw-right')).toMatch(/width:\s*360px/);
    const start = css.indexOf('@media (max-width: 1279.98px)');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start);
    const left = Number(rule(block, '.sw-left').match(/width:\s*(\d+)px/)![1]);
    const right = Number(rule(block, '.sw-right').match(/width:\s*(\d+)px/)![1]);
    expect([left, right]).toEqual([288, 312]);
    expect(900 - left - right).toBeGreaterThanOrEqual(300);
    // Both on the 4 px spacing scale.
    expect(left % 4).toBe(0);
    expect(right % 4).toBe(0);
  });

  it('adds no new colours or fonts: every colour is a token with its own value as the fallback', () => {
    const colours = [...css.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((m) => m[0].toUpperCase());
    expect(new Set(colours)).toEqual(new Set(['#F7F7F4', '#171C24', '#E3E3DE', '#FFFFFF', '#5B6472', '#1D5075']));
    for (const m of css.matchAll(/font-family:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--font-(sans|mono),/);
  });
});
