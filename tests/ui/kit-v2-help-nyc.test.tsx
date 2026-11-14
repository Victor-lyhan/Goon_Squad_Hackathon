// #504, #548: the NYC Guided demo (Help dataset="nyc"), at /help since the cutover, rendered through the router.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  HELP_STEPS, NYC_HELP_STEPS, NYC_HELP_UNAVAILABLE_TEXT, nycHelpView, startNycHelpLists,
} from '../../client/src/pages/Help';
import type { V2BusinessDirectory, V2Directory } from '../../client/src/ui/shell';
import { ENV_LABELS } from '../../client/src/ui/shellModel';

const empReady: V2Directory = { status: 'ready', employees: [{ id: 'emp-07', name: 'Maya Chen' }, { id: 'emp-01', name: 'Luis Ortega' }] };
const bizReady: V2BusinessDirectory = { status: 'ready', businesses: [{ id: 'biz-chelsea-roasters', name: 'Chelsea Roasters' }, { id: 'biz-02', name: 'Hudson Print' }] };
const loading = { status: 'loading' } as const;
const down = { status: 'unavailable' } as const;
const failed = { status: 'error', message: 'Server answered 500' } as const;

const render = (path: string, e: V2Directory = empReady, b: V2BusinessDirectory = bizReady) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initialV2={e} initialV2Businesses={b} />
    </MemoryRouter>,
  );
const main = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1];
const stepLinks = (html: string) => [...main(html).matchAll(/<a class="help-step-link" href="([^"]+)"/g)].map((m) => m[1]);
const pending = (html: string) => (main(html).match(/help-step-link nav-pending/g) ?? []).length;
const allHrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('/help with both lists ready', () => {
  const html = render('/help');
  it('renders the Guided demo with six steps', () => {
    expect(main(html)).toContain('<h1>Guided demo</h1>');
    expect(main(html)).toContain('class="help help-nyc"');
    expect(main(html).match(/<li class="help-step">/g)).toHaveLength(6);
    expect(main(html)).not.toContain('Page not found');
  });
  it('links each step to the main paths with the first employee and first business', () => {
    expect(stepLinks(html)).toEqual([
      '/employee/emp-07', '/business/biz-chelsea-roasters', '/business/biz-chelsea-roasters',
      '/employee/emp-07', '/simulator', '/business/biz-chelsea-roasters',
    ]);
    expect(pending(html)).toBe(0);
    expect(main(html)).not.toContain('help-status');
  });
  it('has no /nyc link anywhere on the page', () => {
    expect(allHrefs(html).length).toBeGreaterThan(6);
    for (const h of allHrefs(html)) expect(h).not.toMatch(/^\/nyc(\/|$)/);
  });
});

describe('/help states', () => {
  it('loading: business, employee steps pending; simulator still linked; a status line', () => {
    const html = render('/help', loading, loading);
    expect(stepLinks(html)).toEqual(['/simulator']);
    expect(pending(html)).toBe(5);
    expect(main(html)).toMatch(/<p class="help-status" role="status">Loading NYC accounts…<\/p>/);
  });
  it('one list loaded: only its steps link', () => {
    const html = render('/help', empReady, loading);
    expect(stepLinks(html)).toEqual(['/employee/emp-07', '/employee/emp-07', '/simulator']);
    expect(pending(html)).toBe(3);
  });
  it('503: the NYC travel data line, steps pending', () => {
    for (const [e, b] of [[down, bizReady], [empReady, down], [down, down]] as const) {
      const html = render('/help', e, b);
      expect(main(html)).toContain(`role="status">${NYC_HELP_UNAVAILABLE_TEXT}</p>`);
      expect(main(html)).toContain('help-status--problem');
    }
    expect(NYC_HELP_UNAVAILABLE_TEXT).toBe('NYC travel data is not loaded on this server yet.');
  });
  it('other errors show their message as an alert', () => {
    const html = render('/help', empReady, failed);
    expect(main(html)).toMatch(/<p class="help-status help-status--problem" role="alert">Server answered 500<\/p>/);
    expect(stepLinks(html)).toContain('/employee/emp-07');
    expect(pending(html)).toBe(3);
  });
  it('503 wins over an error and empty lists leave steps pending', () => {
    expect(nycHelpView(down, failed).note?.kind).toBe('unavailable');
    const empty = nycHelpView({ status: 'ready', employees: [] }, { status: 'ready', businesses: [] });
    expect(empty).toEqual({ links: { employee: null, business: null, simulator: '/simulator' }, note: null });
    expect(nycHelpView(empReady, { status: 'ready', businesses: [{ id: 'b 1', name: 'x' }] }).links.business).toBe('/business/b%201');
  });
});

describe('NYC copy', () => {
  const html = render('/help');
  const words = text(main(html));
  it('says relay point and explains it, never hub', () => {
    expect(words).toContain('relay point: a network business that holds the package overnight');
    expect(words).not.toMatch(/hub/i);
    expect(NYC_HELP_STEPS.map((s) => s.text).join(' ')).not.toMatch(/hub/i);
  });
  it('names the simulator controls that are on main', () => {
    expect(NYC_HELP_STEPS[4].text).toContain('Play journey');
    expect(readFileSync('client/src/components/sim/v2/compose/journeyPlay.ts', 'utf8')).toContain("PLAY_LABEL = 'Play journey'");
    expect(readFileSync('client/src/components/sim/v2/controls/PlaybackControls.tsx', 'utf8')).toContain("label: 'Jump to morning'");
    expect(readFileSync('client/src/components/business/v2/NewDeliveryForm.tsx', 'utf8')).toContain("'Send request'");
  });
  it('the about paragraph describes the NYC data', () => {
    const about = text(/<section class="help-about"[\s\S]*?<\/section>/.exec(html)![0]).replace(/\s+/g, ' ');
    expect(about).toContain('What you are looking at');
    expect(about).toContain('real NYC locations');
    expect(about).toMatch(/travel times .* come from Google and are cached/);
    expect(about).toMatch(/Employees, their homes and the deliveries are simulated/);
    expect(about).toContain('homes are shown by neighborhood only');
    expect(about).not.toContain('demo data');
  });
  it('shows the NYC indicator and the same number of steps as the MVP 1 page', () => {
    expect(main(html)).toContain(`<p class="help-indicator">${ENV_LABELS.nyc}</p>`);
    expect(NYC_HELP_STEPS).toHaveLength(HELP_STEPS.length);
  });
});

describe('loading the lists', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it('reports both lists (id and name only)', async () => {
    const e: V2Directory[] = []; const b: V2BusinessDirectory[] = [];
    startNycHelpLists((d) => e.push(d), (d) => b.push(d), {}, {
      getEmployees: async () => ({ employees: [{ id: 'emp-1', name: 'A', businessId: 'x' }] }),
      getBusinesses: async () => ({ businesses: [{ id: 'biz-1', name: 'B', lat: 1 }] }),
    } as never);
    await flush();
    expect(e).toEqual([{ status: 'ready', employees: [{ id: 'emp-1', name: 'A' }] }]);
    expect(b).toEqual([{ status: 'ready', businesses: [{ id: 'biz-1', name: 'B' }] }]);
  });
  it('a 503 becomes unavailable, another error keeps its message', async () => {
    const e: V2Directory[] = []; const b: V2BusinessDirectory[] = [];
    const err503 = new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing');
    startNycHelpLists((d) => e.push(d), (d) => b.push(d), {}, {
      getEmployees: async () => { throw err503; },
      getBusinesses: async () => { throw new Error('boom'); },
    } as never);
    await flush();
    expect(e).toEqual([{ status: 'unavailable' }]);
    expect(b).toEqual([{ status: 'error', message: 'boom' }]);
  });
  it('the cleanup (unmount) aborts both requests and drops late answers', async () => {
    const signals: AbortSignal[] = [];
    const calls: unknown[] = [];
    const never = (opts?: { signal?: AbortSignal }) => { signals.push(opts!.signal!); return new Promise<never>(() => {}); };
    const stop = startNycHelpLists((d) => calls.push(d), (d) => calls.push(d), {}, { getEmployees: never, getBusinesses: never } as never);
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    stop();
    expect(signals.every((s) => s.aborted)).toBe(true);
    await flush();
    expect(calls).toEqual([]);
  });
  it('a list passed in is not requested', () => {
    let n = 0;
    const count = () => { n += 1; return new Promise<never>(() => {}); };
    startNycHelpLists(() => {}, () => {}, { employees: true, businesses: true }, { getEmployees: count, getBusinesses: count } as never)();
    expect(n).toBe(0);
  });
  it('the NYC help reads the stored demo identity but never writes it or loads MVP 1 lists', () => {
    const src = readFileSync('client/src/pages/Help.tsx', 'utf8');
    const nyc = src.slice(src.indexOf('export const NYC_HELP_STEPS'), src.indexOf('function SyntheticHelp'));
    expect(nyc).not.toMatch(/writeIdentity|localStorage|useDirectory/);
    expect(src).toMatch(/useEffect\(\s*\(\) => startNycHelpLists\(/);
  });
  it('the step links use a stored identity that is in the lists, else the first account', () => {
    expect(nycHelpView(empReady, bizReady, { employeeId: 'emp-01', businessId: 'biz-02' }).links)
      .toEqual({ employee: '/employee/emp-01', business: '/business/biz-02', simulator: '/simulator' });
    expect(nycHelpView(empReady, bizReady, { employeeId: 'emp-001', businessId: 'biz-sunrise' }).links)
      .toEqual({ employee: '/employee/emp-07', business: '/business/biz-chelsea-roasters', simulator: '/simulator' });
  });
});

describe('help.css', () => {
  const css = readFileSync('client/src/styles/help.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (sel: RegExp) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => sel.test(m[1])).map((m) => m[2]);
  it('the new rules use design tokens with fallbacks, no raw colours', () => {
    const nyc = rules(/\.help-(indicator|status)/);
    expect(nyc.length).toBeGreaterThanOrEqual(3);
    for (const body of nyc) {
      expect(body.replace(/var\(--[a-z0-9-]+, [^)]*\)/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgb/i);
      expect(body).toMatch(/var\(--/);
    }
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
    expect(css).not.toMatch(/box-shadow|gradient/i);
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(v).toMatch(/^var\(--radius(-lg)?, [24]px\)$/);
  });
  it('fits 390 px: no width over 390 px, steps stack on narrow screens, long errors wrap', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    for (const [, cols] of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) expect(cols.replace(/minmax\(0, [^)]*\)/g, '')).not.toMatch(/\d+px/);
    const m = /@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/.exec(css)!;
    expect(Number(m[1])).toBeGreaterThanOrEqual(390);
    expect(m[2]).toMatch(/\.help-step-link \{[^}]*white-space: normal/);
    expect(rules(/^\s*\.help-status\s*$/)[0]).toMatch(/overflow-wrap: anywhere/);
  });
});
