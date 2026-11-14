import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import Help, { HELP_STEPS } from '../../client/src/pages/Help';
import { loadDefaultScenario } from '../../server/api/initialRun';

const { businesses, employees } = loadDefaultScenario();
// The MVP 1 Guided demo is no longer mounted (#548); it is rendered on its own until its deletion.
const render = (path: string, initial = { businesses, employees }) =>
  path === '/help'
    ? renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><main><Help initial={initial} /></main></MemoryRouter>)
    : renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><AppShell initialV2={{ status: 'loading' }} initialV2Businesses={{ status: 'loading' }} /></MemoryRouter>);
const main = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1];
const routeOk = (href: string) => /^\/(business|employee)\/[^/]+$/.test(href) || href === '/simulator';

describe('MVP 1 Guided demo (not mounted)', () => {
  const html = main(render('/help'));
  it('has the title and six numbered steps', () => {
    expect(html).toContain('<h1>Guided demo</h1>');
    expect(HELP_STEPS).toHaveLength(6);
    expect(html).toMatch(/<ol class="help-steps">/);
    expect(html.match(/<li class="help-step">/g)).toHaveLength(6);
  });
  it('each step links to an existing route for the current identity', () => {
    const links = [...html.matchAll(/<a class="help-step-link" href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toHaveLength(6);
    for (const l of links) expect(routeOk(l)).toBe(true);
    expect(links[0]).toBe(`/employee/${employees[0].id}`);
    expect(links[1]).toBe(`/business/${businesses[0].id}`);
    expect(links[4]).toBe('/simulator');
  });
  it('shows disabled text when no identity is available', () => {
    const empty = main(render('/help', { businesses: [], employees: [] }));
    expect(empty.match(/<a class="help-step-link"/g)).toHaveLength(1); // simulator only
    expect(empty.match(/help-step-link nav-pending/g)).toHaveLength(5);
  });
  it('explains what you are looking at', () => {
    expect(html).toContain('What you are looking at');
  });
  it('unknown paths still render the 404 page', () => {
    expect(render('/help/extra')).toContain('Page not found');
    expect(render('/nowhere')).toContain('Page not found');
  });
  it('does not import from Landing', () => {
    expect(readFileSync('client/src/pages/Help.tsx', 'utf8')).not.toMatch(/from '\.\/Landing'/);
  });
});
