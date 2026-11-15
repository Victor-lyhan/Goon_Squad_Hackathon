// @vitest-environment jsdom
// #886: the four app-wide states of the UI kit say what happened in one line and offer one action.
// 404 page, error boundary, connection note ("can't reach the Relay server" and "connected again") and
// the spinner, each in a real DOM, plus the rules of ui.css that jsdom cannot lay out (position, radius,
// reduced motion, width at 390 px). The browser check at 1440 and 390 px is in the PR description.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACK_TEXT, ConnectionBanner, ConnectionMonitor, connectionText, OFFLINE_TEXT } from '../../client/src/ui/ConnectionBanner';
import {
  BACK_FOR_CHECKS, HEALTH_POLL_MS, initialConnection, nextConnection, OFFLINE_AFTER_FAILURES, type ConnectionState,
} from '../../client/src/ui/connectionModel';
import { ErrorBoundary, ERROR_FALLBACK_ACTION, ERROR_FALLBACK_TITLE, errorFallbackText } from '../../client/src/ui/ErrorBoundary';
import NotFoundPage, { NOT_FOUND_ACTION, NOT_FOUND_TEXT, NOT_FOUND_TITLE } from '../../client/src/ui/NotFoundPage';
import { Spinner } from '../../client/src/ui/Spinner';
import { button, click, link, mount, textOf } from './kitDom';

const css = readFileSync('client/src/ui/ui.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the first rule with exactly this selector, outside any @media block. */
function rule(selector: string): Record<string, string> {
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\{([^}]*)\\}`).exec(top);
  if (!m) throw new Error(`ui.css has no rule "${selector}"`);
  return Object.fromEntries(m[1].split(';').filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
  }));
}
const reducedMotion = [...css.matchAll(/@media \(prefers-reduced-motion:reduce\)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)].map((m) => m[1]).join('\n');
const sentences = (text: string) => text.split(/(?<=[.!?…])\s+/).filter(Boolean);
const SECRET = 'kit-states-polish secret crash detail';
function Boom(): never { throw new Error(SECRET); }

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('404 page: one heading, one sentence, one button to /', () => {
  it('shows exactly that, and asks the server for nothing', () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const m = mount(<MemoryRouter initialEntries={['/definitely-not-a-page']}><NotFoundPage /></MemoryRouter>);
    const page = m.container.querySelector('.not-found')!;
    expect(page).not.toBeNull();
    expect([...page.querySelectorAll('h1, h2, h3')].map(textOf)).toEqual([NOT_FOUND_TITLE]);
    expect(NOT_FOUND_TITLE).toBe('Page not found');
    expect([...page.querySelectorAll('p')].map(textOf)).toEqual([NOT_FOUND_TEXT]);
    expect(sentences(NOT_FOUND_TEXT)).toHaveLength(1);
    // One control: a link (it navigates) with the kit button's look, to the homepage.
    const controls = [...page.querySelectorAll('a, button')];
    expect(controls).toHaveLength(1);
    const home = link(page, NOT_FOUND_ACTION);
    expect(home.getAttribute('href')).toBe('/');
    expect([...home.classList]).toEqual(expect.arrayContaining(['ui-btn', 'ui-btn--primary']));
    // The heading names the region; a 404 is not an alert.
    expect(page.getAttribute('aria-labelledby')).toBe(page.querySelector('h1')!.id);
    expect(m.container.querySelector('[role="alert"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still takes the two lists the app shell passes, and shows the same page', () => {
    const m = mount(
      <MemoryRouter>
        <NotFoundPage
          initialEmployees={{ status: 'ready', employees: [{ id: 'emp-01', name: 'Maya Chen' }] }}
          initialBusinesses={{ status: 'ready', businesses: [{ id: 'biz-01', name: 'Brooklyn Roasters' }] }}
        />
      </MemoryRouter>,
    );
    expect([...m.container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/']);
  });
});

describe('error boundary: names the page, offers Reload, shows no error text', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

  const crashAt = (path: string, onReload = vi.fn()) => ({
    onReload,
    m: mount(
      <MemoryRouter initialEntries={[path]}>
        <ErrorBoundary resetKey={path} onReload={onReload}><Boom /></ErrorBoundary>
      </MemoryRouter>,
    ),
  });

  it('is an assertive alert with one heading, one sentence and one button', () => {
    const { m, onReload } = crashAt('/simulator?package=shp-4');
    const fb = m.container.querySelector('.error-fallback')!;
    expect(fb.getAttribute('role')).toBe('alert'); // role="alert" is read out at once (assertive)
    expect(fb.getAttribute('aria-live')).toBeNull(); // nothing that would turn it polite again
    expect([...fb.querySelectorAll('h1, h2, h3')].map(textOf)).toEqual([ERROR_FALLBACK_TITLE]);
    expect(fb.getAttribute('aria-labelledby')).toBe(fb.querySelector('h1')!.id);
    expect([...fb.querySelectorAll('p')].map(textOf)).toEqual(['Relay could not show the Simulator page.']);
    expect(fb.querySelectorAll('a, button')).toHaveLength(1);
    expect(ERROR_FALLBACK_ACTION).toBe('Reload page');
    click(button(fb, ERROR_FALLBACK_ACTION));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('names each page by the word of its header link', () => {
    expect(errorFallbackText('/business/biz-01')).toBe('Relay could not show the Business page.');
    expect(errorFallbackText('/employee/emp-7')).toBe('Relay could not show the Employee page.');
    expect(errorFallbackText('/simulator')).toBe('Relay could not show the Simulator page.');
    expect(errorFallbackText('/')).toBe('Relay could not show the homepage.');
    expect(errorFallbackText('/no-such-page')).toBe('Relay could not show this page.');
    for (const p of ['/', '/business/b', '/employee/e', '/simulator', '/x']) expect(sentences(errorFallbackText(p)), p).toHaveLength(1);
    expect(textOf(crashAt('/employee/emp-7').m.container.querySelector('.error-fallback p')!)).toBe('Relay could not show the Employee page.');
  });

  it('never puts the error message or a stack trace on the page', () => {
    const { m } = crashAt('/business/biz-01');
    expect(m.container.innerHTML).not.toContain(SECRET);
    expect(textOf(m.container)).not.toMatch(/\bError\b|\bat \w+ \(|\.tsx?:\d+/);
    // In a production build too: the component never reads the error it caught, in any build mode.
    const src = readFileSync('client/src/ui/ErrorBoundary.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).toContain('static getDerivedStateFromError(): Partial<State>');
    expect(src).not.toMatch(/\.stack\b|\.message\b|componentStack|String\(_?error\)|import\.meta\.env|process\.env/);
  });
});

describe('connection note: one line while retrying, a clear "back" moment', () => {
  it('uses the pages\' name for the server, in one line each', () => {
    expect(OFFLINE_TEXT).toBe("Can't reach the Relay server. Retrying…");
    expect(BACK_TEXT).toBe('Connected to the Relay server again.');
    for (const t of [OFFLINE_TEXT, BACK_TEXT]) {
      expect(t).toContain('Relay server');
      expect(t).not.toMatch(/\bAPI\b|backend|back end/i);
      expect(t).not.toContain('\n');
      expect(t.length).toBeLessThanOrEqual(40); // one line in the 358 px a 390 px window leaves
    }
    expect(connectionText('online')).toBeNull();
    expect(connectionText('offline')).toBe(OFFLINE_TEXT);
    expect(connectionText('back')).toBe(BACK_TEXT);
  });

  it('the model: offline after two misses, back on the first answer, online two answers later', () => {
    const run = (answers: boolean[]) => answers.reduce<ConnectionState[]>((seen, ok) => [...seen, nextConnection(seen.at(-1) ?? initialConnection, ok)], []);
    expect(HEALTH_POLL_MS).toBe(3000);
    expect(OFFLINE_AFTER_FAILURES).toBe(2);
    expect(BACK_FOR_CHECKS).toBe(2);
    expect(run([false, false, false, true, true, true, true]).map((s) => s.status))
      .toEqual(['online', 'offline', 'offline', 'back', 'back', 'online', 'online']);
    // A server that was never away never says "back".
    expect(run([true, false, true, true]).map((s) => s.status)).toEqual(['online', 'online', 'online', 'online']);
    // One missed check during "back" keeps the note; a second one is offline again.
    expect(run([false, false, true, false, true, true]).map((s) => s.status)).toEqual(['online', 'offline', 'back', 'back', 'back', 'online']);
    expect(run([false, false, true, false, false]).map((s) => s.status)).toEqual(['online', 'offline', 'back', 'back', 'offline']);
    // Back to the first state exactly, so the next spell starts clean.
    expect(run([false, false, true, true, true]).at(-1)).toEqual(initialConnection);
  });

  it('is a polite live region that is in the page before it has anything to say', () => {
    const m = mount(<ConnectionBanner status="online" />);
    const region = m.container.querySelector('[role="status"]')!;
    expect(region).not.toBeNull();
    expect(textOf(region)).toBe('');
    expect(region.children).toHaveLength(0);
    m.rerender(<ConnectionBanner status="offline" />);
    expect(m.container.querySelector('[role="status"]')).toBe(region); // the same region, now with the line
    expect(textOf(region)).toBe(OFFLINE_TEXT);
    expect(region.querySelector('.ui-connection-banner--offline')).not.toBeNull();
    m.rerender(<ConnectionBanner status="back" />);
    expect(m.container.querySelector('[role="status"]')).toBe(region);
    expect(textOf(region)).toBe(BACK_TEXT);
    expect(region.querySelector('.ui-connection-banner--back')).not.toBeNull();
    expect(region.querySelectorAll('.ui-connection-banner')).toHaveLength(1);
    expect(m.container.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull();
    // No action of its own: it retries by itself.
    expect(region.querySelectorAll('a, button')).toHaveLength(0);
  });

  it('the monitor checks every 3 s: retrying line, then "connected again", then nothing', async () => {
    vi.useFakeTimers();
    let up = true;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      if (!up) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const m = mount(<ConnectionMonitor />);
    const region = m.container.querySelector('[role="status"]')!;
    const poll = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS); }); };

    await poll();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/health');
    expect(textOf(region)).toBe('');

    up = false;
    await poll();
    expect(textOf(region)).toBe(''); // one miss: not yet
    await poll();
    expect(textOf(region)).toBe(OFFLINE_TEXT);
    await poll();
    expect(textOf(region)).toBe(OFFLINE_TEXT);

    up = true;
    await poll();
    expect(textOf(region)).toBe(BACK_TEXT);
    await poll();
    expect(textOf(region)).toBe(BACK_TEXT); // about 6 s on screen
    await poll();
    expect(textOf(region)).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(7); // one request per 3 s, no extra ones
  });
});

describe('spinner: a name for screen readers, still under reduced motion', () => {
  it('announces its label politely and hides the ring from screen readers', () => {
    const m = mount(<><Spinner /><Spinner label="Loading map" /></>);
    const [plain, named] = [...m.container.querySelectorAll('[role="status"]')];
    expect(textOf(plain)).toBe('Loading');
    expect(textOf(named)).toBe('Loading map');
    for (const s of [plain, named]) {
      expect(s.querySelector('.ui-spinner')!.getAttribute('aria-hidden')).toBe('true');
      expect(s.querySelector('.ui-sr-only')).not.toBeNull();
    }
  });

  it('turns by default and stops under prefers-reduced-motion, where it is drawn dotted', () => {
    expect(rule('.ui-spinner').animation).toMatch(/^ui-spin .+ infinite$/);
    expect(reducedMotion).toMatch(/\.ui-spinner\{animation:none;border-style:dotted/);
  });
});

describe('the look: docs/mvp3.md P4 and a 390 px window (ui.css)', () => {
  it('404 and error fallback share one panel: tokens, Inter, 4 px radius, hairline', () => {
    for (const file of ['NotFoundPage.tsx', 'ErrorBoundary.tsx']) {
      const src = readFileSync(`client/src/ui/${file}`, 'utf8');
      for (const c of ['ui-state', 'ui-state__title', 'ui-state__text']) expect(src, `${file} ${c}`).toMatch(new RegExp(`className="[^"]*\\b${c}\\b`));
    }
    const panel = rule('.ui-state');
    expect(panel['border-radius']).toBe('var(--radius)');
    expect(panel['font-family']).toBe('var(--font-sans)');
    expect(panel.border).toBe('1px solid var(--border)');
    expect(panel.background).toBe('var(--panel)');
    // 390 px: never wider than its column, padding inside the width, long words wrap.
    expect(panel['box-sizing']).toBe('border-box');
    expect(panel['max-width']).toBe('928px');
    expect(panel['overflow-wrap']).toBe('anywhere');
    // The crash is marked by a red hairline and by its words, and beats the older shell.css rule.
    expect(rule('.ui-state.ui-state--problem')).toEqual({ padding: 'var(--space-4)', border: '1px solid var(--danger)' });
    expect(rule('.ui-state__title')['font-size']).toBe('var(--text-lg)');
    expect(rule('.ui-state__text')['font-size']).toBe('var(--text-md)');
  });

  it('the connection note is fixed at the bottom right, so it cannot cover the header or move the page', () => {
    const note = rule('.ui-connection-banner');
    expect(note.position).toBe('fixed');
    expect(note.right).toBe('var(--space-4)');
    expect(note.bottom).toBe('var(--space-4)');
    expect(note.top).toBeUndefined();
    expect(note.left).toBeUndefined();
    expect(note.width).toBeUndefined();
    // 390 px: 16 px clear on both sides, and the words wrap inside it.
    expect(note['max-width']).toBe('calc(100% - var(--space-8))');
    expect(note['box-sizing']).toBe('border-box');
    expect(note['overflow-wrap']).toBe('anywhere');
    expect(note['border-radius']).toBe('var(--radius)');
    expect(note['font-family']).toBe('var(--font-sans)');
    expect(note.background).toBe('var(--warn)');
    expect(rule('.ui-connection-banner--back')).toEqual({ background: 'var(--ok)' });
    expect(reducedMotion).toContain('.ui-connection-banner{animation:none}');
    // The live region around it has no box: no rule gives .ui-connection a size, a place or a colour.
    expect(css).not.toMatch(/\.ui-connection[\s,{:]/);
  });

  it('no radius in the kit sheet is above 6 px and no colour is written out', () => {
    for (const m of css.matchAll(/border-radius:([^;}]+)/g)) expect(m[1].trim()).toMatch(/^var\(--radius(-lg)?\)$/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
