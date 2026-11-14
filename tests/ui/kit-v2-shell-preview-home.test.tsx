// #504: on /nyc paths the header's brand and Help links stay inside /nyc; elsewhere they are unchanged.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import type { V2BusinessDirectory, V2Directory } from '../../client/src/ui/shell';
import { ENV_LABELS, helpPathFor, homePathFor } from '../../client/src/ui/shellModel';
import { loadDefaultScenario } from '../../server/api/initialRun';

const { businesses, employees } = loadDefaultScenario();
const v2: V2Directory = { status: 'ready', employees: [{ id: 'emp-01', name: 'Maya Chen' }] };
const v2Biz: V2BusinessDirectory = { status: 'ready', businesses: [{ id: 'biz-01', name: 'Chelsea Roasters' }] };
const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initial={{ businesses, employees }} initialV2={v2} initialV2Businesses={v2Biz} />
    </MemoryRouter>,
  );
const header = (html: string) => /<header class="shell-header">([\s\S]*?)<\/header>/.exec(html)![1];
const brand = (html: string) => /<a [^>]*href="([^"]*)"[^>]*class="shell-wordmark"|<a [^>]*class="shell-wordmark"[^>]*href="([^"]*)"/.exec(header(html))!.slice(1).find(Boolean);
const help = (html: string) => /<a [^>]*>Help<\/a>/.exec(header(html))![0];
const navCurrent = (html: string) => [...header(html).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('header on /nyc paths', () => {
  it.each(['/nyc', '/nyc/help', '/nyc/simulator', '/nyc/employee/emp-01', '/nyc/business/biz-01', '/nyc/unknown'])(
    '%s: brand → /nyc, Help → /nyc/help, NYC indicator',
    (p) => {
      const html = render(p);
      expect(brand(html)).toBe('/nyc');
      expect(help(html)).toContain('href="/nyc/help"');
      expect(header(html)).toContain(`class="shell-env">${ENV_LABELS.nyc}<`);
      expect(header(html)).not.toMatch(/href="\/(help|business|employee|simulator)?"/);
    },
  );
  it('/nyc/help marks Help as the current page and no workspace', () => {
    const html = render('/nyc/help');
    expect(help(html)).toMatch(/class="shell-help active"/);
    expect(help(html)).toContain('aria-current="page"');
    expect(navCurrent(html)).toEqual(['Help']);
  });
  it('/nyc marks nothing as current; the nav links go to the preview pages', () => {
    const html = render('/nyc');
    expect(navCurrent(html)).toEqual([]);
    expect(help(html)).toMatch(/class="shell-help"/);
    expect(header(html)).toContain('href="/nyc/business/biz-01"');
    expect(header(html)).toContain('href="/nyc/employee/emp-01"');
    expect(header(html)).toContain('href="/nyc/simulator"');
    expect(header(html)).not.toContain('Demo account');
  });
});

describe('header on every other path is unchanged', () => {
  it.each(['/', '/help', '/simulator', `/business/${businesses[0].id}`, `/employee/${employees[0].id}`, '/nowhere', '/nycx'])(
    '%s: brand → /, Help → /help, synthetic indicator',
    (p) => {
      const html = render(p);
      expect(brand(html)).toBe('/');
      expect(help(html)).toContain('href="/help"');
      expect(header(html)).toContain(`class="shell-env">${ENV_LABELS.synthetic}<`);
      expect(header(html)).not.toContain('/nyc');
    },
  );
  it('/help is still marked current on /help only', () => {
    expect(help(render('/help'))).toMatch(/class="shell-help active" aria-current="page"/);
    expect(help(render('/'))).not.toContain('aria-current');
  });
});

describe('path helpers', () => {
  it('pick the preview or the MVP 1 target', () => {
    expect(homePathFor('/nyc')).toBe('/nyc');
    expect(homePathFor('/nyc/employee/x')).toBe('/nyc');
    expect(homePathFor('/nycx')).toBe('/');
    expect(homePathFor('/simulator')).toBe('/');
    expect(helpPathFor('/nyc/help')).toBe('/nyc/help');
    expect(helpPathFor('/nyc')).toBe('/nyc/help');
    expect(helpPathFor('/help')).toBe('/help');
    expect(helpPathFor('/')).toBe('/help');
  });
});
