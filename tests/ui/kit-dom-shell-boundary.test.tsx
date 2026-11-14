// @vitest-environment jsdom
// #529: a page that throws while rendering shows a fallback under a working header (DECISIONS pass 57),
// and the fallback is cleared when the path changes. Real AppShell and header; the pages are stand-ins.
// Main paths since the cutover (#548).
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, ERROR_FALLBACK_TEXT, ERROR_FALLBACK_TITLE } from '../../client/src/ui';
import { CRASH_TEXT, crashing } from './kit-dom-shell-pages';
import { fakeApi, renderShell } from './kit-dom-shell-helper';
import { button, buttons, click, link, mount, select, textOf } from './kitDom';

const { page } = vi.hoisted(() => ({
  page: (name: string) => async () => ({ default: (await import('./kit-dom-shell-pages')).stubPage(name) }),
}));
vi.mock('../../client/src/pages/Landing', page('Landing'));
vi.mock('../../client/src/pages/Help', page('Help'));
vi.mock('../../client/src/pages/v2/SimulatorV2', page('SimulatorV2'));
vi.mock('../../client/src/pages/v2/EmployeeV2', page('EmployeeV2'));
vi.mock('../../client/src/pages/v2/BusinessV2', page('BusinessV2'));

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
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

const fallback = (root: ParentNode) => root.querySelector('[role="alert"].error-fallback');

describe('a page that throws on a main path', () => {
  it('shows the fallback under the header, without the error text', async () => {
    crashing.add('EmployeeV2');
    const s = await renderShell('/employee/emp-01');
    const fb = fallback(s.main())!;
    expect(fb).not.toBeNull();
    expect(s.main().contains(fb)).toBe(true);
    expect(textOf(fb.querySelector('h1')!)).toBe(ERROR_FALLBACK_TITLE);
    expect(textOf(fb.querySelector('p')!)).toBe(ERROR_FALLBACK_TEXT);
    expect(button(fb, 'Reload page').type).toBe('button');
    expect(link(fb, 'Go to the homepage').getAttribute('href')).toBe('/');
    expect(textOf(s.container)).not.toContain(CRASH_TEXT);
    expect(s.container.innerHTML).not.toContain(CRASH_TEXT);
    // Header still there, with its links and the selector.
    expect(s.header()).not.toBeNull();
    expect(link(s.header(), 'Relay').getAttribute('href')).toBe('/');
    expect(s.selector()!.value).toBe('emp-01');
  }, T);

  it('a header link after the crash shows that page, not the fallback', async () => {
    crashing.add('EmployeeV2');
    const s = await renderShell('/employee/emp-01');
    expect(fallback(s.main())).not.toBeNull();
    click(link(s.header(), 'Simulator'));
    expect(s.where.path).toBe('/simulator');
    expect(fallback(s.main())).toBeNull();
    expect(textOf(s.main())).toBe('SimulatorV2 at /simulator');
  }, T);

  it('the header selector after the crash moves on and the next account renders', async () => {
    crashing.add('BusinessV2');
    const s = await renderShell('/business/biz-01?shipment=shp-1');
    expect(fallback(s.main())).not.toBeNull();
    crashing.clear();
    select(s.selector()!, 'Hudson Print Co');
    expect(s.where).toEqual({ path: '/business/biz-02', search: '' });
    expect(fallback(s.main())).toBeNull();
    expect(textOf(s.main())).toBe('BusinessV2 at /business/biz-02');
  }, T);

  it('the homepage link goes to / and clears the fallback', async () => {
    crashing.add('SimulatorV2');
    const s = await renderShell('/simulator');
    click(link(fallback(s.main())!, 'Go to the homepage'));
    expect(s.where.path).toBe('/');
    expect(fallback(s.main())).toBeNull();
    expect(textOf(s.main())).toBe('Landing at /');
  }, T);

  it('a page that still throws after navigation shows the fallback again', async () => {
    crashing.add('EmployeeV2');
    const s = await renderShell('/employee/emp-01');
    select(s.selector()!, 'Luis Ortega');
    expect(s.where.path).toBe('/employee/emp-02');
    expect(fallback(s.main())).not.toBeNull();
  }, T);
});

describe('Help and the homepage', () => {
  it('Help from a crashed page shows Help', async () => {
    crashing.add('SimulatorV2');
    const s = await renderShell('/simulator');
    const fb = fallback(s.main())!;
    expect(link(fb, 'Go to the homepage').getAttribute('href')).toBe('/');
    click(link(s.header(), 'Help'));
    expect(s.where.path).toBe('/help');
    expect(fallback(s.main())).toBeNull();
    expect(textOf(s.main())).toBe('Help at /help');
  }, T);

  it('a page that renders does not show the fallback', async () => {
    const s = await renderShell('/');
    expect(fallback(s.container)).toBeNull();
    expect(s.container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(textOf(s.main())).toBe('Landing at /');
  }, T);
});

describe('ErrorBoundary on its own', () => {
  function Boom(): never { throw new Error(CRASH_TEXT); }

  it('Reload page calls onReload; the button is the only one in the fallback', () => {
    const onReload = vi.fn();
    const m = mount(
      <MemoryRouter>
        <ErrorBoundary resetKey="/a" homeHref="/" onReload={onReload}><Boom /></ErrorBoundary>
      </MemoryRouter>,
    );
    expect(buttons(m.container, /.*/)).toHaveLength(1);
    click(button(m.container, 'Reload page'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('resets when resetKey changes and stays put while it does not', () => {
    let throwIt = true;
    function Maybe() { if (throwIt) throw new Error(CRASH_TEXT); return <p>fine</p>; }
    const el = (key: string) => (
      <MemoryRouter><ErrorBoundary resetKey={key} homeHref="/"><Maybe /></ErrorBoundary></MemoryRouter>
    );
    const m = mount(el('/a'));
    expect(fallback(m.container)).not.toBeNull();
    throwIt = false;
    m.rerender(el('/a'));
    expect(fallback(m.container)).not.toBeNull();
    m.rerender(el('/b'));
    expect(fallback(m.container)).toBeNull();
    expect(textOf(m.container)).toBe('fine');
  });
});

describe('fallback styles', () => {
  const css = readFileSync('client/src/ui/shell.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/(\.error-fallback[^{]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

  it('has rules for every class the component uses', () => {
    const src = readFileSync('client/src/ui/ErrorBoundary.tsx', 'utf8');
    const used = [...src.matchAll(/className="([^"]+)"/g)].map((m) => m[1]).filter((c) => c.startsWith('error-fallback'));
    expect(used.length).toBeGreaterThanOrEqual(4);
    for (const c of used) expect(rules.some((r) => r.sel.split(/[\s,:]/).includes(`.${c}`))).toBe(true);
  });

  it('uses design tokens only: no literal colours, no shadows, no rounded cards, no fallbacks', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const { sel, body } of rules) {
      expect(body, sel).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      expect(body, sel).not.toMatch(/box-shadow|gradient/i);
      expect(body, sel).not.toMatch(/var\(--[\w-]+\s*,/); // no hard-coded fallback values
      const radius = /border-radius:\s*([^;]+)/.exec(body);
      if (radius) expect(radius[1].trim(), sel).toBe('var(--radius)');
      for (const d of body.split(';').map((x) => x.trim()).filter(Boolean)) {
        const [prop, value] = d.split(/:(.*)/s).map((x) => x.trim());
        if (/^(padding|margin|gap)/.test(prop)) expect(value, `${sel} ${prop}`).toMatch(/^(0|var\(--space-\d\)|\s)+$/);
        if (prop === 'font-size') expect(value, sel).toMatch(/^var\(--text-(xs|sm|md|lg|xl)\)$/);
      }
    }
  });
});
